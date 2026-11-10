// Rules tests: betting, side pots, split pots and hand ranking, each against the
// standard (TDA) no-limit hold'em rules.
package game

import (
	"reflect"
	"testing"
)

// newTable seats players A, B, C... with the given stacks, button on seat 0, blinds 5/10.
func newTable(stacks ...int) *GameState {
	names := []string{"A", "B", "C", "D", "E", "F"}[:len(stacks)]
	gs := NewGame(GameConfig{PlayerNames: names, StartingStack: 1000, Stakes: Stakes{SmallBlind: 5, BigBlind: 10}})
	for i, s := range stacks {
		gs.Players[i].Stack = s
	}
	gs.ButtonIdx = 0
	return gs
}

func act(t *testing.T, gs *GameState, typ ActionType, amt int) {
	t.Helper()
	if err := gs.ProcessAction(Action{Type: typ, Amount: amt, PlayerIdx: gs.CurrentPlayerIdx}); err != nil {
		t.Fatalf("action %v %d by %d: %v", typ, amt, gs.CurrentPlayerIdx, err)
	}
}

func offers(gs *GameState, typ ActionType) bool {
	for _, va := range gs.GetValidActions() {
		if va.Type == typ {
			return true
		}
	}
	return false
}

func TestShortAllInDoesNotReopenRaising(t *testing.T) {
	// Button A(0), SB B(1), BB C(2). C has 150 in total.
	gs := newTable(1000, 1000, 150)
	if err := gs.StartHand(); err != nil {
		t.Fatal(err)
	}
	act(t, gs, ActionRaise, 100) // A raises to 100 (a raise of 90)
	act(t, gs, ActionCall, 0)    // B calls
	act(t, gs, ActionAllIn, 0)   // C all-in to 150: a raise of 50, less than a full raise
	if gs.CurrentPlayerIdx != 0 {
		t.Fatalf("expected A to act, got %d", gs.CurrentPlayerIdx)
	}
	if offers(gs, ActionRaise) || offers(gs, ActionAllIn) {
		t.Errorf("A already acted and faces an incomplete raise; got %+v", gs.GetValidActions())
	}
	if !offers(gs, ActionCall) || !offers(gs, ActionFold) {
		t.Errorf("A must still be able to call or fold; got %+v", gs.GetValidActions())
	}
	if err := gs.ProcessAction(Action{Type: ActionRaise, Amount: 400, PlayerIdx: 0}); err == nil {
		t.Error("engine accepted a re-raise after an incomplete all-in raise")
	}
	if err := gs.ProcessAction(Action{Type: ActionAllIn, PlayerIdx: 0}); err == nil {
		t.Error("engine accepted an all-in re-raise after an incomplete all-in raise")
	}
	act(t, gs, ActionCall, 0) // A calls 50 more
	if gs.CurrentPlayerIdx != 1 || offers(gs, ActionRaise) {
		t.Errorf("B also acted before the short all-in; current=%d actions=%+v", gs.CurrentPlayerIdx, gs.GetValidActions())
	}
	act(t, gs, ActionCall, 0)
	if !gs.NeedToAdvanceStreet() {
		t.Fatal("round should be complete")
	}
	gs.AdvanceStreet()
	if gs.CurrentPlayerIdx >= 0 && !offers(gs, ActionCheck) {
		t.Errorf("a new street reopens betting; got %+v", gs.GetValidActions())
	}
}

func TestShortAllInLetsUnactedPlayersRaise(t *testing.T) {
	// Button A(0) with 140, SB B(1), BB C(2), D(3) first to act.
	gs := newTable(140, 1000, 1000, 1000)
	if err := gs.StartHand(); err != nil {
		t.Fatal(err)
	}
	act(t, gs, ActionRaise, 100) // D raises to 100
	act(t, gs, ActionAllIn, 0)   // A all-in to 140: incomplete raise
	if gs.CurrentPlayerIdx != 1 || !offers(gs, ActionRaise) {
		t.Errorf("B has not acted yet and may raise; current=%d actions=%+v", gs.CurrentPlayerIdx, gs.GetValidActions())
	}
	act(t, gs, ActionRaise, 400) // a full raise reopens raising for D
	act(t, gs, ActionFold, 0)    // C
	if gs.CurrentPlayerIdx != 3 || !offers(gs, ActionRaise) {
		t.Errorf("a full raise reopens raising for D; current=%d actions=%+v", gs.CurrentPlayerIdx, gs.GetValidActions())
	}
}

