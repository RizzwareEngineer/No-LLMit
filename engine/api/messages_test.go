package api

import (
	"testing"

	"github.com/rizzwareengineer/no-LLMit/engine/game"
)

// A seat's action counts only on the street it was taken: a preflop call is not shown on the flop (the seat waits, then
// thinks) until the seat acts there.
func TestActedIsPerStreet(t *testing.T) {
	gs := game.NewGame(game.GameConfig{PlayerNames: []string{"A", "B", "C"}, StartingStack: 1000, Stakes: game.Stakes{SmallBlind: 5, BigBlind: 10}})
	if err := gs.StartHand(); err != nil {
		t.Fatal(err)
	}
	acted := func() (n int, who int) {
		for i, p := range ConvertGameState(gs).Players {
			if p.Acted {
				n, who = n+1, i
			}
		}
		return
	}
	play := func() int { // the seat on the clock checks or calls
		i := gs.CurrentPlayerIdx
		typ := game.ActionCall
		if gs.Players[i].CurrentBet == gs.CurrentBet {
			typ = game.ActionCheck
		}
		if err := gs.ProcessAction(game.Action{Type: typ, PlayerIdx: i}); err != nil {
			t.Fatal(err)
		}
		return i
	}
	if n, _ := acted(); n != 0 {
		t.Fatalf("dealt: %d seats acted, want 0 (blinds are not actions)", n)
	}
	first := play()
	if n, who := acted(); n != 1 || who != first {
		t.Fatalf("after a preflop call: %d acted (seat %d), want seat %d alone", n, who, first)
	}
	for gs.Street == game.StreetPreflop && !gs.NeedToAdvanceStreet() {
		play()
	}
	if err := gs.AdvanceStreet(); err != nil || gs.Street != game.StreetFlop {
		t.Fatalf("advance: %v, street %v", err, gs.Street)
	}
	if n, _ := acted(); n != 0 {
		t.Fatalf("on the flop before anyone acts: %d seats acted, want 0", n)
	}
	if p := ConvertGameState(gs).Players[first]; p.LastAction == "" {
		t.Fatalf("seat %d's preflop action is gone: %+v", first, p)
	}
	checked := play()
	if n, who := acted(); n != 1 || who != checked {
		t.Fatalf("after a flop check: %d acted (seat %d), want seat %d alone", n, who, checked)
	}
}
