package game

import (
	"strings"
	"testing"
)

// Plays a three-handed hand to the river with scripted actions and checks the prompt
// retells every street.
func TestLLMPromptRetellsCurrentHand(t *testing.T) {
	gs := NewGame(GameConfig{
		PlayerNames:   []string{"A", "B", "C"},
		StartingStack: 2000,
		Stakes:        Stakes{SmallBlind: 5, BigBlind: 10},
	})
	if err := gs.StartHand(); err != nil {
		t.Fatal(err)
	}

	act := func(at ActionType, amount int) {
		t.Helper()
		if err := gs.ProcessAction(Action{Type: at, Amount: amount, PlayerIdx: gs.CurrentPlayerIdx}); err != nil {
			t.Fatal(err)
		}
		if gs.NeedToAdvanceStreet() {
			if err := gs.AdvanceStreet(); err != nil {
				t.Fatal(err)
			}
		}
	}

	act(ActionRaise, 30) // BTN opens
	act(ActionCall, 0)   // SB
	act(ActionCall, 0)   // BB
	act(ActionCheck, 0)  // flop: SB
	act(ActionRaise, 40) // BB bets
	act(ActionCall, 0)   // BTN
	act(ActionFold, 0)   // SB
	act(ActionCheck, 0)  // turn: BB
	act(ActionCheck, 0)  // BTN

	if gs.Street != StreetRiver {
		t.Fatalf("expected river, got %s", gs.Street)
	}

	name := gs.Players[gs.CurrentPlayerIdx].Name
	prompt := gs.GetLLMPrompt(name, []LLMValidAction{{Type: "FOLD"}, {Type: "CHECK"}, {Type: "BET", Min: 10, Max: 1930}})
	t.Log("\n" + prompt)

	for _, want := range []string{
		"Preflop: B posts small blind 5, C posts big blind 10, A raises to 30, B calls 25, C calls 20",
		"(pot 90): B checks, C bets 40, A calls 40, B folds",
		"(pot 170): C checks, A checks",
		"(pot 170): no action yet",
		"Pot: 170. To call: 0. Your stack: 1930.",
		"Still in the hand: A (BTN, 1930 behind).",
		"- BET: AMOUNT is your total bet this street, between 10 and 1930",
	} {
		if !strings.Contains(prompt, want) {
			t.Errorf("prompt missing %q", want)
		}
	}
	if strings.Count(prompt, "Hand #") != 1 {
		t.Errorf("prompt should describe only the current hand")
	}
}