func TestFoldedExcessGoesToSidePot(t *testing.T) {
	// C is all-in for 50; A and B each put in 200 and B folds. The main pot is 150
	// (50 x 3) for A or C, and the side pot is 300 for A alone.
	gs := newTable(1000, 1000, 50)
	gs.StartHand()
	for i := range gs.Players {
		gs.Players[i].CurrentBet = 0
	}
	gs.Players[0].TotalBetThisHand, gs.Players[0].Status = 200, PlayerActive
	gs.Players[1].TotalBetThisHand, gs.Players[1].Status = 200, PlayerFolded
	gs.Players[2].TotalBetThisHand, gs.Players[2].Status, gs.Players[2].Stack = 50, PlayerAllIn, 0
	gs.CalculatePots()
	if len(gs.Pots) != 2 || gs.Pots[0].Amount != 150 || gs.Pots[1].Amount != 300 {
		t.Fatalf("want main 150 and side 300, got %+v", gs.Pots)
	}
	if len(gs.Pots[1].EligiblePlayers) != 1 || gs.Pots[1].EligiblePlayers[0] != 0 {
		t.Errorf("side pot belongs to A only, got %+v", gs.Pots[1])
	}

	// C wins the showdown: C collects only the main pot, A gets the side pot back.
	before := gs.Players[0].Stack + gs.Players[2].Stack
	gs.AwardPots(nil, func(_ []Player, _ []Card, eligible []int) []int { return []int{2} })
	if gs.Players[2].Stack != 150 {
		t.Errorf("C should collect 150, has %d", gs.Players[2].Stack)
	}
	if got := gs.Players[0].Stack + gs.Players[2].Stack - before; got != 450 {
		t.Errorf("all 450 chips should be awarded, got %d", got)
	}
}

func TestOddChipGoesLeftOfButton(t *testing.T) {
	gs := newTable(1000, 1000, 1000)
	gs.ButtonIdx = 0
	gs.Pots = []Pot{{Amount: 21, EligiblePlayers: []int{0, 1, 2}}}
	// Seats 0 and 2 tie. Left of the button the order is 1, 2, 0, so seat 2 gets the odd chip.
	gs.AwardPots(nil, func(_ []Player, _ []Card, _ []int) []int { return []int{0, 2} })
	if gs.Players[2].Stack != 1011 || gs.Players[0].Stack != 1010 {
		t.Errorf("want seat 2 +11 and seat 0 +10, got %d and %d", gs.Players[2].Stack-1000, gs.Players[0].Stack-1000)
	}
}

func hand(s ...string) []Card {
	var cs []Card
	for _, x := range s {
		c, err := ParseCard(x)
		if err != nil {
			panic(err)
		}
		cs = append(cs, c)
	}
	return cs
}

func TestEvaluatorEdgeCases(t *testing.T) {
	cases := []struct {
		name string
		a, b []string
		want int
	}{
		{"wheel loses to 6-high straight", []string{"Ah", "2c", "3d", "4s", "5h", "Kc", "Kd"}, []string{"2c", "3d", "4s", "5h", "6d", "Kc", "Kd"}, -1},
		{"flush beats straight", []string{"2h", "7h", "9h", "Jh", "Kh", "Qc", "Td"}, []string{"9c", "Td", "Jc", "Qd", "Ks", "2c", "3c"}, 1},
		{"AAA KKK 2 is aces full of kings", []string{"Ah", "Ac", "Ad", "Kh", "Kc", "Kd", "2s"}, []string{"Ah", "Ac", "Ad", "Qh", "Qc", "Qd", "2s"}, 1},
		{"three pair uses best kicker", []string{"Ah", "Ac", "Kd", "Kh", "Qc", "Qd", "2s"}, []string{"Ah", "Ac", "Kd", "Kh", "Jc", "Jd", "2s"}, 1},
		{"steel wheel loses to 6-high straight flush", []string{"Ah", "2h", "3h", "4h", "5h", "Kc", "Kd"}, []string{"2h", "3h", "4h", "5h", "6h", "Kc", "Kd"}, -1},
		{"board plays: split", []string{"2c", "3d", "Ah", "Kh", "Qh", "Jh", "Th"}, []string{"4c", "5d", "Ah", "Kh", "Qh", "Jh", "Th"}, 0},
		{"pair kicker", []string{"Ah", "Ac", "Kd", "7h", "5c", "3d", "2s"}, []string{"Ah", "Ac", "Qd", "7h", "5c", "3d", "2s"}, 1},
		{"quads kicker", []string{"9h", "9c", "9d", "9s", "Ac", "3d", "2s"}, []string{"9h", "9c", "9d", "9s", "Kc", "3d", "2s"}, 1},
	}
	for _, c := range cases {
		if got := CompareHands(EvaluateHand(hand(c.a...)), EvaluateHand(hand(c.b...))); got != c.want {
			t.Errorf("%s: got %d want %d", c.name, got, c.want)
		}
	}
}

