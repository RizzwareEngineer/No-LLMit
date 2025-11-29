package api

import (
	"github.com/rizzwareengineer/no-LLMit/engine/game"
)

// MessageType represents the type of WebSocket message
type MessageType string

const (
	// Client -> Server messages
	MsgNewGame     MessageType = "new_game"
	MsgStartHand   MessageType = "start_hand"
	MsgAction      MessageType = "action"
	MsgGetState    MessageType = "get_state"
	
	// Server -> Client messages
	MsgGameState   MessageType = "game_state"
	MsgError       MessageType = "error"
	MsgHandStart   MessageType = "hand_start"
	MsgActionReq   MessageType = "action_required"
	MsgStreetChange MessageType = "street_change"
	MsgHandComplete MessageType = "hand_complete"
	MsgPotAwarded  MessageType = "pot_awarded"
)

// ClientMessage represents a message from client to server
type ClientMessage struct {
	Type    MessageType     `json:"type"`
	Payload interface{}     `json:"payload,omitempty"`
}

// ServerMessage represents a message from server to client
type ServerMessage struct {
	Type    MessageType     `json:"type"`
	Payload interface{}     `json:"payload,omitempty"`
}

// NewGamePayload is the payload for creating a new game
type NewGamePayload struct {
	PlayerNames   []string      `json:"playerNames"`
	StartingStack int           `json:"startingStack"`
	SmallBlind    int           `json:"smallBlind"`
	BigBlind      int           `json:"bigBlind"`
	Mode          string        `json:"mode"` // "simulate", "play", "test"
	UserSeatIdx   int           `json:"userSeatIdx"`
}

// ActionPayload is the payload for a player action
type ActionPayload struct {
	PlayerIdx int    `json:"playerIdx"`
	Action    string `json:"action"` // "fold", "check", "call", "raise", "all-in"
	Amount    int    `json:"amount,omitempty"` // For raise
}

// GameStatePayload is the full game state sent to clients
type GameStatePayload struct {
	ID               string              `json:"id"`
	HandNumber       int                 `json:"handNumber"`
	Street           string              `json:"street"`
	Pot              int                 `json:"pot"`
	CommunityCards   []string            `json:"communityCards"`
	CurrentBet       int                 `json:"currentBet"`
	MinRaise         int                 `json:"minRaise"`
	CurrentPlayerIdx int                 `json:"currentPlayerIdx"`
	ButtonIdx        int                 `json:"buttonIdx"`
	Players          []PlayerStatePayload `json:"players"`
	ValidActions     []ValidActionPayload `json:"validActions,omitempty"`
	Winners          []WinnerPayload      `json:"winners,omitempty"`
	Mode             string              `json:"mode"`
	Stakes           StakesPayload       `json:"stakes"`
	GameStartTime    string              `json:"gameStartTime"` // ISO8601 timestamp
}

// PlayerStatePayload represents a player's state for the client
type PlayerStatePayload struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Stack      int      `json:"stack"`
	HoleCards  []string `json:"holeCards,omitempty"` // Only visible in test mode or at showdown
	Status     string   `json:"status"`
	CurrentBet int      `json:"currentBet"`
	LastAction string   `json:"lastAction,omitempty"`
	LastAmount int      `json:"lastAmount,omitempty"`
	IsButton   bool     `json:"isButton"`
	Winnings   int      `json:"winnings"`
}

// ValidActionPayload represents a valid action for the client
type ValidActionPayload struct {
	Type      string `json:"type"`
	MinAmount int    `json:"minAmount,omitempty"`
	MaxAmount int    `json:"maxAmount,omitempty"`
}

// WinnerPayload represents a winner for the client
type WinnerPayload struct {
	PlayerIdx       int    `json:"playerIdx"`
	Amount          int    `json:"amount"`
	HandType        string `json:"handType"`
	HandDesc        string `json:"handDesc"`
	EligiblePlayers []int  `json:"eligiblePlayers"` // Player indices who competed for this pot
	PotNumber       int    `json:"potNumber"`       // 1 = main pot, 2+ = side pots
}

// StakesPayload represents the blind structure
type StakesPayload struct {
	SmallBlind int `json:"smallBlind"`
	BigBlind   int `json:"bigBlind"`
}

