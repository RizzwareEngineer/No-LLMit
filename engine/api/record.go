// Builds the saved record of a hand: who sat where with which cards, every decision in
// order with the situation the player faced and what they did, and the result. The
// prompt and raw reply for each decision are kept separately (HandPrompt) and linked by
// prompt_id. Used by table.go; store.go saves the result.
package api

import (
	"fmt"
	"time"

	"github.com/rizzwareengineer/no-LLMit/engine/game"
	"github.com/rizzwareengineer/no-LLMit/engine/history"
)

const handRecordSchema = 1

// HandPrompt is the exact text one decision was made from and the reply to it.
type HandPrompt struct {
	PromptID    string `json:"prompt_id"`
	N           int    `json:"n"`
	Prompt      string `json:"prompt"`
	RawReply    string `json:"raw_reply"`              // both replies when retried, separated by "--- retry ---"
	RetryPrompt string `json:"retry_prompt,omitempty"` // the follow-up message after an invalid reply
}

// handRecorder accumulates one hand's record as it is played.
type handRecorder struct {
	record  history.HandRecord
	prompts []HandPrompt
	pending *history.ActionRecord
}

// newHandRecorder is called right after StartHand, once blinds are posted and cards dealt.
func newHandRecorder(gs *game.GameState, tableID string, rebought []int) *handRecorder {
	r := &handRecorder{record: history.HandRecord{
		Schema:     handRecordSchema,
		HandID:     fmt.Sprintf("%s-%06d", tableID, gs.HandNumber),
		TableID:    tableID,
		HandNumber: gs.HandNumber,
		StartedAt:  time.Now().UTC(),
		Config:     history.HandConfig{SmallBlind: gs.Stakes.SmallBlind, BigBlind: gs.Stakes.BigBlind, Memory: "none"},
		ButtonSeat: gs.ButtonIdx,
		Deck:       gs.DeckOrder(),
		Board:      []string{},
		Actions:    []history.ActionRecord{},
	}}

	isRebought := map[int]bool{}
	for _, i := range rebought {
		isRebought[i] = true
	}
	for i, p := range gs.Players {
		if len(p.HoleCards) == 0 {
			continue // not dealt in
		}
		r.record.Seats = append(r.record.Seats, history.SeatRecord{
			Seat:       i,
			Name:       p.Name,
			Position:   gs.PositionName(i),
			StackStart: p.Stack + p.TotalBetThisHand,
			HoleCards:  gs.GetLLMHoleCards(i),
			Rebought:   isRebought[i],
		})
		if p.TotalBetThisHand > 0 {
			r.record.Blinds = append(r.record.Blinds, history.BlindRecord{Seat: i, Amount: p.TotalBetThisHand})
		}
	}
	return r
}

// beginDecision captures the situation the current player faces, before they act. The
// prompt text arrives with the reply (the LLM service renders it) and is stored in endDecision.
func (r *handRecorder) beginDecision(gs *game.GameState, legal []game.LLMValidAction) {
	idx := gs.CurrentPlayerIdx
	p := gs.Players[idx]
	n := len(r.record.Actions) + 1
	r.pending = &history.ActionRecord{
		N:            n,
		Street:       gs.Street.String(),
		Seat:         idx,
		Player:       p.Name,
		PotBefore:    gs.SimplifiedPotCalculation(),
		ToCall:       max(gs.CurrentBet-p.CurrentBet, 0),
		StackBefore:  p.Stack,
		LegalActions: legal,
		PromptID:     fmt.Sprintf("%s-%02d", r.record.HandID, n),
	}
	r.prompts = append(r.prompts, HandPrompt{PromptID: r.pending.PromptID, N: n})
}

// appliedAction is the move the engine makes of a legal action, as the stream's llm_action and
// the saved hand name it: chips added on a CALL, the street total on a BET, RAISE or ALL_IN,
// 0 on FOLD and CHECK.
func appliedAction(gs *game.GameState, action game.Action) history.AppliedAction {
	applied, err := gs.CheckAction(action)
	if err != nil {
		return history.AppliedAction{Type: "FOLD"} // the caller checked it; ProcessAction folds too
	}
	name := applied.Name()
	if applied.Type == game.ActionAllIn {
		name = "ALL_IN"
	}
	return history.AppliedAction{Type: name, Amount: applied.Amount}
}

// endDecision records the reply and what the engine applied for it.
func (r *handRecorder) endDecision(turn llmTurn) {
	decision := turn.decision
	a := r.pending
	if a == nil {
		return
	}
	r.pending = nil

	a.Parsed = history.ParsedAction{Action: decision.Action, Amount: decision.Amount, Reason: decision.Reason}
	a.LatencyMs = decision.LatencyMs
	a.TokensIn, a.TokensOut, a.CostUSD = decision.TokensIn, decision.TokensOut, decision.CostUSD
	a.Status = decision.Status
	a.Retried = decision.Retried
	switch {
	case turn.serviceErr:
		a.Status = "service_error"
	case turn.fallback && (a.Status == "" || a.Status == "ok"):
		a.Status = "illegal" // the service said ok but the engine refused the move
	case a.Status == "":
		a.Status = "ok"
	}
	a.PromptVersion, a.Model, a.UpstreamProvider, a.ReasoningTokens = decision.PromptVersion, decision.Model, decision.UpstreamProvider, decision.ReasoningTokens
	a.Applied = turn.applied

	p := &r.prompts[len(r.prompts)-1]
	p.Prompt, p.RawReply, p.RetryPrompt = decision.Prompt, decision.Raw, decision.RetryPrompt
	r.record.Actions = append(r.record.Actions, *a)

	if r.record.Config.Provider == "" {
		r.record.Config.Provider = decision.Provider
		r.record.Config.PromptVersion = decision.PromptVersion
	}
	for i := range r.record.Seats {
		if r.record.Seats[i].Seat == a.Seat && decision.Model != "" {
			r.record.Seats[i].Model = decision.Model
		}
	}
}

// finish is called once the hand is complete and pots are awarded.
func (r *handRecorder) finish(gs *game.GameState) (history.HandRecord, []HandPrompt) {
	r.record.EndedAt = time.Now().UTC()
	r.record.Board = gs.GetLLMCommunityCards()

	wentToShowdown := false
	r.record.Result = history.HandResult{Pots: []history.PotRecord{}, Showdown: []history.ShowdownRecord{}, Net: map[string]int{}}
	for _, w := range gs.Winners {
		if w.PotNumber != 0 { // 0 is a pot won by everyone else folding
			wentToShowdown = true
		}
		r.record.Result.Pots = append(r.record.Result.Pots, history.PotRecord{Amount: w.Amount, WinnerSeat: w.PlayerIdx, EligibleSeats: w.EligiblePlayers, PotNumber: w.PotNumber})
	}

	for _, seat := range r.record.Seats {
		p := gs.Players[seat.Seat]
		if net := p.Stack - seat.StackStart; net != 0 {
			r.record.Result.Net[fmt.Sprint(seat.Seat)] = net
		}
		if wentToShowdown && (p.Status == game.PlayerActive || p.Status == game.PlayerAllIn) {
			r.record.Result.Showdown = append(r.record.Result.Showdown, history.ShowdownRecord{Seat: seat.Seat, HoleCards: seat.HoleCards})
		}
	}
	return r.record, r.prompts
}
