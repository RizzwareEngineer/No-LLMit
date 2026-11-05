// The shared spectator table: one game that the server starts at boot and plays forever.
// The server owns the clock, releasing each LLM turn on a timer and broadcasting it to
// every connected spectator, so everyone watches the same moment and late joiners get
// the current state. Spectators are read-only. Started by server.go.
package api

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"log"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/gorilla/websocket"
	"github.com/rizzwareengineer/no-LLMit/engine/client"
	"github.com/rizzwareengineer/no-LLMit/engine/game"
	"github.com/rizzwareengineer/no-LLMit/engine/history"
)

// Display pacing. Mirrors what the frontend used to do on its own clock.
const (
	buttonCardDelay   = 2 * time.Second
	buttonWinnerDelay = 5 * time.Second
	thinkingDuration  = 5 * time.Second  // minimum time "Thinking..." is shown
	minReasoning      = 5 * time.Second  // reasoning typewriter, 25ms per character
	maxReasoning      = 10 * time.Second //
	postActionDelay   = 5 * time.Second
	nextHandDelay     = 7 * time.Second
)

// Seat names. Each must have a model in llm/registry.py.
var tablePlayers = []string{
	"GPT-OSS 20B", "Claude Haiku 5.5", "Gemma 3 12B", "Llama 3.1 8B", "Mistral Nemo",
	"DeepSeek V4 Flash", "Phi-4", "Qwen 3.7 Flash", "Cohere Command R7B",
}

const (
	tableStartingStack = 2000
	tableSmallBlind    = 5
	tableBigBlind      = 10
)

type spectator struct {
	conn *websocket.Conn
	out  chan []byte
}

type Table struct {
	mu           sync.Mutex
	gs           *game.GameState
	spectators   map[*websocket.Conn]*spectator
	buttonCards  []ButtonCardPayload
	buttonWinner *ButtonWinnerPayload
	turn         *ServerMessage // llm_thinking or llm_action currently on screen
	nextHandAt   time.Time
	notice       TableNoticePayload // shown to everyone while the table is stopped; Kind "" when running

	dailyCallCap int
	calls        int
	callsDay     string
	pace         float64

	// Hand history: every finished hand is recorded and saved
	id           string
	store        *HandStore
	recorder     *handRecorder
	promptVer    string // version of the cached system prompt
	systemPrompt string

	// Daily opening hours, e.g. 9 to 21 in America/New_York. hoursZone is nil when the
	// table is always open.
	openHour  int
	closeHour int
	hoursZone *time.Location
}

// onSaved, if set, is called with each hand once it is saved.
func NewTable(onSaved func(history.HandRecord)) *Table {
	idBytes := make([]byte, 3)
	rand.Read(idBytes)
	t := &Table{
		id:           "tbl_" + hex.EncodeToString(idBytes),
		store:        NewHandStore(onSaved),
		spectators:   make(map[*websocket.Conn]*spectator),
		dailyCallCap: envInt("DAILY_CALL_CAP", 5000),
		pace:         envFloat("TABLE_PACE", 1),
		openHour:     envInt("TABLE_OPEN_HOUR", 0),
		closeHour:    envInt("TABLE_CLOSE_HOUR", 24),
	}
	if zone := os.Getenv("TABLE_TIMEZONE"); zone != "" && t.closeHour > t.openHour {
		loc, err := time.LoadLocation(zone)
		if err != nil {
			log.Printf("Ignoring table hours: unknown TABLE_TIMEZONE %q", zone)
		} else {
			t.hoursZone = loc
			log.Printf("Table hours: %s", t.hoursLabel())
		}
	}
	return t
}

func hourLabel(h int) string {
	switch {
	case h == 0 || h == 24:
		return "12am"
	case h == 12:
		return "12pm"
	case h < 12:
		return fmt.Sprintf("%dam", h)
	default:
		return fmt.Sprintf("%dpm", h-12)
	}
}

// hoursLabel describes the opening hours, or "" when the table is always open.
func (t *Table) hoursLabel() string {
	if t.hoursZone == nil {
		return ""
	}
	return fmt.Sprintf("%s to %s %s", hourLabel(t.openHour), hourLabel(t.closeHour), time.Now().In(t.hoursZone).Format("MST"))
}

