package api

import (
	"errors"
	"fmt"
	"math/rand/v2"
	"reflect"
	"testing"

	"github.com/rizzwareengineer/no-LLMit/engine/client"
	"github.com/rizzwareengineer/no-LLMit/engine/game"
	"github.com/rizzwareengineer/no-LLMit/engine/history"
)

// threeHanded deals A, B, C with 5/10 blinds and plays the given steps.
func threeHanded(t *testing.T, steps ...func(*game.GameState)) *game.GameState {
	t.Helper()
	gs := game.NewGame(game.GameConfig{
		PlayerNames:   []string{"A", "B", "C"},
		StartingStack: 2000,
		Stakes:        game.Stakes{SmallBlind: 5, BigBlind: 10},
	})
	if err := gs.StartHand(); err != nil {
		t.Fatal(err)
	}
	for _, step := range steps {
		step(gs)
	}
	return gs
}

func act(t *testing.T, at game.ActionType, amount int) func(*game.GameState) {
	return func(gs *game.GameState) {
		t.Helper()
		if err := gs.ProcessAction(game.Action{Type: at, Amount: amount, PlayerIdx: gs.CurrentPlayerIdx}); err != nil {
			t.Fatal(err)
		}
		if gs.NeedToAdvanceStreet() {
			if err := gs.AdvanceStreet(); err != nil {
				t.Fatal(err)
			}
		}
	}
}

func TestDecisionRequestRetellsTheHandAsData(t *testing.T) {
	gs := threeHanded(t,
		act(t, game.ActionRaise, 30), act(t, game.ActionCall, 0), act(t, game.ActionCall, 0), // preflop: BTN opens
		act(t, game.ActionCheck, 0), act(t, game.ActionRaise, 40), act(t, game.ActionCall, 0), act(t, game.ActionFold, 0), // flop: BB bets
		act(t, game.ActionCheck, 0), act(t, game.ActionCheck, 0), // turn
	)
	if gs.Street != game.StreetRiver {
		t.Fatalf("expected river, got %s", gs.Street)
	}
	req := buildDecisionRequest(gs, buildLLMValidActions(gs))

	btn, sb, bb := gs.ButtonIdx, (gs.ButtonIdx+1)%3, (gs.ButtonIdx+2)%3
	if req.Seat != bb || req.Position != "BB" || req.PlayerName != gs.Players[bb].Name || len(req.HoleCards) != 2 {
		t.Errorf("acting player: %+v", req)
	}
	if req.SmallBlind != 5 || req.BigBlind != 10 || req.Pot != 170 || req.ToCall != 0 || req.Stack != 1930 {
		t.Errorf("situation: blinds %d/%d pot %d to call %d stack %d", req.SmallBlind, req.BigBlind, req.Pot, req.ToCall, req.Stack)
	}
	wantSeats := []client.Seat{{Seat: sb, Position: "SB", Stack: 1970}, {Seat: bb, Position: "BB", Stack: 1930}, {Seat: btn, Position: "BTN", Stack: 1930}}
	if !reflect.DeepEqual(req.Seats, wantSeats) {
		t.Errorf("seats clockwise from the small blind with current stacks:\n got %+v\nwant %+v", req.Seats, wantSeats)
	}

	if len(req.Streets) != 4 {
		t.Fatalf("want 4 streets, got %d", len(req.Streets))
	}
	wantPreflop := []client.StreetAction{
		{Seat: sb, Action: "post", Amount: 5}, {Seat: bb, Action: "post", Amount: 10},
		{Seat: btn, Action: "raise", Amount: 30}, {Seat: sb, Action: "call", Amount: 25}, {Seat: bb, Action: "call", Amount: 20},
	}
	if p := req.Streets[0]; !reflect.DeepEqual(p.Actions, wantPreflop) || p.Pot != 0 || len(p.Board) != 0 {
		t.Errorf("preflop: %+v", p)
	}
	wantFlop := []client.StreetAction{{Seat: sb, Action: "check"}, {Seat: bb, Action: "raise", Amount: 40}, {Seat: btn, Action: "call", Amount: 40}, {Seat: sb, Action: "fold"}}
	if f := req.Streets[1]; f.Pot != 90 || len(f.Board) != 3 || !reflect.DeepEqual(f.Actions, wantFlop) {
		t.Errorf("flop: %+v", f)
	}
	if tu := req.Streets[2]; tu.Pot != 170 || len(tu.Board) != 4 || len(tu.Actions) != 2 {
		t.Errorf("turn: %+v", tu)
	}
	if r := req.Streets[3]; r.Street != "river" || r.Pot != 170 || len(r.Board) != 5 || len(r.Actions) != 0 {
		t.Errorf("river: %+v", r)
	}

	wantLegal := []game.LLMValidAction{{Type: "FOLD"}, {Type: "CHECK"}, {Type: "BET", Min: 10, Max: 1930}, {Type: "ALL-IN", Amount: 1930}}
	if !reflect.DeepEqual(req.LegalActions, wantLegal) {
		t.Errorf("legal actions: %+v", req.LegalActions)
	}
}

