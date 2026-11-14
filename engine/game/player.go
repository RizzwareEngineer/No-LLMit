// This file defines Player (name, stack, cards, status), Action (fold/check/call/raise/all-in),
// and status types (active, folded, all-in). These are the core data types that
// game.go and action.go use to track who's doing what at the table.
package game

type PlayerStatus int

const (
	PlayerActive PlayerStatus = iota
	PlayerFolded
	PlayerAllIn
)

func (ps PlayerStatus) String() string {
	return []string{"active", "folded", "all-in"}[ps]
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
	Type      ActionType
	Amount    int  // For raise/all-in, the total bet amount
	PlayerIdx int  // Which player took the action
	Bet       bool // an applied raise that opened the street's betting (RaiseName)
}

// Name is what viewers and saved hands call an applied action: its type, or BET for a raise
// that opened the betting.
func (a Action) Name() string {
	if a.Bet {
		return "BET"
	}
	return a.Type.String()
}

// Player represents a player at the table
type Player struct {
	ID                string
	Name              string
	Stack             int
	HoleCards         []Card
	Status            PlayerStatus
	CurrentBet        int  // Bet in current betting round
	TotalBetThisHand  int  // Total invested this hand
	HasActedThisRound bool // Internal tracking
	RaiseClosed       bool // Acted, then faced only an incomplete all-in raise: may call or fold, not raise
	LastAction        *Action
	Winnings          int // Cumulative winnings/losses
}