func (t *Table) isOpen() bool {
	if t.hoursZone == nil {
		return true
	}
	h := time.Now().In(t.hoursZone).Hour()
	return h >= t.openHour && h < t.closeHour
}

// nextOpen is the next time the table opens after now. Only meaningful with hoursZone set.
func (t *Table) nextOpen(now time.Time) time.Time {
	now = now.In(t.hoursZone)
	open := time.Date(now.Year(), now.Month(), now.Day(), t.openHour, 0, 0, 0, t.hoursZone)
	if !open.After(now) {
		open = open.AddDate(0, 0, 1)
	}
	return open
}

// setNotice stores the notice and broadcasts it; an empty Kind clears it. Callers hold t.mu.
func (t *Table) setNotice(n TableNoticePayload) {
	t.notice = n
	t.broadcast(ServerMessage{Type: MsgTableNotice, Payload: n})
}

// waitForOpenHours blocks between hands while the table is closed for the day.
func (t *Table) waitForOpenHours() {
	closed := false
	for !t.isOpen() {
		if !closed {
			closed = true
			log.Printf("Table closed for the day (%s)", t.hoursLabel())
			t.mu.Lock()
			t.setNotice(TableNoticePayload{
				Kind:      "closed",
				Message:   fmt.Sprintf("The table is closed. It is open daily from %s.", t.hoursLabel()),
				ReopensAt: t.nextOpen(time.Now()).Format(time.RFC3339),
			})
			t.mu.Unlock()
		}
		time.Sleep(10 * time.Second)
	}
	if closed {
		log.Printf("Table open")
		t.mu.Lock()
		if t.notice.Kind == "closed" {
			t.setNotice(TableNoticePayload{})
		}
		t.mu.Unlock()
	}
}

// TableUsage is what the frontend's usage widget shows.
type TableUsage struct {
	CallsToday   int    `json:"callsToday"`
	DailyCallCap int    `json:"dailyCallCap"`
	Open         bool   `json:"open"`
	Hours        string `json:"hours,omitempty"`
	OpenHour     int    `json:"openHour"`
	CloseHour    int    `json:"closeHour"`
	Timezone     string `json:"timezone,omitempty"` // IANA zone of the hours; empty when always open
	Spectators   int    `json:"spectators"`
}

func (t *Table) Usage() TableUsage {
	t.mu.Lock()
	defer t.mu.Unlock()
	calls := t.calls
	if t.callsDay != time.Now().UTC().Format("2006-01-02") {
		calls = 0
	}
	u := TableUsage{
		CallsToday:   calls,
		DailyCallCap: t.dailyCallCap,
		Open:         t.isOpen(),
		Hours:        t.hoursLabel(),
		OpenHour:     t.openHour,
		CloseHour:    t.closeHour,
		Spectators:   len(t.spectators),
	}
	if t.hoursZone != nil {
		u.Timezone = t.hoursZone.String()
	}
	return u
}

func envInt(key string, fallback int) int {
	if v, err := strconv.Atoi(os.Getenv(key)); err == nil {
		return v
	}
	return fallback
}

func envFloat(key string, fallback float64) float64 {
	if v, err := strconv.ParseFloat(os.Getenv(key), 64); err == nil && v > 0 {
		return v
	}
	return fallback
}

// Join registers a spectator and sends them everything needed to catch up.
func (t *Table) Join(conn *websocket.Conn) {
	sp := &spectator{conn: conn, out: make(chan []byte, 64)}
	go sp.writeLoop()

	t.mu.Lock()
	defer t.mu.Unlock()
	t.spectators[conn] = sp
	log.Printf("Spectator joined (%d watching)", len(t.spectators))
	t.sendSnapshot(sp)
}

func (t *Table) Leave(conn *websocket.Conn) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if sp, ok := t.spectators[conn]; ok {
		close(sp.out)
		delete(t.spectators, conn)
		log.Printf("Spectator left (%d watching)", len(t.spectators))
	}
}

// Resend sends the current state to one spectator (their get_state request).
func (t *Table) Resend(conn *websocket.Conn) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if sp, ok := t.spectators[conn]; ok {
		t.sendSnapshot(sp)
	}
}

// Reject tells a spectator their message was not accepted.
func (t *Table) Reject(conn *websocket.Conn, message string) {
	t.mu.Lock()
	defer t.mu.Unlock()
	if sp, ok := t.spectators[conn]; ok {
		t.enqueue(sp, ServerMessage{Type: MsgError, Payload: ErrorPayload{Message: message}})
	}
}

