// The shared spectator table: one game that the server starts at boot and plays forever,
// watched or not, inside its opening hours and daily call cap. The server owns the clock,
// releasing each LLM turn on a timer and publishing it to the hub (stream.go), so everyone
// watches the same moment and late joiners get the current state. Started by server.go.
package api

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"time"

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

// Seats the table when the LLM service cannot say who is seated (llm/registry.py
// DEFAULT_LINEUP). The real lineup comes from GET /models at startup; see lineup.
var defaultPlayers = []string{
	"GPT-OSS 20B", "Claude Haiku 5.5", "Gemma 3 12B", "Llama 3.1 8B", "Mistral Nemo",
	"DeepSeek V4 Flash", "Phi-4", "Qwen 3.7 Flash", "Cohere Command R7B",
}

const (
	tableStartingStack = 2000
	tableSmallBlind    = 5
	tableBigBlind      = 10
)

type Table struct {
	mu           sync.Mutex
	gs           *game.GameState
	hub          *hub
	buttonCards  []ButtonCardPayload
	buttonWinner *ButtonWinnerPayload
	turn         *ServerMessage // the last llm_thinking or llm_action this hand
	turns        int            // turns started this hand; the "turn" number of llm_thinking and llm_action
	turnApplied  bool           // turn is an llm_action already applied to the table
	nextHandAt   time.Time
	notice       TableNoticePayload // shown to everyone while the table is stopped; Kind "" when running

	dailyCallCap int
	calls        int
	callsDay     string
	pace         float64

	// Hand history: every finished hand is recorded and saved
	id           string
	saver        handSaver
	saveWait     time.Duration // first wait between save attempts; doubles each time
	onSaved      func(history.HandRecord)
	recorder     *handRecorder
	rebought     []int  // seats topped up for the hand being played, or for a voided one: flagged on the next saved hand
	promptVer    string // version of the cached system prompt
	systemPrompt string

	// Daily opening hours, e.g. 9 to 21 in America/New_York. hoursZone is nil when the
	// table is always open.
	openHour  int
	closeHour int
	hoursZone *time.Location

	seated []string // the lineup, from lineup(); set before Run
}