func TestCoveredStackIsOfferedAnAllInCall(t *testing.T) {
	gs := threeHanded(t)
	sb := (gs.ButtonIdx + 1) % 3
	gs.Players[sb].Stack = 60 // SB has 60 behind its 5-chip blind
	act(t, game.ActionRaise, 200)(gs)
	if gs.CurrentPlayerIdx != sb {
		t.Fatalf("SB to act, got %d", gs.CurrentPlayerIdx)
	}
	var types []string
	for _, a := range buildLLMValidActions(gs) {
		types = append(types, a.Type)
		if a.Type == "CALL" && a.Amount != 60 {
			t.Errorf("all-in call should add the last 60 chips, got %d", a.Amount)
		}
	}
	if !reflect.DeepEqual(types, []string{"FOLD", "CALL", "ALL-IN"}) {
		t.Errorf("legal types: %v", types)
	}
	// The engine plays that CALL as an all-in.
	if _, err := gs.CheckAction(game.Action{Type: game.ActionCall, PlayerIdx: sb}); err != nil {
		t.Errorf("CALL should be legal: %v", err)
	}
}

func TestDecideLLMTurnAppliesTheModelsMove(t *testing.T) {
	gs := threeHanded(t)
	turn := decideLLMTurn(gs, func() (*client.LLMDecisionResponse, error) {
		return &client.LLMDecisionResponse{Action: "RAISE", Amount: 30, Status: "ok"}, nil
	})
	if turn.fallback || turn.serviceErr || turn.action.Type != game.ActionRaise || turn.action.Amount != 30 {
		t.Errorf("%+v", turn)
	}
}

func TestDecideLLMTurnFallsBackOnEveryBadStatus(t *testing.T) {
	for _, status := range []string{"illegal", "unparseable", "timeout", "api_error"} {
		gs := threeHanded(t) // first to act faces the big blind: the fallback is a fold
		turn := decideLLMTurn(gs, func() (*client.LLMDecisionResponse, error) {
			return &client.LLMDecisionResponse{Action: "RAISE", Amount: 15, Status: status, Retried: true}, nil
		})
		if !turn.fallback || turn.action.Type != game.ActionFold || turn.decision.Status != status {
			t.Errorf("%s: %+v", status, turn)
		}
	}
	// Limped to the big blind, who can check for free.
	gs := threeHanded(t, act(t, game.ActionCall, 0), act(t, game.ActionCall, 0))
	turn := decideLLMTurn(gs, func() (*client.LLMDecisionResponse, error) {
		return &client.LLMDecisionResponse{Action: "FOLD", Status: "api_error", Error: "502"}, nil
	})
	if !turn.fallback || turn.action.Type != game.ActionCheck {
		t.Errorf("free check expected: %+v", turn)
	}
}

func TestDecideLLMTurnRefusesAnUnplayableOkMove(t *testing.T) {
	gs := threeHanded(t)
	turn := decideLLMTurn(gs, func() (*client.LLMDecisionResponse, error) {
		return &client.LLMDecisionResponse{Action: "RAISE", Amount: 12, Status: "ok"}, nil
	})
	if !turn.fallback || turn.action.Type != game.ActionFold || turn.decision.Status != "ok" {
		t.Errorf("engine must refuse a raise below the minimum: %+v", turn)
	}
}

func TestDecideLLMTurnServiceDown(t *testing.T) {
	gs := threeHanded(t)
	turn := decideLLMTurn(gs, func() (*client.LLMDecisionResponse, error) { return nil, errors.New("connection refused") })
	if !turn.serviceErr || !turn.fallback || turn.action.Type != game.ActionFold || turn.decision.Status != "service_error" {
		t.Errorf("%+v", turn)
	}
}

// Many seeded random hands, each move a legal one the model was told about, sent back the
// way the LLM service names it: the engine plays it without a fallback, the move shown and
// saved is the one the engine then applied, and the hand retold to the model adds up to the
// pot, the bet to call and each seat's stack.
func TestEveryToldMoveIsPlayedAndTheRetoldHandAddsUp(t *testing.T) {
	playRandomHands(t, 3, 40)
}