// writeLoop is the only writer for a spectator's connection. It also pings so idle
// spectators are not dropped by the read deadline.
func (sp *spectator) writeLoop() {
	ping := time.NewTicker(30 * time.Second)
	defer ping.Stop()
	for {
		select {
		case data, ok := <-sp.out:
			if !ok {
				return
			}
			sp.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := sp.conn.WriteMessage(websocket.TextMessage, data); err != nil {
				sp.conn.Close()
				return
			}
		case <-ping.C:
			sp.conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
			if err := sp.conn.WriteMessage(websocket.PingMessage, nil); err != nil {
				sp.conn.Close()
				return
			}
		}
	}
}

// enqueue queues a message for one spectator. A spectator too slow to keep up is
// disconnected rather than allowed to hold up the table. Callers hold t.mu.
func (t *Table) enqueue(sp *spectator, msg ServerMessage) {
	data, err := json.Marshal(msg)
	if err != nil {
		log.Printf("Error marshaling message: %v", err)
		return
	}
	select {
	case sp.out <- data:
	default:
		sp.conn.Close()
	}
}

func (t *Table) broadcast(msg ServerMessage) {
	for _, sp := range t.spectators {
		t.enqueue(sp, msg)
	}
}

func (t *Table) stateMessage() ServerMessage {
	payload := ConvertGameState(t.gs)
	if t.gs.IsHandComplete() {
		if ms := int(time.Until(t.nextHandAt).Milliseconds()); ms > 0 {
			payload.NextHandInMs = ms
		}
	}
	return ServerMessage{Type: MsgGameState, Payload: payload}
}

func (t *Table) sendSnapshot(sp *spectator) {
	if t.gs == nil {
		return
	}
	t.enqueue(sp, t.stateMessage())
	for _, bc := range t.buttonCards {
		t.enqueue(sp, ServerMessage{Type: MsgButtonCard, Payload: bc})
	}
	if t.buttonWinner != nil {
		t.enqueue(sp, ServerMessage{Type: MsgButtonWinner, Payload: *t.buttonWinner})
	}
	if t.turn != nil {
		t.enqueue(sp, *t.turn)
	}
	if t.notice.Kind != "" {
		t.enqueue(sp, ServerMessage{Type: MsgTableNotice, Payload: t.notice})
	}
}

func (t *Table) sleep(d time.Duration) {
	time.Sleep(time.Duration(float64(d) * t.pace))
}

// waitForSpectators blocks while nobody is watching, so an empty table makes no LLM calls.
func (t *Table) waitForSpectators() {
	logged := false
	for {
		t.mu.Lock()
		n := len(t.spectators)
		t.mu.Unlock()
		if n > 0 {
			if logged {
				log.Printf("Table resumed")
			}
			return
		}
		if !logged {
			log.Printf("Table idle: no spectators")
			logged = true
		}
		time.Sleep(500 * time.Millisecond)
	}
}

// waitForBudget blocks once the day's LLM call cap is reached, until the next UTC day.
func (t *Table) waitForBudget() {
	for {
		today := time.Now().UTC().Format("2006-01-02")
		t.mu.Lock()
		if t.callsDay != today {
			t.callsDay = today
			t.calls = 0
		}
		if t.calls < t.dailyCallCap {
			if t.notice.Kind == "cap" {
				t.setNotice(TableNoticePayload{})
				log.Printf("Daily call cap reset, table resumed")
			}
			t.mu.Unlock()
			return
		}
		if t.notice.Kind != "cap" {
			log.Printf("Daily call cap reached (%d), table stopped", t.dailyCallCap)
			t.setNotice(TableNoticePayload{
				Kind:      "cap",
				Message:   "Daily LLM call limit reached.",
				ReopensAt: time.Now().UTC().Truncate(24 * time.Hour).Add(24 * time.Hour).Format(time.RFC3339),
			})
		}
		t.mu.Unlock()
		time.Sleep(10 * time.Second)
	}
}

// Run plays the table forever.
func (t *Table) Run() {
	if err := client.CheckLLMServiceHealth(); err != nil {
		log.Printf("!!! LLM service not available yet: %v", err)
	}

	t.startGame()
	for {
		t.playHand()
	}
}

