// WebSocket message types and payloads for communication between frontend (web/) and server.
// Used by server.go to serialize/deserialize messages.
package api

import (
	"github.com/rizzwareengineer/no-LLMit/engine/game"
)

type MessageType string

const (
	// Client → Server
	MsgGetState MessageType = "get_state"

	// Server → Client
	MsgGameState    MessageType = "game_state"
	MsgError        MessageType = "error"
	MsgHandStart    MessageType = "hand_start"
	MsgStreetChange MessageType = "street_change"
	MsgHandComplete MessageType = "hand_complete"
	MsgLLMThinking  MessageType = "llm_thinking"
	MsgLLMAction    MessageType = "llm_action"
	MsgButtonCard   MessageType = "button_card"   // Card dealt for button determination
	MsgButtonWinner MessageType = "button_winner" // Who won the button
	MsgTableNotice  MessageType = "table_notice"  // Table closed or capped; an empty kind clears it
)

type ClientMessage struct {
	Type    MessageType `json:"type"`
	Payload interface{} `json:"payload,omitempty"`
}

type ServerMessage struct {
	Type    MessageType `json:"type"`
	Payload interface{} `json:"payload,omitempty"`
}

type GameStatePayload struct {
	ID               string               `json:"id"`
	HandNumber       int                  `json:"handNumber"`
	Street           string               `json:"street"`
	Pot              int                  `json:"pot"`
	CommunityCards   []string             `json:"communityCards"`
	CurrentBet       int                  `json:"currentBet"`
	MinRaise         int                  `json:"minRaise"`
	CurrentPlayerIdx int                  `json:"currentPlayerIdx"`
	ButtonIdx        int                  `json:"buttonIdx"`
	Players          []PlayerStatePayload `json:"players"`
	ValidActions     []ValidActionPayload `json:"validActions,omitempty"`
	Winners          []WinnerPayload      `json:"winners,omitempty"`
	Stakes           StakesPayload        `json:"stakes"`
	GameStartTime    string               `json:"gameStartTime"`
	NextHandInMs     int                  `json:"nextHandInMs,omitempty"` // Shared table: time until the next hand is dealt
}

type PlayerStatePayload struct {
	ID         string   `json:"id"`
	Name       string   `json:"name"`
	Stack      int      `json:"stack"`
	HoleCards  []string `json:"holeCards,omitempty"`
	Status     string   `json:"status"`
	CurrentBet int      `json:"currentBet"`
	LastAction string   `json:"lastAction,omitempty"`
	LastAmount int      `json:"lastAmount,omitempty"`
	IsButton   bool     `json:"isButton"`
	Position   string   `json:"position"` // BTN, SB, BB, UTG, ... as the models are told
	Winnings   int      `json:"winnings"`
}

type ValidActionPayload struct {
	Type      string `json:"type"`
	MinAmount int    `json:"minAmount,omitempty"`
	MaxAmount int    `json:"maxAmount,omitempty"`
}

type WinnerPayload struct {
	PlayerIdx       int    `json:"playerIdx"`
	Amount          int    `json:"amount"`
	HandType        string `json:"handType"`
	HandDesc        string `json:"handDesc"`
	EligiblePlayers []int  `json:"eligiblePlayers"`
	PotNumber       int    `json:"potNumber"`
}

type StakesPayload struct {
	SmallBlind int `json:"smallBlind"`
	BigBlind   int `json:"bigBlind"`
}

// TableNoticePayload says why the shared table is stopped. Kind is "closed", "cap",
// or "" when the table reopens.
type TableNoticePayload struct {
	Kind      string `json:"kind"`
	Message   string `json:"message"`
	ReopensAt string `json:"reopensAt,omitempty"` // RFC3339
}

type ErrorPayload struct {
	Message string `json:"message"`
}

type HandCompletePayload struct {
	Winners    []WinnerPayload `json:"winners"`
	HandNumber int             `json:"handNumber"`
}

type LLMThinkingPayload struct {
	PlayerIdx  int    `json:"playerIdx"`
	PlayerName string `json:"playerName"`
	Reason     string `json:"reason,omitempty"`
}

type LLMActionPayload struct {
	PlayerIdx  int    `json:"playerIdx"`
	PlayerName string `json:"playerName"`
	Action     string `json:"action"`
	Amount     int    `json:"amount"`
	Reason     string `json:"reason"`
}

type ButtonCardPayload struct {
	PlayerIdx  int    `json:"playerIdx"`
	PlayerName string `json:"playerName"`
	Card       string `json:"card"`
}

type ButtonWinnerPayload struct {
	PlayerIdx  int    `json:"playerIdx"`
	PlayerName string `json:"playerName"`
}

// ConvertGameState builds the spectator view; spectators see every hole card.
func ConvertGameState(gs *game.GameState) GameStatePayload {
	players := make([]PlayerStatePayload, len(gs.Players))
	for i, p := range gs.Players {
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
			HoleCards:  game.CardStrings(p.HoleCards),
			Status:     p.Status.String(),
			CurrentBet: p.CurrentBet,
			LastAction: lastAction,
			LastAmount: lastAmount,
			IsButton:   i == gs.ButtonIdx,
			Position:   gs.PositionName(i),
			Winnings:   p.Winnings,
		}
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
		CommunityCards:   game.CardStrings(gs.CommunityCards),
		CurrentBet:       gs.CurrentBet,
		MinRaise:         gs.MinRaise,
		CurrentPlayerIdx: gs.CurrentPlayerIdx,
		ButtonIdx:        gs.ButtonIdx,
		Players:          players,
		ValidActions:     validActions,
		Winners:          winners,
		Stakes: StakesPayload{
			SmallBlind: gs.Stakes.SmallBlind,
			BigBlind:   gs.Stakes.BigBlind,
		},
		GameStartTime: gs.GameStartTime.Format("2006-01-02T15:04:05Z07:00"),
	}
}

// ParseActionType reads an action name. ok is false for anything it does not know, which
// callers must treat as an illegal move rather than a fold.
func ParseActionType(s string) (game.ActionType, bool) {
	switch s {
	case "FOLD", "fold":
		return game.ActionFold, true
	case "CHECK", "check":
		return game.ActionCheck, true
	case "CALL", "call":
		return game.ActionCall, true
	case "RAISE", "raise":
		return game.ActionRaise, true
	case "ALL_IN", "ALL-IN", "all-in", "allin":
		return game.ActionAllIn, true
	default:
		return game.ActionFold, false
	}
}
