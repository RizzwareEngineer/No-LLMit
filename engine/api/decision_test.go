package api

import (
	"errors"
	"reflect"
	"testing"

	"github.com/rizzwareengineer/no-LLMit/engine/client"
	"github.com/rizzwareengineer/no-LLMit/engine/game"
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
	if err := gs.CheckAction(game.Action{Type: game.ActionCall, PlayerIdx: sb}); err != nil {
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