func (t *Table) startGame() {
	t.mu.Lock()
	t.gs = game.NewGame(game.GameConfig{
		PlayerNames:   tablePlayers,
		StartingStack: tableStartingStack,
		Stakes:        game.Stakes{SmallBlind: tableSmallBlind, BigBlind: tableBigBlind},
	})
	cards := t.gs.DetermineButton()
	log.Printf("Shared table created: %s", t.gs.ID)
	t.broadcast(t.stateMessage())
	t.mu.Unlock()

	t.waitForSpectators()

	for _, bc := range cards {
		t.mu.Lock()
		payload := ButtonCardPayload{PlayerIdx: bc.PlayerIdx, PlayerName: bc.PlayerName, Card: bc.Card}
		t.buttonCards = append(t.buttonCards, payload)
		t.broadcast(ServerMessage{Type: MsgButtonCard, Payload: payload})
		t.mu.Unlock()
		t.sleep(buttonCardDelay)
	}

	t.mu.Lock()
	t.buttonWinner = &ButtonWinnerPayload{PlayerIdx: t.gs.ButtonIdx, PlayerName: t.gs.Players[t.gs.ButtonIdx].Name}
	log.Printf("Button goes to: %s", t.buttonWinner.PlayerName)
	t.broadcast(ServerMessage{Type: MsgButtonWinner, Payload: *t.buttonWinner})
	t.mu.Unlock()
	t.sleep(buttonWinnerDelay)
}

func (t *Table) playHand() {
	t.waitForOpenHours()
	t.waitForSpectators()

	t.mu.Lock()
	rebought := t.gs.RebuyBrokePlayers(tableStartingStack)
	if err := t.gs.StartHand(); err != nil {
		t.mu.Unlock()
		log.Printf("Could not start hand: %v", err)
		time.Sleep(5 * time.Second)
		return
	}
	t.recorder = newHandRecorder(t.gs, t.id, rebought)
	t.buttonCards = nil
	t.buttonWinner = nil
	t.turn = nil
	log.Printf("Started hand #%d", t.gs.HandNumber)
	t.broadcast(ServerMessage{Type: MsgHandStart, Payload: map[string]interface{}{"handNumber": t.gs.HandNumber}})
	t.broadcast(t.stateMessage())
	t.mu.Unlock()

	for {
		t.mu.Lock()
		t.settleStreets()
		done := t.gs.IsHandComplete() || !t.gs.IsWaitingForAction()
		t.mu.Unlock()
		if done {
			break
		}
		t.waitForSpectators()
		t.waitForBudget()
		t.playTurn()
	}

	t.mu.Lock()
	if !t.gs.IsHandComplete() {
		log.Printf("Hand #%d stalled on %s with nobody to act; dealing a new hand", t.gs.HandNumber, t.gs.Street)
	} else {
		t.saveHand()
	}
	wait := time.Until(t.nextHandAt)
	t.mu.Unlock()
	if wait > 0 {
		time.Sleep(wait)
	}
}

// saveHand hands the finished hand to the store. Hands played by the mock provider are
// only kept locally; they are not real model decisions. Callers hold t.mu.
func (t *Table) saveHand() {
	record, prompts := t.recorder.finish(t.gs)
	t.recorder = nil
	if len(record.Actions) == 0 {
		return
	}
	if _, toSupabase := t.store.saver.(*supabaseSaver); toSupabase && record.Config.Provider == "mock" {
		return
	}

	if record.Config.PromptVersion != t.promptVer {
		version, prompt, err := client.GetSystemPrompt()
		if err != nil {
			log.Printf("Could not fetch system prompt: %v", err)
		} else {
			t.promptVer, t.systemPrompt = version, prompt
		}
	}
	systemPrompt := ""
	if record.Config.PromptVersion == t.promptVer {
		systemPrompt = t.systemPrompt
	}
	t.store.Save(savedHand{Record: record, Prompts: prompts, SystemPrompt: systemPrompt})
}

// settleStreets advances past any street where the betting is already finished.
// Callers hold t.mu.
func (t *Table) settleStreets() {
	for i := 0; i < 5 && !t.gs.IsHandComplete() && !t.gs.IsWaitingForAction() && t.gs.NeedToAdvanceStreet(); i++ {
		t.advanceStreet()
	}
}