// ErrorPayload is the payload for error messages
type ErrorPayload struct {
	Message string `json:"message"`
}

// ActionRequiredPayload tells client who needs to act
type ActionRequiredPayload struct {
	PlayerIdx    int                  `json:"playerIdx"`
	PlayerName   string               `json:"playerName"`
	ValidActions []ValidActionPayload `json:"validActions"`
	TimeoutMs    int                  `json:"timeoutMs,omitempty"`
}

// HandCompletePayload announces hand completion
type HandCompletePayload struct {
	Winners     []WinnerPayload `json:"winners"`
	HandNumber  int             `json:"handNumber"`
}

// ConvertGameState converts internal game state to client payload
func ConvertGameState(gs *game.GameState, showAllCards bool) GameStatePayload {
	players := make([]PlayerStatePayload, len(gs.Players))
	for i, p := range gs.Players {
		var holeCards []string
		// Show cards in test mode, at showdown, or if it's the user's cards in play mode
		canSeeCards := showAllCards ||
			gs.Street == game.StreetShowdown ||
			gs.Street == game.StreetComplete ||
			(gs.Mode == game.ModePlay && i == gs.UserSeatIdx)

		if canSeeCards {
			for _, c := range p.HoleCards {
				holeCards = append(holeCards, c.String())
			}
		}

		var lastAction string
		var lastAmount int
		if p.LastAction != nil {
			lastAction = p.LastAction.Type.String()
			lastAmount = p.LastAction.Amount
		}

		players[i] = PlayerStatePayload{
			ID:         p.ID,
			Name:       p.Name,
			Stack:      p.Stack,
			HoleCards:  holeCards,
			Status:     p.Status.String(),
			CurrentBet: p.CurrentBet,
			LastAction: lastAction,
			LastAmount: lastAmount,
			IsButton:   i == gs.ButtonIdx,
			Winnings:   p.Winnings,
		}
	}

	var communityCards []string
	for _, c := range gs.CommunityCards {
		communityCards = append(communityCards, c.String())
	}

	var validActions []ValidActionPayload
	if gs.IsWaitingForAction() {
		for _, va := range gs.GetValidActions() {
			validActions = append(validActions, ValidActionPayload{
				Type:      va.Type.String(),
				MinAmount: va.MinAmount,
				MaxAmount: va.MaxAmount,
			})
		}
	}

	var winners []WinnerPayload
	for _, w := range gs.Winners {
		winners = append(winners, WinnerPayload{
			PlayerIdx: w.PlayerIdx,
			Amount:    w.Amount,
			HandType:  w.HandType.String(),
			HandDesc:  w.HandDesc,
		})
	}

	return GameStatePayload{
		ID:               gs.ID,
		HandNumber:       gs.HandNumber,
		Street:           gs.Street.String(),
		Pot:              gs.GetTotalPot(),
		CommunityCards:   communityCards,
		CurrentBet:       gs.CurrentBet,
		MinRaise:         gs.MinRaise,
		CurrentPlayerIdx: gs.CurrentPlayerIdx,
		ButtonIdx:        gs.ButtonIdx,
		Players:          players,
		ValidActions:     validActions,
		Winners:          winners,
		Mode:             gs.Mode.String(),
		Stakes: StakesPayload{
			SmallBlind: gs.Stakes.SmallBlind,
			BigBlind:   gs.Stakes.BigBlind,
		},
		GameStartTime:    gs.GameStartTime.Format("2006-01-02T15:04:05Z07:00"), // ISO8601
	}
}

// ParseActionType converts string action to ActionType
func ParseActionType(s string) game.ActionType {
	switch s {
	case "FOLD", "fold":
		return game.ActionFold
	case "CHECK", "check":
		return game.ActionCheck
	case "CALL", "call":
		return game.ActionCall
	case "RAISE", "raise":
		return game.ActionRaise
	case "ALL-IN", "all-in", "allin":
		return game.ActionAllIn
	default:
		return game.ActionFold
	}
}

// ParseGameMode converts string mode to GameMode
func ParseGameMode(s string) game.GameMode {
	switch s {
	case "simulate":
		return game.ModeSimulate
	case "play":
		return game.ModePlay
	case "test":
		return game.ModeTest
	default:
		return game.ModeTest
	}
}

