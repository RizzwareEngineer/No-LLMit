// Turns the current hand into the data the LLM service renders its prompt from: seats
// clockwise from the one after the button, button last, with current stacks, every action by street, the board,
// the acting player's cards and legal moves. Nothing from previous hands and no model
// names. Used by table.go's playTurn.
package api

import (
	"strings"

	"github.com/rizzwareengineer/no-LLMit/engine/client"
	"github.com/rizzwareengineer/no-LLMit/engine/game"
)

func buildDecisionRequest(gs *game.GameState, validActions []game.LLMValidAction) client.DecisionRequest {
	idx := gs.CurrentPlayerIdx
	you := gs.Players[idx]
	req := client.DecisionRequest{
		PlayerName: you.Name,
		SmallBlind: gs.Stakes.SmallBlind,
		BigBlind:   gs.Stakes.BigBlind,
		Seat:       idx,
		Position:   gs.PositionName(idx),
		HoleCards:  game.CardStrings(you.HoleCards),
		Pot:        gs.SimplifiedPotCalculation(),
		ToCall:     max(gs.CurrentBet-you.CurrentBet, 0),
		Stack:      you.Stack,
	}

	// Seats dealt into this hand, clockwise from the one after the button, button last: the
	// small blind first, or heads-up the big blind (the button posts the small blind).
	n := len(gs.Players)
	for i := 1; i <= n; i++ {
		s := (gs.ButtonIdx + i) % n
		if p := gs.Players[s]; len(p.HoleCards) > 0 {
			req.Seats = append(req.Seats, client.Seat{Seat: s, Position: gs.PositionName(s), Stack: p.Stack})
		}
	}

	seatOf := map[string]int{}
	for i, p := range gs.Players {
		seatOf[p.Name] = i
	}
	board := game.CardStrings(gs.CommunityCards)
	boardSize := map[game.Street]int{game.StreetFlop: 3, game.StreetTurn: 4, game.StreetRiver: 5}
	pot, next := 0, 0
	for _, street := range []game.Street{game.StreetPreflop, game.StreetFlop, game.StreetTurn, game.StreetRiver} {
		if street > gs.Street {
			break
		}
		st := client.Street{Street: street.String(), Board: board[:min(boardSize[street], len(board))], Pot: pot, Actions: []client.StreetAction{}}
		for next < len(gs.LLMActionsThisHand) && gs.LLMActionsThisHand[next].Street == street.String() {
			a := gs.LLMActionsThisHand[next]
			st.Actions = append(st.Actions, client.StreetAction{
				Seat:   seatOf[a.Player],
				Action: strings.ToLower(strings.ReplaceAll(a.Action, "-", "_")),
				Amount: a.Amount,
			})
			pot = a.Pot
			next++
		}
		req.Streets = append(req.Streets, st)
	}

	req.LegalActions = validActions
	return req
}