// advanceStreet moves to the next street and announces it, and the result if the hand
// ended. Callers hold t.mu.
func (t *Table) advanceStreet() {
	if err := t.gs.AdvanceStreet(); err != nil {
		log.Printf("Error advancing street: %v", err)
	}
	t.broadcast(ServerMessage{Type: MsgStreetChange, Payload: map[string]interface{}{"street": t.gs.Street.String()}})
	if t.gs.IsHandComplete() {
		t.nextHandAt = time.Now().Add(time.Duration(float64(postActionDelay+nextHandDelay) * t.pace))
		t.broadcast(ServerMessage{Type: MsgHandComplete, Payload: HandCompletePayload{
			Winners:    convertWinners(t.gs.Winners),
			HandNumber: t.gs.HandNumber,
		}})
	}
}

// playTurn runs one LLM turn on the shared clock: thinking, reasoning, then the action.
func (t *Table) playTurn() {
	t.mu.Lock()
	playerIdx := t.gs.CurrentPlayerIdx
	playerName := t.gs.Players[playerIdx].Name
	validActions := buildLLMValidActions(t.gs)
	prompt := t.gs.GetLLMPrompt(playerName, validActions)
	t.recorder.beginDecision(t.gs, validActions, prompt)
	thinking := ServerMessage{Type: MsgLLMThinking, Payload: LLMThinkingPayload{PlayerIdx: playerIdx, PlayerName: playerName}}
	t.turn = &thinking
	t.broadcast(thinking)
	t.mu.Unlock()

	start := time.Now()
	ask := func(prompt string) (*client.LLMDecisionResponse, error) {
		t.mu.Lock()
		t.calls++
		t.mu.Unlock()
		return client.GetLLMDecision(playerName, prompt, validActions)
	}
	// Reading t.gs without the lock is safe here: only this goroutine changes it.
	turn := decideLLMTurn(t.gs, prompt, ask)
	decision := turn.decision
	log.Printf("%s: %s %d (%dms)", playerName, decision.Action, decision.Amount, time.Since(start).Milliseconds())
	if remaining := time.Duration(float64(thinkingDuration)*t.pace) - time.Since(start); remaining > 0 {
		time.Sleep(remaining)
	}

	shownAction, shownAmount := decision.Action, decision.Amount
	if turn.fallback {
		shownAction, shownAmount = turn.action.Type.String(), 0
	}
	t.mu.Lock()
	acted := ServerMessage{Type: MsgLLMAction, Payload: LLMActionPayload{
		PlayerIdx:  playerIdx,
		PlayerName: playerName,
		Action:     shownAction,
		Amount:     shownAmount,
		Reason:     decision.Reason,
	}}
	t.turn = &acted
	t.broadcast(acted)
	t.mu.Unlock()

	reasoning := time.Duration(len(decision.Reason))*25*time.Millisecond + 200*time.Millisecond
	t.sleep(min(max(reasoning, minReasoning), maxReasoning))

	t.mu.Lock()
	if err := t.gs.ProcessAction(turn.action); err != nil {
		// Not expected: decideLLMTurn already checked the action against this state.
		log.Printf("Error processing LLM action: %v", err)
		turn.fallback = true
		t.gs.ProcessAction(game.Action{Type: game.ActionFold, PlayerIdx: playerIdx})
	}
	t.recorder.endDecision(t.gs, turn)
	if t.gs.NeedToAdvanceStreet() {
		t.advanceStreet()
	}
	t.turn = nil
	t.broadcast(t.stateMessage())
	t.mu.Unlock()

	t.sleep(postActionDelay)
}

// llmTurn is one model decision and the move the engine will apply for it.
type llmTurn struct {
	decision   *client.LLMDecisionResponse // the reply to record (the retry's, if there was one)
	action     game.Action
	serviceErr bool // the LLM service could not be reached
	retried    bool // the first reply was unparseable or illegal, so the model was asked again
	fallback   bool // no usable reply: action is CHECK when legal, otherwise FOLD
}

