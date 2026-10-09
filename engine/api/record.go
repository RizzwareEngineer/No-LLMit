// Builds the saved record of a hand: who sat where with which cards, every decision in
// order with the situation the player faced and what they did, and the result. The
// prompt and raw reply for each decision are kept separately (HandPrompt) and linked by
// prompt_id. Used by table.go; store.go saves the result.
package api

import (
	"fmt"
	"time"

	"github.com/rizzwareengineer/no-LLMit/engine/client"
	"github.com/rizzwareengineer/no-LLMit/engine/game"
)

const handRecordSchema = 1

type HandRecord struct {
	Schema     int            `json:"schema"`
	HandID     string         `json:"hand_id"`
	TableID    string         `json:"table_id"`
	HandNumber int            `json:"hand_number"`
	StartedAt  time.Time      `json:"started_at"`
	EndedAt    time.Time      `json:"ended_at"`
	Config     HandConfig     `json:"config"`
	ButtonSeat int            `json:"button_seat"`
	Seats      []SeatRecord   `json:"seats"`
	Blinds     []BlindRecord  `json:"blinds"`
	Deck       []string       `json:"deck"`
	Board      []string       `json:"board"`
	Actions    []ActionRecord `json:"actions"`
	Result     HandResult     `json:"result"`
}

type HandConfig struct {
	SmallBlind    int    `json:"small_blind"`
	BigBlind      int    `json:"big_blind"`
	Provider      string `json:"provider"`
	PromptVersion string `json:"prompt_version"`
	Memory        string `json:"memory"` // what the models are told about earlier hands
}

type SeatRecord struct {
	Seat       int      `json:"seat"`
	Name       string   `json:"name"`
	Model      string   `json:"model,omitempty"`
	Position   string   `json:"position"`
	StackStart int      `json:"stack_start"`
	HoleCards  []string `json:"hole_cards"`
	Rebought   bool     `json:"rebought,omitempty"` // topped back up before this hand
}

type BlindRecord struct {
	Seat   int `json:"seat"`
	Amount int `json:"amount"`
}

type ActionRecord struct {
	N            int                   `json:"n"`
	Street       string                `json:"street"`
	Seat         int                   `json:"seat"`
	Player       string                `json:"player"`
	PotBefore    int                   `json:"pot_before"`
	ToCall       int                   `json:"to_call"`
	StackBefore  int                   `json:"stack_before"`
	LegalActions []game.LLMValidAction `json:"legal_actions"`
	PromptID     string                `json:"prompt_id"`
	Parsed       ParsedAction          `json:"parsed"`
	// Status is ok, or why Applied is not the model's own choice: unparseable, timeout,
	// api_error, service_error (LLM service unreachable) or illegal (move not allowed).
	Status    string        `json:"status"`
	Applied   AppliedAction `json:"applied"`
	LatencyMs int           `json:"latency_ms"`
	TokensIn  *int          `json:"tokens_in"`
	TokensOut *int          `json:"tokens_out"`
	CostUSD   *float64      `json:"cost_usd"`
}

// ParsedAction is what we read from the model's reply.
type ParsedAction struct {
	Action string `json:"action"`
	Amount int    `json:"amount"`
	Reason string `json:"reason"`
}

// AppliedAction is what the engine actually did: FOLD, CHECK, CALL, BET, RAISE or ALL_IN.
// Amount is chips put in for a call, and the total bet this street otherwise.
type AppliedAction struct {
	Type   string `json:"type"`
	Amount int    `json:"amount,omitempty"`
}

type HandResult struct {
	Pots     []PotRecord      `json:"pots"`
	Showdown []ShowdownRecord `json:"showdown"`
	Net      map[string]int   `json:"net"` // seat -> chips won or lost; sums to zero
}

type PotRecord struct {
	Amount        int   `json:"amount"`
	WinnerSeat    int   `json:"winner_seat"`
	EligibleSeats []int `json:"eligible_seats,omitempty"`
	PotNumber     int   `json:"pot_number,omitempty"` // 1 = main pot, 2+ = side pots
}

type ShowdownRecord struct {
	Seat      int      `json:"seat"`
	HoleCards []string `json:"hole_cards"`
}

// HandPrompt is the exact text one decision was made from and the reply to it.
type HandPrompt struct {
	PromptID string `json:"prompt_id"`
	N        int    `json:"n"`
	Prompt   string `json:"prompt"`
	RawReply string `json:"raw_reply"`
}

// handRecorder accumulates one hand's record as it is played.
type handRecorder struct {
	record  HandRecord
	prompts []HandPrompt
	pending *ActionRecord
}