func TestBBOptionAndCheckAround(t *testing.T) {
	gs := newTable(1000, 1000, 1000)
	gs.StartHand()
	act(t, gs, ActionCall, 0) // A
	act(t, gs, ActionCall, 0) // B
	if gs.CurrentPlayerIdx != 2 {
		t.Fatalf("BB should get the option, current=%d", gs.CurrentPlayerIdx)
	}
	act(t, gs, ActionCheck, 0)
	if !gs.NeedToAdvanceStreet() {
		t.Fatal("round should be complete")
	}
	gs.AdvanceStreet()
	if gs.CurrentPlayerIdx != 1 {
		t.Fatalf("SB acts first postflop, got %d", gs.CurrentPlayerIdx)
	}
	act(t, gs, ActionCheck, 0)
	act(t, gs, ActionCheck, 0)
	act(t, gs, ActionCheck, 0)
	if !gs.NeedToAdvanceStreet() {
		t.Fatal("check-around should end the round")
	}
}

func TestShortCallBecomesAllInAndRunsOut(t *testing.T) {
	gs := newTable(1000, 1000, 60)
	gs.StartHand()
	act(t, gs, ActionRaise, 200)
	act(t, gs, ActionFold, 0)
	act(t, gs, ActionCall, 0) // C has 50 behind the BB, so the call is an all-in
	if gs.Players[2].Status != PlayerAllIn || gs.Players[2].TotalBetThisHand != 60 {
		t.Fatalf("short call: status %v total %d", gs.Players[2].Status, gs.Players[2].TotalBetThisHand)
	}
	if !gs.NeedToAdvanceStreet() {
		t.Fatal("round should be complete")
	}
	before := gs.Players[0].Stack + gs.Players[1].Stack + gs.Players[2].Stack + gs.SimplifiedPotCalculation()
	gs.AdvanceStreet()
	after := gs.Players[0].Stack + gs.Players[1].Stack + gs.Players[2].Stack
	if !gs.IsHandComplete() || before != after || len(gs.CommunityCards) != 5 {
		t.Fatalf("run-out: complete=%v chips %d -> %d board %d", gs.IsHandComplete(), before, after, len(gs.CommunityCards))
	}
}

func TestRaiseNeedsAnOpponentWhoCanRespond(t *testing.T) {
	// Button A(0), SB B(1), BB C(2); A acts first preflop.
	type step struct {
		typ ActionType
		amt int
	}
	cases := []struct {
		name   string
		stacks []int
		play   []step
		want   []ActionType
	}{
		{"covered by a lone all-in: fold or call all-in", []int{1000, 1000, 150},
			[]step{{ActionAllIn, 0}, {ActionFold, 0}}, []ActionType{ActionFold, ActionAllIn}},
		{"lone all-in opponent the actor covers: fold or call, no raise", []int{1000, 1000, 300},
			[]step{{ActionRaise, 100}, {ActionFold, 0}, {ActionAllIn, 0}}, []ActionType{ActionFold, ActionCall}},
		{"one all-in and one active opponent: raising stays open", []int{1000, 1000, 300},
			[]step{{ActionRaise, 100}, {ActionCall, 0}, {ActionAllIn, 0}}, []ActionType{ActionFold, ActionCall, ActionRaise, ActionAllIn}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			gs := newTable(c.stacks...)
			if err := gs.StartHand(); err != nil {
				t.Fatal(err)
			}
			for _, s := range c.play {
				act(t, gs, s.typ, s.amt)
			}
			var got []ActionType
			for _, va := range gs.GetValidActions() {
				got = append(got, va.Type)
			}
			if !reflect.DeepEqual(got, c.want) {
				t.Errorf("player %d is offered %v, want %v", gs.CurrentPlayerIdx, got, c.want)
			}
		})
	}
}