// decideLLMTurn asks the current player's model for a move. An unparseable or illegal
// reply is retried once with the engine's reason appended to the prompt; if the retry is
// bad too, the player checks when checking is legal and folds otherwise. It only reads gs.
func decideLLMTurn(gs *game.GameState, prompt string, ask func(prompt string) (*client.LLMDecisionResponse, error)) llmTurn {
	idx := gs.CurrentPlayerIdx
	name := gs.Players[idx].Name
	d, err := ask(prompt)
	if err != nil {
		log.Printf("❌ LLM ERROR for %s: %v", name, err)
		return llmTurn{
			decision:   &client.LLMDecisionResponse{Action: "FOLD", Reason: "LLM service error"},
			action:     fallbackAction(gs, idx),
			serviceErr: true,
			fallback:   true,
		}
	}

	turn := llmTurn{}
	action, reason := checkLLMDecision(gs, idx, d)
	if reason != "" {
		log.Printf("%s: invalid reply (%s), asking again", name, reason)
		turn.retried = true
		if retry, err := ask(prompt + "\n\nYour previous reply was invalid: " + reason + ". Reply again."); err != nil {
			log.Printf("❌ LLM ERROR for %s on retry: %v", name, err)
		} else {
			d = combineRetry(d, retry)
			action, reason = checkLLMDecision(gs, idx, d)
		}
	}
	if reason != "" {
		log.Printf("%s: invalid reply again (%s), falling back", name, reason)
		action, turn.fallback = fallbackAction(gs, idx), true
	}
	turn.decision, turn.action = d, action
	return turn
}

// checkLLMDecision turns a reply into an action, or says why the engine cannot apply it.
func checkLLMDecision(gs *game.GameState, idx int, d *client.LLMDecisionResponse) (game.Action, string) {
	if d.Status == "unparseable" {
		return game.Action{}, "no ACTION line was found"
	}
	actionType, ok := ParseActionType(d.Action)
	if !ok {
		return game.Action{}, fmt.Sprintf("%q is not a legal action", d.Action)
	}
	action := game.Action{Type: actionType, Amount: d.Amount, PlayerIdx: idx}
	if err := gs.CheckAction(action); err != nil {
		return action, err.Error()
	}
	return action, ""
}

// fallbackAction is CHECK when checking is legal, otherwise FOLD.
func fallbackAction(gs *game.GameState, idx int) game.Action {
	check := game.Action{Type: game.ActionCheck, PlayerIdx: idx}
	if gs.CheckAction(check) == nil {
		return check
	}
	return game.Action{Type: game.ActionFold, PlayerIdx: idx}
}

// combineRetry keeps the retry's reply, with both raw replies and the cost of both calls.
func combineRetry(first, retry *client.LLMDecisionResponse) *client.LLMDecisionResponse {
	d := *retry
	d.Raw = first.Raw + "\n\n--- retry ---\n" + retry.Raw
	d.LatencyMs += first.LatencyMs
	d.TokensIn = addPtr(first.TokensIn, retry.TokensIn)
	d.TokensOut = addPtr(first.TokensOut, retry.TokensOut)
	d.CostUSD = addPtr(first.CostUSD, retry.CostUSD)
	return &d
}

func addPtr[T int | float64](a, b *T) *T {
	if a == nil {
		return b
	}
	if b == nil {
		return a
	}
	sum := *a + *b
	return &sum
}

// buildLLMValidActions converts game valid actions to LLM-friendly format
func buildLLMValidActions(gs *game.GameState) []game.LLMValidAction {
	validActions := gs.GetValidActions()
	var llmActions []game.LLMValidAction

	for _, va := range validActions {
		actionType := va.Type.String()

		if va.Type == game.ActionRaise {
			if gs.CurrentBet == 0 {
				actionType = "BET"
			} else {
				actionType = "RAISE"
			}
		}

		llmAction := game.LLMValidAction{
			Type: actionType,
		}
		if va.Type == game.ActionCall {
			llmAction.Amount = va.MinAmount
			llmAction.Description = fmt.Sprintf("match the current bet of %d", va.MinAmount)
		} else if va.Type == game.ActionRaise {
			llmAction.Min = va.MinAmount
			llmAction.Max = va.MaxAmount
			llmAction.Description = fmt.Sprintf("choose ANY amount between %d and %d", va.MinAmount, va.MaxAmount)
		} else if va.Type == game.ActionAllIn {
			llmAction.Amount = va.MaxAmount
			llmAction.Description = fmt.Sprintf("put all %d chips in", va.MaxAmount)
		} else if va.Type == game.ActionFold {
			llmAction.Description = "give up your hand"
		} else if va.Type == game.ActionCheck {
			llmAction.Description = "pass without betting"
		}
		llmActions = append(llmActions, llmAction)
	}

	return llmActions
}
