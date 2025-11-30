// This file defines Player (name, stack, cards, status), Action (fold/check/call/raise/all-in),
// and status types (active, folded, all-in, eliminated). These are the core data types that
// game.go and action.go use to track who's doing what at the table.
package game

type PlayerStatus int

const (
	PlayerActive PlayerStatus = iota
	PlayerFolded
	PlayerAllIn
	PlayerEliminated // Out of chips, out of game
	PlayerSittingOut
)

func (ps PlayerStatus) String() string {
	return []string{"active", "folded", "all-in", "eliminated", "sitting-out"}[ps]
}

// ActionType represents a player action
type ActionType int

const (
	ActionFold ActionType = iota
	ActionCheck
	ActionCall
	ActionRaise
	ActionAllIn
)

func (at ActionType) String() string {
	return []string{"FOLD", "CHECK", "CALL", "RAISE", "ALL-IN"}[at]
}

// Action represents a player's action
type Action struct {
	Type      ActionType `json:"type"`
	Amount    int        `json:"amount"`    // For raise/all-in, the total bet amount
	PlayerIdx int        `json:"playerIdx"` // Which player took the action
}

// Player represents a player at the table
type Player struct {
	ID                string       `json:"id"`
	Name              string       `json:"name"`
	Stack             int          `json:"stack"`
	HoleCards         []Card       `json:"holeCards,omitempty"` // Hidden unless test mode or showdown
	Status            PlayerStatus `json:"status"`
	CurrentBet        int          `json:"currentBet"`       // Bet in current betting round
	TotalBetThisHand  int          `json:"totalBetThisHand"` // Total invested this hand
	HasActedThisRound bool         `json:"-"`                // Internal tracking
	LastAction        *Action      `json:"lastAction,omitempty"`
	SeatPosition      int          `json:"seatPosition"`
	Winnings          int          `json:"winnings"` // Cumulative winnings/losses
}