// newHandRecorder is called right after StartHand, once blinds are posted and cards dealt.
func newHandRecorder(gs *game.GameState, tableID string, rebought []int) *handRecorder {
	r := &handRecorder{record: HandRecord{
		Schema:     handRecordSchema,
		HandID:     fmt.Sprintf("%s-%06d", tableID, gs.HandNumber),
		TableID:    tableID,
		HandNumber: gs.HandNumber,
		StartedAt:  time.Now().UTC(),
		Config:     HandConfig{SmallBlind: gs.Stakes.SmallBlind, BigBlind: gs.Stakes.BigBlind, Memory: "none"},
		ButtonSeat: gs.ButtonIdx,
		Deck:       gs.DeckOrder(),
		Board:      []string{},
		Actions:    []ActionRecord{},
	}}

	isRebought := map[int]bool{}
	for _, i := range rebought {
		isRebought[i] = true
	}
	for i, p := range gs.Players {
		if len(p.HoleCards) == 0 {
			continue // not dealt in
		}
		r.record.Seats = append(r.record.Seats, SeatRecord{
			Seat:       i,
			Name:       p.Name,
			Position:   gs.PositionName(i),
			StackStart: p.Stack + p.TotalBetThisHand,
			HoleCards:  gs.GetLLMHoleCards(i),
			Rebought:   isRebought[i],
		})
		if p.TotalBetThisHand > 0 {
			r.record.Blinds = append(r.record.Blinds, BlindRecord{Seat: i, Amount: p.TotalBetThisHand})
		}
	}
	return r
}

// beginDecision captures the situation the current player faces, before they act.
func (r *handRecorder) beginDecision(gs *game.GameState, legal []game.LLMValidAction, prompt string) {
	idx := gs.CurrentPlayerIdx
	p := gs.Players[idx]
	n := len(r.record.Actions) + 1
	r.pending = &ActionRecord{
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
	r.prompts = append(r.prompts, HandPrompt{PromptID: r.pending.PromptID, N: n, Prompt: prompt})
}

// endDecision records the reply and what the engine applied. serviceErr is set when the
// LLM service could not be reached; illegal when the engine rejected the model's move.
func (r *handRecorder) endDecision(gs *game.GameState, decision *client.LLMDecisionResponse, serviceErr, illegal bool) {
	a := r.pending
	if a == nil {
		return
	}
	r.pending = nil

	a.Parsed = ParsedAction{Action: decision.Action, Amount: decision.Amount, Reason: decision.Reason}
	a.LatencyMs = decision.LatencyMs
	a.TokensIn, a.TokensOut, a.CostUSD = decision.TokensIn, decision.TokensOut, decision.CostUSD
	a.Status = decision.Status
	switch {
	case serviceErr:
		a.Status = "service_error"
	case illegal:
		a.Status = "illegal"
	case a.Status == "":
		a.Status = "ok"
	}

	if last := gs.Players[a.Seat].LastAction; last != nil {
		switch last.Type {
		case game.ActionFold:
			a.Applied = AppliedAction{Type: "FOLD"}
		case game.ActionCheck:
			a.Applied = AppliedAction{Type: "CHECK"}
		case game.ActionCall:
			a.Applied = AppliedAction{Type: "CALL", Amount: last.Amount}
		case game.ActionAllIn:
			a.Applied = AppliedAction{Type: "ALL_IN", Amount: last.Amount}
		case game.ActionRaise:
			// The first chips in on a postflop street are a bet; preflop the blinds are
			// already a bet, so it is always a raise.
			kind := "RAISE"
			if a.ToCall == 0 && a.Street != game.StreetPreflop.String() {
				kind = "BET"
			}
			a.Applied = AppliedAction{Type: kind, Amount: last.Amount}
		}
	}

	r.prompts[len(r.prompts)-1].RawReply = decision.Raw
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
func (r *handRecorder) finish(gs *game.GameState) (HandRecord, []HandPrompt) {
	r.record.EndedAt = time.Now().UTC()
	r.record.Board = gs.GetLLMCommunityCards()

	wentToShowdown := false
	r.record.Result = HandResult{Pots: []PotRecord{}, Showdown: []ShowdownRecord{}, Net: map[string]int{}}
	for _, w := range gs.Winners {
		pot := PotRecord{Amount: w.Amount, WinnerSeat: w.PlayerIdx, EligibleSeats: w.EligiblePlayers, PotNumber: w.PotNumber}
		if w.PotNumber == 0 {
			// Everyone else folded. The engine reports the winner's profit here, so add
			// back their own chips to record the whole pot.
			pot.Amount = w.Amount + gs.Players[w.PlayerIdx].TotalBetThisHand
		} else {
			wentToShowdown = true
		}
		r.record.Result.Pots = append(r.record.Result.Pots, pot)
	}

	for _, seat := range r.record.Seats {
		p := gs.Players[seat.Seat]
		if net := p.Stack - seat.StackStart; net != 0 {
			r.record.Result.Net[fmt.Sprint(seat.Seat)] = net
		}
		if wentToShowdown && (p.Status == game.PlayerActive || p.Status == game.PlayerAllIn) {
			r.record.Result.Showdown = append(r.record.Result.Showdown, ShowdownRecord{Seat: seat.Seat, HoleCards: seat.HoleCards})
		}
	}
	return r.record, r.prompts
}