// onSaved, if set, is called with each hand once it is saved.
func NewTable(h *hub, onSaved func(history.HandRecord)) *Table {
	idBytes := make([]byte, 8)
	rand.Read(idBytes)
	t := &Table{
		id:           "tbl_" + hex.EncodeToString(idBytes),
		hub:          h,
		saver:        newSaver(),
		saveWait:     firstSaveWait,
		onSaved:      onSaved,
		dailyCallCap: envInt("DAILY_CALL_CAP", 5000),
		pace:         envFloat("TABLE_PACE", 1),
		openHour:     envInt("TABLE_OPEN_HOUR", 0),
		closeHour:    envInt("TABLE_CLOSE_HOUR", 24),
		seated:       defaultPlayers,
	}
	if zone := os.Getenv("TABLE_TIMEZONE"); zone != "" && t.closeHour > t.openHour {
		loc, err := time.LoadLocation(zone)
		if err != nil {
			log.Printf("Ignoring table hours: unknown TABLE_TIMEZONE %q", zone)
		} else {
			t.hoursZone = loc
			log.Printf("Table hours: %d to %d %s", t.openHour, t.closeHour, zone)
		}
	}
	return t
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

// setNotice stores the notice and publishes it; an empty Kind clears it. Callers hold t.mu.
func (t *Table) setNotice(n TableNoticePayload) {
	t.notice = n
	t.publish(ServerMessage{Type: MsgTableNotice, Payload: n})
}

// waitForOpenHours blocks between hands while the table is closed for the day.
func (t *Table) waitForOpenHours() {
	closed := false
	for !t.isOpen() {
		if !closed {
			closed = true
			log.Printf("Table closed for the day (open %d to %d %s)", t.openHour, t.closeHour, t.hoursZone)
			t.mu.Lock()
			t.setNotice(TableNoticePayload{
				Kind:      "closed",
				Message:   "The table is closed.",
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
		OpenHour:     t.openHour,
		CloseHour:    t.closeHour,
		Spectators:   int(t.hub.open.Load()),
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

// publish sends one table step to every viewer and swaps in the table's snapshot with it.
// Callers hold t.mu.
func (t *Table) publish(msgs ...ServerMessage) {
	snap := &tableSnap{
		State:        ConvertGameState(t.gs),
		Turn:         t.turn,
		TurnApplied:  t.turnApplied,
		ButtonCards:  append([]ButtonCardPayload{}, t.buttonCards...),
		ButtonWinner: t.buttonWinner,
	}
	if t.notice.Kind != "" {
		n := t.notice
		snap.Notice = &n
	}
	if t.gs.IsHandComplete() {
		snap.nextHandAt = t.nextHandAt
	}
	t.hub.publish(t.id, snap, nil, msgs...)
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

func (t *Table) sleep(d time.Duration) {
	time.Sleep(time.Duration(float64(d) * t.pace))
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
	t.startGame()
	for {
		t.playHand()
	}
}

func (t *Table) startGame() {
	t.mu.Lock()
	t.gs = game.NewGame(game.GameConfig{
		PlayerNames:   t.seated,
		StartingStack: tableStartingStack,
		Stakes:        game.Stakes{SmallBlind: tableSmallBlind, BigBlind: tableBigBlind},
	})
	cards := t.gs.DetermineButton()
	log.Printf("Shared table created: %s", t.gs.ID)
	t.publish(t.stateMessage())
	t.mu.Unlock()

	for _, bc := range cards {
		t.mu.Lock()
		payload := ButtonCardPayload{PlayerIdx: bc.PlayerIdx, PlayerName: bc.PlayerName, Card: bc.Card}
		t.buttonCards = append(t.buttonCards, payload)
		t.publish(ServerMessage{Type: MsgButtonCard, Payload: payload})
		t.mu.Unlock()
		t.sleep(buttonCardDelay)
	}

	t.mu.Lock()
	t.buttonWinner = &ButtonWinnerPayload{PlayerIdx: t.gs.ButtonIdx, PlayerName: t.gs.Players[t.gs.ButtonIdx].Name}
	log.Printf("Button goes to: %s", t.buttonWinner.PlayerName)
	t.publish(ServerMessage{Type: MsgButtonWinner, Payload: *t.buttonWinner})
	t.mu.Unlock()
	t.sleep(buttonWinnerDelay)
}

// lineup asks the LLM service who is seated: LINEUP in production, a rotation over the
// whole roster with the mock provider. The session index it sends is the number of
// sessions already in the local hand log (0 when hands go to Supabase).
func (t *Table) lineup() []string {
	session := 0
	if fs, ok := t.saver.(*fileSaver); ok {
		// shortcut: parses the whole local log once at startup; fine for dev-sized files.
		hands, err := loadHandFile(filepath.Join(fs.dir, "hands.jsonl"))
		if err != nil {
			log.Printf("Lineup: reading local hands: %v", err)
		}
		ids := map[string]bool{}
		for _, h := range hands {
			ids[h.TableID] = true
		}
		session = len(ids)
	}
	return seatedPlayers(func() ([]string, error) { return client.GetSeated(session) }, lineupTries, lineupWait)
}

// About a minute: long enough for the LLM service to boot after the engine, so a custom
// LINEUP is not silently replaced by the default nine.
const (
	lineupTries = 12
	lineupWait  = 5 * time.Second
)

// seatedPlayers returns what fetch reports, asking up to tries times wait apart, or
// defaultPlayers when every attempt fails.
func seatedPlayers(fetch func() ([]string, error), tries int, wait time.Duration) []string {
	var err error
	for i := 0; i < tries; i++ {
		if i > 0 {
			time.Sleep(wait)
		}
		var names []string
		if names, err = fetch(); err == nil && len(names) < 2 {
			err = fmt.Errorf("only %d seated", len(names))
		}
		if err == nil {
			log.Printf("Lineup: %v", names)
			return names
		}
	}
	log.Printf("!!! Lineup unavailable after %d tries (%v); seating the default nine, LINEUP is ignored until restart", tries, err)
	return defaultPlayers
}

// dealHand deals the next hand and publishes hand_start with it; the last hand's turn ends here.
func (t *Table) dealHand() (handStart, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	t.rebought = append(t.rebought, t.gs.RebuyBrokePlayers(tableStartingStack)...)
	start := startOf(t.gs)
	if err := t.gs.StartHand(); err != nil {
		return start, err
	}
	t.recorder = newHandRecorder(t.gs, t.id, t.rebought)
	t.buttonCards = nil
	t.buttonWinner = nil
	t.turn, t.turnApplied, t.turns = nil, false, 0
	if t.notice.Kind == "outage" {
		t.setNotice(TableNoticePayload{}) // the probe hand plays live; if it fails too, the notice is set again
	}
	log.Printf("Started hand #%d", t.gs.HandNumber)
	t.publish(ServerMessage{Type: MsgHandStart, Payload: map[string]interface{}{"handNumber": t.gs.HandNumber}}, t.stateMessage())
	return start, nil
}

func (t *Table) playHand() {
	t.waitForOpenHours()

	start, err := t.dealHand()
	if err != nil {
		log.Printf("Could not start hand: %v", err)
		time.Sleep(5 * time.Second)
		return
	}

	for {
		t.mu.Lock()
		t.settleStreets()
		done := t.gs.IsHandComplete() || !t.gs.IsWaitingForAction()
		t.mu.Unlock()
		if done {
			break
		}
		t.waitForBudget()
		t.playTurn()
	}

	// Outside every lock: the save can wait on the database for as long as it is down.
	if !t.gs.IsHandComplete() {
		log.Printf("Hand #%d stalled on %s with nobody to act; dealing a new hand", t.gs.HandNumber, t.gs.Street)
	} else if t.saveHand() {
		// An outage: wait before the next hand, the probe; dealing it clears the notice.
		wait := time.Duration(float64(outagePause) * t.pace)
		t.mu.Lock()
		start.restore(t.gs)
		t.nextHandAt = time.Now().Add(wait) // the countdown and the notice name the same time
		t.notice = TableNoticePayload{
			Kind:      "outage",
			Message:   "The models can't be reached, so that hand doesn't count.",
			ReopensAt: t.nextHandAt.UTC().Format(time.RFC3339),
		}
		t.publish(ServerMessage{Type: MsgTableNotice, Payload: t.notice}, t.stateMessage())
		t.mu.Unlock()
		time.Sleep(wait) // t.rebought is kept: the restored stacks still hold those rebuys
		return
	}
	t.rebought = nil
	if wait := time.Until(t.nextHandAt); wait > 0 {
		time.Sleep(wait)
	}
}

// outagePause is how long the table waits after a voided hand before dealing the next one.
const outagePause = 5 * time.Minute

// handStart is what a voided hand puts back: every stack, winnings and the button, as they
// were before the blinds, so the next hand is dealt as if the voided one never was.
type handStart struct {
	stacks, winnings []int
	button           int
}

func startOf(gs *game.GameState) handStart {
	s := handStart{button: gs.ButtonIdx}
	for _, p := range gs.Players {
		s.stacks = append(s.stacks, p.Stack)
		s.winnings = append(s.winnings, p.Winnings)
	}
	return s
}

func (s handStart) restore(gs *game.GameState) {
	for i := range gs.Players {
		gs.Players[i].Stack = s.stacks[i]
		gs.Players[i].Winnings = s.winnings[i]
	}
	gs.ButtonIdx = s.button
}

// outage reports whether a hand had no model decision at all because the calls failed: not
// one reply was played, and at least one turn failed at the provider or the LLM service.
// Such a hand measures nothing about the models; a hand of the models' own misses does.
func outage(r history.HandRecord) bool {
	failed := false
	for _, a := range r.Actions {
		switch a.Status {
		case "ok":
			return false
		case "timeout", "api_error", "service_error":
			failed = true
		}
	}
	return failed
}

// saveHand saves the finished hand and returns once it is saved. Hands played by the mock
// provider are only kept locally; they are not real model decisions. A hand that was an
// outage (see outage) is voided instead: not saved, and the caller puts every stack and the
// button back to start. Only the table goroutine changes t.gs and t.recorder, so no lock.
func (t *Table) saveHand() (voided bool) {
	record, prompts := t.recorder.finish(t.gs)
	t.recorder = nil
	if outage(record) {
		log.Printf("Hand #%d voided: no model call succeeded", t.gs.HandNumber)
		return true
	}
	// shortcut: a hand with no decision is not saved; heads-up, a blind posted all-in makes
	// such a hand and its chips go unrecorded. Save it once two-seat tables exist.
	if len(record.Actions) == 0 {
		return false
	}
	if _, toSupabase := t.saver.(*supabaseSaver); toSupabase && record.Config.Provider == "mock" {
		return false
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
	t.saveWithRetry(savedHand{Record: record, Prompts: prompts, SystemPrompt: systemPrompt})
	return false
}

// settleStreets advances past any street where the betting is already finished.
// Callers hold t.mu.
func (t *Table) settleStreets() {
	for i := 0; i < 5 && !t.gs.IsHandComplete() && !t.gs.IsWaitingForAction() && t.gs.NeedToAdvanceStreet(); i++ {
		t.publish(append(t.advanceStreet(), t.stateMessage())...)
	}
}

// advanceStreet moves to the next street and returns its announcement, and the result if
// the hand ended, for the caller to publish. Callers hold t.mu.
func (t *Table) advanceStreet() []ServerMessage {
	if err := t.gs.AdvanceStreet(); err != nil {
		log.Printf("Error advancing street: %v", err)
	}
	msgs := []ServerMessage{{Type: MsgStreetChange, Payload: map[string]interface{}{"street": t.gs.Street.String()}}}
	if t.gs.IsHandComplete() {
		t.nextHandAt = time.Now().Add(time.Duration(float64(postActionDelay+nextHandDelay) * t.pace))
		msgs = append(msgs, ServerMessage{Type: MsgHandComplete, Payload: HandCompletePayload{
			Winners:    convertWinners(t.gs.Winners),
			HandNumber: t.gs.HandNumber,
		}})
	}
	return msgs
}

var askLLM = client.GetLLMDecision // a test swaps in scripted replies

// playTurn runs one LLM turn on the shared clock: thinking, reasoning, then the action.
func (t *Table) playTurn() {
	t.mu.Lock()
	playerIdx := t.gs.CurrentPlayerIdx
	playerName := t.gs.Players[playerIdx].Name
	validActions := buildLLMValidActions(t.gs)
	req := buildDecisionRequest(t.gs, validActions)
	t.recorder.beginDecision(t.gs, validActions)
	t.turns++
	turnNum := t.turns
	thinking := ServerMessage{Type: MsgLLMThinking, Payload: LLMThinkingPayload{Turn: turnNum, PlayerIdx: playerIdx, PlayerName: playerName}}
	t.turn, t.turnApplied = &thinking, false
	t.publish(thinking)
	t.mu.Unlock()

	start := time.Now()
	t.mu.Lock()
	t.calls++
	t.mu.Unlock()
	// Reading t.gs without the lock is safe here: only this goroutine changes it.
	turn := decideLLMTurn(t.gs, func() (*client.LLMDecisionResponse, error) { return askLLM(req) })
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
	if decision.Retried {
		t.calls++ // the service asked the model a second time
	}
	acted := ServerMessage{Type: MsgLLMAction, Payload: LLMActionPayload{
		Turn:       turnNum,
		PlayerIdx:  playerIdx,
		PlayerName: playerName,
		Action:     shownAction,
		Amount:     shownAmount,
		Reason:     decision.Reason,
	}}
	t.turn = &acted
	t.publish(acted)
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
	var msgs []ServerMessage
	if t.gs.NeedToAdvanceStreet() {
		msgs = t.advanceStreet()
	}
	t.turnApplied = true // the action stays the turn, shown as revealed, until the next llm_thinking or hand_start
	t.publish(append(msgs, t.stateMessage())...)
	t.mu.Unlock()

	t.sleep(postActionDelay)
}

// llmTurn is one model decision and the move the engine will apply for it.
type llmTurn struct {
	decision   *client.LLMDecisionResponse // the service's reply: the model's move, or its fallback
	action     game.Action
	serviceErr bool // the LLM service could not be reached
	fallback   bool // action is not the model's own choice: CHECK when legal, otherwise FOLD
}

// decideLLMTurn asks the LLM service for the current player's move. The service owns the
// prompts, parsing and retries and reports a status; the engine checks the move against
// the rules anyway and falls back (check when legal, else fold) if it cannot be applied.
func decideLLMTurn(gs *game.GameState, ask func() (*client.LLMDecisionResponse, error)) llmTurn {
	idx := gs.CurrentPlayerIdx
	name := gs.Players[idx].Name
	d, err := ask()
	if err != nil {
		log.Printf("❌ LLM ERROR for %s: %v", name, err)
		return llmTurn{
			decision:   &client.LLMDecisionResponse{Action: "FOLD", Status: "service_error"},
			action:     fallbackAction(gs, idx),
			serviceErr: true,
			fallback:   true,
		}
	}
	turn := llmTurn{decision: d}
	action, reason := checkLLMDecision(gs, idx, d)
	switch {
	case d.Status != "ok":
		log.Printf("%s: %s (%s), falling back", name, d.Status, d.Error)
	case reason != "":
		// Not expected: the service checked the reply against the legal list the engine sent.
		log.Printf("%s: service returned an unplayable move (%s), falling back", name, reason)
	}
	if d.Status != "ok" || reason != "" {
		action, turn.fallback = fallbackAction(gs, idx), true
	}
	turn.action = action
	return turn
}

// checkLLMDecision turns a reply into an action, or says why the engine cannot apply it.
func checkLLMDecision(gs *game.GameState, idx int, d *client.LLMDecisionResponse) (game.Action, string) {
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

// buildLLMValidActions converts game valid actions to LLM-friendly format
func buildLLMValidActions(gs *game.GameState) []game.LLMValidAction {
	validActions := gs.GetValidActions()
	var llmActions []game.LLMValidAction
	player := gs.Players[gs.CurrentPlayerIdx]

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
			if toCall := gs.CurrentBet - player.CurrentBet; toCall >= player.Stack {
				// The bet covers the stack: the engine plays CALL as an all-in, so offer it.
				llmActions = append(llmActions, game.LLMValidAction{
					Type: "CALL", Amount: player.Stack, Description: fmt.Sprintf("call all-in for your last %d", player.Stack),
				})
			}
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
