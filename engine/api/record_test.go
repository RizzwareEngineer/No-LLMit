package api

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"github.com/rizzwareengineer/no-LLMit/engine/client"
	"github.com/rizzwareengineer/no-LLMit/engine/game"
	"github.com/rizzwareengineer/no-LLMit/engine/history"
)

// abc is the three seats most recorder tests play.
var abc = []string{"A", "B", "C"}

// playTable drives one hand through the recorder the same way the table does, with each
// step's reply scripted, the given players and starting stacks (nil: 2000 each), and the
// hole cards and five board cards fixed (nil keeps the shuffled ones).
func playTable(t *testing.T, names []string, stacks []int, holes [][]string, board []string, script []client.LLMDecisionResponse) (history.HandRecord, []HandPrompt) {
	t.Helper()
	gs := game.NewGame(game.GameConfig{
		PlayerNames:   names,
		StartingStack: 2000,
		Stakes:        game.Stakes{SmallBlind: 5, BigBlind: 10},
	})
	if err := gs.StartHand(); err != nil {
		t.Fatal(err)
	}
	for i, h := range holes {
		gs.Players[i].HoleCards = mustCards(t, h)
	}
	for i, st := range stacks {
		gs.Players[i].Stack = st - gs.Players[i].TotalBetThisHand // blinds are already posted
	}
	setBoard := func(n int) { // replace the first n board cards with the fixed ones
		if board != nil {
			gs.CommunityCards = append(mustCards(t, board[:n]), gs.CommunityCards[n:]...)
		}
	}
	rec := newHandRecorder(gs, "tbl_test", nil)

	// Each decision takes the next scripted reply (the LLM service's whole answer for the
	// turn, retries included), with the prompt the service would have rendered.
	ask := func() (*client.LLMDecisionResponse, error) {
		if len(script) == 0 {
			t.Fatal("script ran out")
		}
		reply := script[0]
		script = script[1:]
		idx := gs.CurrentPlayerIdx
		reply.Provider, reply.PromptVersion, reply.Model = "test", "v1", "model-"+gs.Players[idx].Name
		reply.Prompt = fmt.Sprintf("You are Player %d (%s).\n\nLegal actions:\n- FOLD", idx+1, gs.PositionName(idx))
		return &reply, nil
	}
	for len(script) > 0 {
		if gs.IsHandComplete() {
			t.Fatal("script is longer than the hand")
		}
		legal := buildLLMValidActions(gs)
		rec.beginDecision(gs, legal)

		turn := decideLLMTurn(gs, ask)
		*gs = *turn.next
		rec.endDecision(turn)

		if gs.NeedToAdvanceStreet() {
			if gs.CountActivePlayers() > 1 && gs.CountActiveNonAllInPlayers() <= 1 && board != nil {
				gs.CommunityCards = mustCards(t, board) // all in: the runout deals nothing more
			}
			if err := gs.AdvanceStreet(); err != nil {
				t.Fatal(err)
			}
			setBoard(len(gs.CommunityCards))
		}
	}
	if !gs.IsHandComplete() {
		t.Fatal("hand did not finish")
	}
	return rec.finish(gs)
}

func mustCards(t *testing.T, ss []string) []game.Card {
	t.Helper()
	var cs []game.Card
	for _, s := range ss {
		c, err := game.ParseCard(s)
		if err != nil {
			t.Fatal(err)
		}
		cs = append(cs, c)
	}
	return cs
}

func reply(action string, amount int) client.LLMDecisionResponse {
	return client.LLMDecisionResponse{Action: action, Amount: amount, Reason: "because", Raw: "ACTION: " + action, Status: "ok"}
}

func netSum(r history.HandRecord) int {
	sum := 0
	for _, n := range r.Result.Net {
		sum += n
	}
	return sum
}

