package api

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/rizzwareengineer/no-LLMit/engine/client"
	"github.com/rizzwareengineer/no-LLMit/engine/game"
)

// playRecorded drives a three-handed hand through the recorder the same way the table
// does, with each step's reply scripted.
func playRecorded(t *testing.T, script []client.LLMDecisionResponse) (HandRecord, []HandPrompt) {
	t.Helper()
	gs := game.NewGame(game.GameConfig{
		PlayerNames:   []string{"A", "B", "C"},
		StartingStack: 2000,
		Stakes:        game.Stakes{SmallBlind: 5, BigBlind: 10},
	})
	if err := gs.StartHand(); err != nil {
		t.Fatal(err)
	}
	rec := newHandRecorder(gs, "tbl_test", nil)

	for _, reply := range script {
		if gs.IsHandComplete() {
			t.Fatal("script is longer than the hand")
		}
		idx := gs.CurrentPlayerIdx
		legal := buildLLMValidActions(gs)
		rec.beginDecision(gs, legal, gs.GetLLMPrompt(gs.Players[idx].Name, legal))

		illegal := false
		action := game.Action{Type: ParseActionType(reply.Action), Amount: reply.Amount, PlayerIdx: idx}
		if err := gs.ProcessAction(action); err != nil {
			illegal = true
			gs.ProcessAction(game.Action{Type: game.ActionFold, PlayerIdx: idx})
		}
		reply.Provider, reply.PromptVersion, reply.Model = "test", "v1", "model-"+gs.Players[idx].Name
		rec.endDecision(gs, &reply, false, illegal)

		if gs.NeedToAdvanceStreet() {
			if err := gs.AdvanceStreet(); err != nil {
				t.Fatal(err)
			}
		}
	}
	if !gs.IsHandComplete() {
		t.Fatal("hand did not finish")
	}
	return rec.finish(gs)
}

func reply(action string, amount int) client.LLMDecisionResponse {
	return client.LLMDecisionResponse{Action: action, Amount: amount, Reason: "because", Raw: "ACTION: " + action, Status: "ok"}
}

func netSum(r HandRecord) int {
	sum := 0
	for _, n := range r.Result.Net {
		sum += n
	}
	return sum
}

func TestHandRecordThroughShowdown(t *testing.T) {
	// Button A opens, both blinds call, C bets the flop and A calls, then it checks down.
	record, prompts := playRecorded(t, []client.LLMDecisionResponse{
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
		if !strings.Contains(prompts[i].Prompt, "You are "+a.Player) || prompts[i].RawReply == "" {
			t.Errorf("action %d: prompt or reply missing", i+1)
		}
	}
	if streets["preflop"] != 3 || streets["flop"] != 4 || streets["turn"] != 2 || streets["river"] != 2 {
		t.Errorf("actions per street: %v", streets)
	}

	if got := record.Actions[0].Applied; got != (AppliedAction{Type: "RAISE", Amount: 30}) {
		t.Errorf("preflop open: %+v", got)
	}
	if got := record.Actions[1].Applied; got != (AppliedAction{Type: "CALL", Amount: 25}) {
		t.Errorf("small blind call: %+v", got)
	}
	if got := record.Actions[4].Applied; got != (AppliedAction{Type: "BET", Amount: 40}) {
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

func TestHandRecordUncontestedAndFallbacks(t *testing.T) {
	// A's reply cannot be applied (raise below the minimum), B's reply was unparseable.
	unparseable := reply("FOLD", 0)
	unparseable.Status = "unparseable"
	record, _ := playRecorded(t, []client.LLMDecisionResponse{reply("RAISE", 12), unparseable})

	if a := record.Actions[0]; a.Status != "illegal" || a.Applied.Type != "FOLD" || a.Parsed.Action != "RAISE" {
		t.Errorf("illegal raise: %+v", a)
	}
	if a := record.Actions[1]; a.Status != "unparseable" || a.Applied.Type != "FOLD" {
		t.Errorf("unparseable reply: %+v", a)
	}
	if len(record.Result.Pots) != 1 || record.Result.Pots[0].Amount != 15 {
		t.Errorf("big blind should win the 15 chip pot: %+v", record.Result.Pots)
	}
	if len(record.Result.Showdown) != 0 || netSum(record) != 0 {
		t.Errorf("showdown %v, net %v", record.Result.Showdown, record.Result.Net)
	}
}
