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

	// Each call to the model takes the next scripted reply, so a retried decision uses two.
	ask := func(string) (*client.LLMDecisionResponse, error) {
		if len(script) == 0 {
			t.Fatal("script ran out")
		}
		reply := script[0]
		script = script[1:]
		reply.Provider, reply.PromptVersion, reply.Model = "test", "v1", "model-"+gs.Players[gs.CurrentPlayerIdx].Name
		return &reply, nil
	}
	for len(script) > 0 {
		if gs.IsHandComplete() {
			t.Fatal("script is longer than the hand")
		}
		idx := gs.CurrentPlayerIdx
		legal := buildLLMValidActions(gs)
		prompt := gs.GetLLMPrompt(gs.Players[idx].Name, legal)
		rec.beginDecision(gs, legal, prompt)

		turn := decideLLMTurn(gs, prompt, ask)
		if err := gs.ProcessAction(turn.action); err != nil {
			t.Fatalf("decideLLMTurn chose an action the engine rejects: %v", err)
		}
		rec.endDecision(gs, turn)

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
	// A twice sends a raise below the minimum; B twice sends a reply with no action.
	// Neither can check, so both fall back to a fold.
	unparseable := reply("FOLD", 0)
	unparseable.Status = "unparseable"
	record, prompts := playRecorded(t, []client.LLMDecisionResponse{reply("RAISE", 12), reply("RAISE", 12), unparseable, unparseable})

	if a := record.Actions[0]; a.Status != "illegal" || !a.Retried || a.Applied.Type != "FOLD" || a.Parsed.Action != "RAISE" {
		t.Errorf("illegal raise: %+v", a)
	}
	if a := record.Actions[1]; a.Status != "unparseable" || !a.Retried || a.Applied.Type != "FOLD" {
		t.Errorf("unparseable reply: %+v", a)
	}
	if !strings.Contains(prompts[0].RawReply, "--- retry ---") {
		t.Errorf("both raw replies should be kept: %q", prompts[0].RawReply)
	}
	if len(record.Result.Pots) != 1 || record.Result.Pots[0].Amount != 15 {
		t.Errorf("big blind should win the 15 chip pot: %+v", record.Result.Pots)
	}
	if len(record.Result.Showdown) != 0 || netSum(record) != 0 {
		t.Errorf("showdown %v, net %v", record.Result.Showdown, record.Result.Net)
	}
}

func TestParseActionType(t *testing.T) {
	for _, s := range []string{"ALL_IN", "ALL-IN", "all-in", "allin"} {
		if got, ok := ParseActionType(s); !ok || got != game.ActionAllIn {
			t.Errorf("ParseActionType(%q) = %v, %v; want ALL-IN", s, got, ok)
		}
	}
	for _, s := range []string{"BET", "SHOVE", ""} {
		if _, ok := ParseActionType(s); ok {
			t.Errorf("ParseActionType(%q) should not be ok", s)
		}
	}
}

func TestAllInReplyIsApplied(t *testing.T) {
	record, _ := playRecorded(t, []client.LLMDecisionResponse{reply("ALL_IN", 0), reply("FOLD", 0), reply("FOLD", 0)})
	if a := record.Actions[0]; a.Applied.Type != "ALL_IN" || a.Applied.Amount != 2000 || a.Status != "ok" || a.Retried {
		t.Errorf("model chose ALL_IN: %+v", a)
	}
}

func TestIllegalRaiseFallsBackToCheckWhenFree(t *testing.T) {
	// Limped to the big blind, who twice "raises" by the 5-chip increment instead of a total.
	script := []client.LLMDecisionResponse{reply("CALL", 0), reply("CALL", 0), reply("RAISE", 15), reply("RAISE", 15)}
	for i := 0; i < 9; i++ {
		script = append(script, reply("CHECK", 0))
	}
	record, _ := playRecorded(t, script)
	if a := record.Actions[2]; a.Applied.Type != "CHECK" || a.Status != "illegal" || !a.Retried {
		t.Errorf("big blind could check for free: %+v", a)
	}
}

func TestIllegalRaiseFixedOnRetry(t *testing.T) {
	gs := game.NewGame(game.GameConfig{
		PlayerNames:   []string{"A", "B", "C"},
		StartingStack: 2000,
		Stakes:        game.Stakes{SmallBlind: 5, BigBlind: 10},
	})
	if err := gs.StartHand(); err != nil {
		t.Fatal(err)
	}
	tokens := 7
	replies := []client.LLMDecisionResponse{reply("RAISE", 12), reply("RAISE", 30)}
	replies[0].TokensIn, replies[1].TokensIn = &tokens, &tokens
	var asked []string
	turn := decideLLMTurn(gs, "PROMPT", func(p string) (*client.LLMDecisionResponse, error) {
		asked = append(asked, p)
		r := replies[len(asked)-1]
		return &r, nil
	})
	if len(asked) != 2 || !strings.HasPrefix(asked[1], "PROMPT\n\nYour previous reply was invalid: raise must be at least") {
		t.Fatalf("retry prompt should carry the engine's reason: %q", asked)
	}
	if turn.fallback || !turn.retried || turn.action.Type != game.ActionRaise || turn.action.Amount != 30 {
		t.Errorf("retry reply should be applied: %+v", turn)
	}
	if *turn.decision.TokensIn != 14 {
		t.Errorf("tokens of both calls should be counted, got %d", *turn.decision.TokensIn)
	}
}