// Short all-ins that together make a full raise reopen raising for a player who already acted
// (TDA 43); one that does not leaves it closed.
func TestCumulativeShortAllInsReopenRaising(t *testing.T) {
	// Button A(0) 200, SB B(1), BB C(2), D(3), E(4) 150. Preflop order: D, E, A, B, C.
	gs := newTable(200, 1000, 1000, 1000, 150)
	if err := gs.StartHand(); err != nil {
		t.Fatal(err)
	}
	act(t, gs, ActionRaise, 100) // D raises to 100: a raise of 90
	act(t, gs, ActionAllIn, 0)   // E all-in 150: 50 more, short
	if d := gs.Players[3]; !d.RaiseClosed {
		t.Fatal("D faces 50 more after one short all-in: raising should be closed")
	}
	act(t, gs, ActionAllIn, 0) // A all-in 200: 50 more again, 100 over D's bet in all
	act(t, gs, ActionFold, 0)  // B
	act(t, gs, ActionCall, 0)  // C calls 200 with 800 behind, so a raise can be answered
	if gs.CurrentPlayerIdx != 3 {
		t.Fatalf("expected D to act, got %d", gs.CurrentPlayerIdx)
	}
	var raise *ValidAction
	for _, va := range gs.GetValidActions() {
		if va.Type == ActionRaise {
			raise = &va
		}
	}
	// D faces 100 more, a full raise (90): the minimum re-raise is 200 + 90.
	if raise == nil || raise.MinAmount != 290 || raise.MaxAmount != 1000 {
		t.Fatalf("D should be offered a raise from 290 to 1000; got %+v", gs.GetValidActions())
	}
	if err := gs.CheckAction(Action{Type: ActionRaise, Amount: 289, PlayerIdx: 3}); err == nil {
		t.Error("engine accepted a re-raise below the minimum")
	}
	if err := gs.CheckAction(Action{Type: ActionRaise, Amount: 400, PlayerIdx: 3}); err != nil {
		t.Errorf("engine refused D's re-raise to 400: %v", err)
	}
}