func TestHandRecordThroughShowdown(t *testing.T) {
	// Button A opens, both blinds call, C bets the flop and A calls, then it checks down.
	record, prompts := playTable(t, abc, nil, nil, nil, []client.LLMDecisionResponse{
		reply("RAISE", 30), reply("CALL", 0), reply("CALL", 0),
		reply("CHECK", 0), reply("RAISE", 40), reply("CALL", 0), reply("FOLD", 0),
		reply("CHECK", 0), reply("CHECK", 0),
		reply("CHECK", 0), reply("CHECK", 0),
	})

	if len(record.Actions) != 11 || len(prompts) != 11 {
		t.Fatalf("want 11 actions and prompts, got %d and %d", len(record.Actions), len(prompts))
	}
	streets := map[string]int{}
	for i, a := range record.Actions {
		streets[a.Street]++
		if a.N != i+1 || a.PromptID != prompts[i].PromptID || a.Status != "ok" {
			t.Errorf("action %d: n=%d prompt_id=%s status=%s", i+1, a.N, a.PromptID, a.Status)
		}
		if !strings.Contains(prompts[i].Prompt, fmt.Sprintf("You are Player %d", a.Seat+1)) || prompts[i].RawReply == "" {
			t.Errorf("action %d: prompt or reply missing", i+1)
		}
	}
	if streets["preflop"] != 3 || streets["flop"] != 4 || streets["turn"] != 2 || streets["river"] != 2 {
		t.Errorf("actions per street: %v", streets)
	}

	if got := record.Actions[0].Applied; got != (history.AppliedAction{Type: "RAISE", Amount: 30}) {
		t.Errorf("preflop open: %+v", got)
	}
	if got := record.Actions[1].Applied; got != (history.AppliedAction{Type: "CALL", Amount: 25}) {
		t.Errorf("small blind call: %+v", got)
	}
	if got := record.Actions[4].Applied; got != (history.AppliedAction{Type: "BET", Amount: 40}) {
		t.Errorf("flop bet should be recorded as BET: %+v", got)
	}
	if a := record.Actions[4]; a.PotBefore != 90 || a.ToCall != 0 || a.StackBefore != 1970 {
		t.Errorf("flop bet situation: pot %d, to call %d, stack %d", a.PotBefore, a.ToCall, a.StackBefore)
	}

	if len(record.Seats) != 3 || len(record.Deck) != 52 || len(record.Board) != 5 {
		t.Errorf("seats %d, deck %d, board %d", len(record.Seats), len(record.Deck), len(record.Board))
	}
	for _, s := range record.Seats {
		if len(s.HoleCards) != 2 || s.StackStart != 2000 || s.Model != "model-"+s.Name {
			t.Errorf("seat %+v", s)
		}
	}
	if len(record.Result.Showdown) != 2 {
		t.Errorf("two players reached showdown, got %d", len(record.Result.Showdown))
	}
	potTotal := 0
	for _, p := range record.Result.Pots {
		potTotal += p.Amount
	}
	if potTotal != 170 {
		t.Errorf("pots should total 170, got %d", potTotal)
	}
	if netSum(record) != 0 {
		t.Errorf("net should sum to zero: %v", record.Result.Net)
	}
	if record.Config.Provider != "test" || record.Config.PromptVersion != "v1" || record.HandID != "tbl_test-000001" {
		t.Errorf("config %+v, id %s", record.Config, record.HandID)
	}

	// The prompt text lives only in the prompts, never in the hand record itself.
	doc, _ := json.Marshal(record)
	if strings.Contains(string(doc), "Legal actions:") {
		t.Error("hand record should not contain prompt text")
	}
}

// missed is the service's answer after the model's own miss twice: the last parsed reply
// with the status saying why it cannot be played.
func missed(status, action string, amount int) client.LLMDecisionResponse {
	r := reply(action, amount)
	r.Status, r.Retried, r.Raw = status, true, "ACTION: "+action+"\n\n--- retry ---\nACTION: "+action
	r.RetryPrompt = "Your reply was invalid: ..."
	return r
}

func TestHandRecordUncontestedAndFallbacks(t *testing.T) {
	// A twice sends a raise below the minimum; B twice sends a reply with no action.
	// Neither can check, so both fall back to a fold.
	record, prompts := playTable(t, abc, nil, nil, nil, []client.LLMDecisionResponse{missed("illegal", "RAISE", 12), missed("unparseable", "FOLD", 0)})

	if a := record.Actions[0]; a.Status != "illegal" || !a.Retried || a.Applied.Type != "FOLD" || a.Parsed.Action != "RAISE" {
		t.Errorf("illegal raise: %+v", a)
	}
	if a := record.Actions[1]; a.Status != "unparseable" || !a.Retried || a.Applied.Type != "FOLD" {
		t.Errorf("unparseable reply: %+v", a)
	}
	if !strings.Contains(prompts[0].RawReply, "--- retry ---") || prompts[0].RetryPrompt == "" {
		t.Errorf("both raw replies and the retry message should be kept: %+v", prompts[0])
	}
	if len(record.Result.Pots) != 1 || record.Result.Pots[0].Amount != 15 {
		t.Errorf("big blind should win the 15 chip pot: %+v", record.Result.Pots)
	}
	if len(record.Result.Showdown) != 0 || netSum(record) != 0 {
		t.Errorf("showdown %v, net %v", record.Result.Showdown, record.Result.Net)
	}
}

func TestParseActionType(t *testing.T) {
	if got, ok := ParseActionType("ALL_IN"); !ok || got != game.ActionAllIn {
		t.Errorf("ParseActionType(ALL_IN) = %v, %v; want ALL-IN", got, ok)
	}
	for _, s := range []string{"BET", "SHOVE", "", "fold", "ALL-IN"} {
		if _, ok := ParseActionType(s); ok {
			t.Errorf("ParseActionType(%q) should not be ok", s)
		}
	}
}

func TestAllInReplyIsApplied(t *testing.T) {
	record, _ := playTable(t, abc, nil, nil, nil, []client.LLMDecisionResponse{reply("ALL_IN", 0), reply("FOLD", 0), reply("FOLD", 0)})
	if a := record.Actions[0]; a.Applied.Type != "ALL_IN" || a.Applied.Amount != 2000 || a.Status != "ok" || a.Retried {
		t.Errorf("model chose ALL_IN: %+v", a)
	}
}

func TestIllegalRaiseFallsBackToCheckWhenFree(t *testing.T) {
	// Limped to the big blind, who twice "raises" by the 5-chip increment instead of a total.
	script := []client.LLMDecisionResponse{reply("CALL", 0), reply("CALL", 0), missed("illegal", "RAISE", 15)}
	for i := 0; i < 9; i++ {
		script = append(script, reply("CHECK", 0))
	}
	record, _ := playTable(t, abc, nil, nil, nil, script)
	if a := record.Actions[2]; a.Applied.Type != "CHECK" || a.Status != "illegal" || !a.Retried {
		t.Errorf("big blind could check for free: %+v", a)
	}
}