// playRandomHands plays 40 hands at each of games tables of 2 to 6 seats with random
// stacks, checks every turn as above, and returns the saved records, each checked against
// the stacks the engine left.
func playRandomHands(t *testing.T, seed uint64, games int) []history.HandRecord {
	t.Helper()
	rng := rand.New(rand.NewPCG(seed, 4))
	reply := map[string]string{"FOLD": "FOLD", "CHECK": "CHECK", "CALL": "CALL", "BET": "RAISE", "RAISE": "RAISE", "ALL-IN": "ALL_IN"}
	var records []history.HandRecord
	for g := range games {
		names := []string{"A", "B", "C", "D", "E", "F"}[:2+g%5]
		gs := game.NewGame(game.GameConfig{PlayerNames: names, StartingStack: 1000, Stakes: game.Stakes{SmallBlind: 5, BigBlind: 10}})
		for i := range gs.Players {
			gs.Players[i].Stack = 1 + rng.IntN(400)
		}
		for range 40 {
			rebought := gs.RebuyBrokePlayers(400)
			before := startOf(gs).stacks
			if err := gs.StartHand(); err != nil {
				t.Fatal(err)
			}
			rec := newHandRecorder(gs, fmt.Sprintf("tbl_rand%d_%d", seed, g), rebought)
			for !gs.IsHandComplete() {
				if !gs.IsWaitingForAction() {
					gs.AdvanceStreet()
					continue
				}
				idx := gs.CurrentPlayerIdx
				legal := buildLLMValidActions(gs)
				req := buildDecisionRequest(gs, legal)
				checkRetold(t, gs, req)
				rec.beginDecision(gs, legal)

				l := legal[rng.IntN(len(legal))]
				amount := l.Amount
				if l.Max > 0 {
					amount = l.Min + rng.IntN(l.Max-l.Min+1)
				}
				turn := decideLLMTurn(gs, func() (*client.LLMDecisionResponse, error) {
					return &client.LLMDecisionResponse{Action: reply[l.Type], Amount: amount, Status: "ok"}, nil
				})
				if turn.fallback {
					t.Fatalf("told %+v, replied %s %d: the engine fell back", l, reply[l.Type], amount)
				}
				if err := gs.ProcessAction(turn.action); err != nil {
					t.Fatal(err)
				}
				rec.endDecision(turn)
				done := *gs.Players[idx].LastAction
				name := done.Name()
				if done.Type == game.ActionAllIn {
					name = "ALL_IN"
				}
				if turn.applied.Type != name || turn.applied.Amount != done.Amount {
					t.Fatalf("shown %+v, but the engine applied %s %d", turn.applied, name, done.Amount)
				}
				if gs.NeedToAdvanceStreet() {
					gs.AdvanceStreet()
				}
			}
			h, _ := rec.finish(gs)
			sum := 0
			for _, s := range h.Seats {
				if net := h.Result.Net[fmt.Sprint(s.Seat)]; net != gs.Players[s.Seat].Stack-before[s.Seat] {
					t.Fatalf("%s: seat %d saved net %d, the engine moved its stack by %d", h.HandID, s.Seat, net, gs.Players[s.Seat].Stack-before[s.Seat])
				}
				sum += h.Result.Net[fmt.Sprint(s.Seat)]
			}
			if sum != 0 {
				t.Fatalf("%s: saved nets add up to %d", h.HandID, sum)
			}
			records = append(records, h)
		}
	}
	return records
}

// checkRetold replays the streets the model is told and checks they add up to the request's
// pot and bet to call, and that every seat it lists has its real stack.
func checkRetold(t *testing.T, gs *game.GameState, req client.DecisionRequest) {
	t.Helper()
	pot := 0
	var bets map[int]int
	for _, st := range req.Streets {
		if st.Pot != pot {
			t.Fatalf("%s is told to start with %d in the pot, the streets before add up to %d", st.Street, st.Pot, pot)
		}
		bets = map[int]int{}
		for _, a := range st.Actions {
			switch a.Action {
			case "post", "call":
				bets[a.Seat] += a.Amount
			case "raise", "all_in":
				bets[a.Seat] = a.Amount
			}
		}
		for _, b := range bets {
			pot += b
		}
	}
	if pot != req.Pot {
		t.Fatalf("the retold hand adds up to %d, the request says pot %d", pot, req.Pot)
	}
	top := 0
	if len(req.Streets) == 1 {
		top = req.BigBlind // a blind posted all-in for less still leaves the full big blind to call
	}
	for _, b := range bets {
		top = max(top, b)
	}
	if want := top - bets[req.Seat]; req.ToCall != want {
		t.Fatalf("to call %d, the retold street says %d", req.ToCall, want)
	}
	for _, s := range req.Seats {
		if s.Stack != gs.Players[s.Seat].Stack {
			t.Fatalf("seat %d is told it has %d, it has %d", s.Seat, s.Stack, gs.Players[s.Seat].Stack)
		}
	}
}