// Once nothing is owed and every opponent is all-in or folded, the last player with chips is
// not asked: the board runs out, and no fold can hand an all-in player chips it never covered.
func TestLoneStackWithNothingToCallIsNotAsked(t *testing.T) {
	total := func(gs *GameState) (n int) {
		for _, p := range gs.Players {
			n += p.Stack
		}
		return n
	}
	t.Run("a short shove folded round to the big blind", func(t *testing.T) {
		// Button A(0), SB B(1), BB C(2), D(3) with 7 chips.
		gs := newTable(1000, 1000, 1000, 7)
		if err := gs.StartHand(); err != nil {
			t.Fatal(err)
		}
		act(t, gs, ActionAllIn, 0) // D all-in for 7, less than the big blind
		act(t, gs, ActionFold, 0)  // A
		act(t, gs, ActionFold, 0)  // B
		if gs.IsWaitingForAction() || !gs.NeedToAdvanceStreet() {
			t.Fatalf("the big blind has nothing to call and nobody to bet into, yet player %d is offered %+v", gs.CurrentPlayerIdx, gs.GetValidActions())
		}
		gs.AdvanceStreet()
		// D can win 19: his 7, 7 of the big blind and the small blind's 5. The big blind's other 3 were never called.
		c, d := gs.Players[2].Stack, gs.Players[3].Stack
		if !gs.IsHandComplete() || d > 19 || c+d != 1012 || total(gs) != 3007 {
			t.Errorf("complete=%v, D has %d (at most 19), big blind %d (1012 between them), %d chips in all (3007)", gs.IsHandComplete(), d, c, total(gs))
		}
	})
	t.Run("a free fold leaves one stack against an all-in", func(t *testing.T) {
		// Button A(0), SB B(1), BB C(2) with 30 chips.
		gs := newTable(1000, 1000, 30)
		if err := gs.StartHand(); err != nil {
			t.Fatal(err)
		}
		act(t, gs, ActionRaise, 100) // A raises to 100
		act(t, gs, ActionCall, 0)    // B calls
		act(t, gs, ActionCall, 0)    // C calls all-in for 30 in all
		gs.AdvanceStreet()           // flop: main pot 90, side pot 140 between A and B
		act(t, gs, ActionFold, 0)    // B folds with nothing to call
		if gs.IsWaitingForAction() || !gs.NeedToAdvanceStreet() {
			t.Fatalf("A is the only player with chips and owes nothing, yet player %d is offered %+v", gs.CurrentPlayerIdx, gs.GetValidActions())
		}
		gs.AdvanceStreet()
		// C put in 30 and can win 90; the side pot is A's whatever the cards.
		a, c := gs.Players[0].Stack, gs.Players[2].Stack
		if !gs.IsHandComplete() || c > 90 || a < 1040 || total(gs) != 2030 {
			t.Errorf("complete=%v, C has %d (at most 90), A %d (at least 1040), %d chips in all (2030)", gs.IsHandComplete(), c, a, total(gs))
		}
	})
	t.Run("a big blind all-in for less than the small blind's post", func(t *testing.T) {
		// Button A(0), SB B(1), BB C(2) with 3 chips, D(3). The bet to call is nominally 10, but
		// once the others fold nobody has more in than the small blind's 5.
		gs := newTable(1000, 1000, 3, 1000)
		if err := gs.StartHand(); err != nil {
			t.Fatal(err)
		}
		act(t, gs, ActionFold, 0) // D
		act(t, gs, ActionFold, 0) // A
		if gs.IsWaitingForAction() || !gs.NeedToAdvanceStreet() {
			t.Fatalf("the small blind has more in than the all-in big blind, yet player %d is offered %+v", gs.CurrentPlayerIdx, gs.GetValidActions())
		}
		gs.AdvanceStreet()
		// C can win 6: its 3 and 3 of the small blind's 5.
		if b, c := gs.Players[1].Stack, gs.Players[2].Stack; !gs.IsHandComplete() || c > 6 || b+c != 1003 || total(gs) != 3003 {
			t.Errorf("complete=%v, C has %d (at most 6), small blind %d (1003 between them), %d chips in all (3003)", gs.IsHandComplete(), c, b, total(gs))
		}
	})
	t.Run("a big blind all-in for more than the small blind's post is still called or folded", func(t *testing.T) {
		gs := newTable(1000, 1000, 8, 1000)
		if err := gs.StartHand(); err != nil {
			t.Fatal(err)
		}
		act(t, gs, ActionFold, 0) // D
		act(t, gs, ActionFold, 0) // A
		if gs.CurrentPlayerIdx != 1 || !offers(gs, ActionCall) || !offers(gs, ActionFold) || offers(gs, ActionRaise) {
			t.Errorf("the small blind has 5 in against 8 and must call or fold; player %d is offered %+v", gs.CurrentPlayerIdx, gs.GetValidActions())
		}
	})
	t.Run("heads-up, a blind posted all-in", func(t *testing.T) {
		// Two seats: seat 1 posts the small blind with its last 3 chips, seat 0 the big blind.
		gs := newTable(1000, 3)
		if err := gs.StartHand(); err != nil {
			t.Fatal(err)
		}
		if gs.IsWaitingForAction() || !gs.NeedToAdvanceStreet() {
			t.Fatalf("nothing can be decided, yet player %d is offered %+v", gs.CurrentPlayerIdx, gs.GetValidActions())
		}
		gs.AdvanceStreet()
		if short := gs.Players[1].Stack; !gs.IsHandComplete() || short > 6 || total(gs) != 1003 {
			t.Errorf("complete=%v, the short stack has %d (at most 6), %d chips in all (1003)", gs.IsHandComplete(), short, total(gs))
		}
	})
	t.Run("a stack that still owes a call is asked", func(t *testing.T) {
		gs := newTable(1000, 1000, 300)
		if err := gs.StartHand(); err != nil {
			t.Fatal(err)
		}
		act(t, gs, ActionRaise, 100) // A
		act(t, gs, ActionFold, 0)    // B
		act(t, gs, ActionAllIn, 0)   // C all-in for 300
		if gs.CurrentPlayerIdx != 0 || !offers(gs, ActionCall) || !offers(gs, ActionFold) {
			t.Errorf("A owes 200 and must be asked; player %d is offered %+v", gs.CurrentPlayerIdx, gs.GetValidActions())
		}
	})
}
