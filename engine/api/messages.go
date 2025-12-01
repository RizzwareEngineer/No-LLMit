// WebSocket message types and payloads for communication between frontend (web/) and server.
// Used by server.go to serialize/deserialize messages.
package api

import (
	"github.com/rizzwareengineer/no-LLMit/engine/game"
)

type MessageType string

const (
	// Client → Server
	MsgNewGame   MessageType = "new_game"
	MsgStartHand MessageType = "start_hand"
	MsgAction    MessageType = "action"
	MsgGetState  MessageType = "get_state"
	MsgPause     MessageType = "pause"
	MsgResume    MessageType = "resume"

	// Server → Client
	MsgGameState      MessageType = "game_state"
	MsgError          MessageType = "error"
	MsgHandStart      MessageType = "hand_start"
	MsgActionReq      MessageType = "action_required"
	MsgStreetChange   MessageType = "street_change"
	MsgHandComplete   MessageType = "hand_complete"
	MsgLLMThinking    MessageType = "llm_thinking"
	MsgLLMAction      MessageType = "llm_action"
	MsgPaused         MessageType = "paused"
	MsgResumed        MessageType = "resumed"
	MsgButtonCard     MessageType = "button_card"     // Card dealt for button determination
	MsgButtonWinner   MessageType = "button_winner"   // Who won the button
)

type ClientMessage struct {
	Type    MessageType `json:"type"`
	Payload interface{} `json:"payload,omitempty"`
}

type ServerMessage struct {
	Type    MessageType `json:"type"`
	Payload interface{} `json:"payload,omitempty"`
}

type NewGamePayload struct {
	PlayerNames   []string `json:"playerNames"`
	StartingStack int      `json:"startingStack"`
	SmallBlind    int      `json:"smallBlind"`
	BigBlind      int      `json:"bigBlind"`
	Mode          string   `json:"mode"` // "simulate", "play", "test"
	UserSeatIdx   int      `json:"userSeatIdx"`
}

type ActionPayload struct {
	PlayerIdx int    `json:"playerIdx"`
	Action    string `json:"action"`
	Amount    int    `json:"amount,omitempty"`
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
	Mode             string               `json:"mode"`
	Stakes           StakesPayload        `json:"stakes"`
	GameStartTime    string               `json:"gameStartTime"`
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

type ErrorPayload struct {
	Message string `json:"message"`
}

type ActionRequiredPayload struct {
	PlayerIdx    int                  `json:"playerIdx"`
	PlayerName   string               `json:"playerName"`
	ValidActions []ValidActionPayload `json:"validActions"`
	TimeoutMs    int                  `json:"timeoutMs,omitempty"`
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

func ConvertGameState(gs *game.GameState, showAllCards bool) GameStatePayload {
	players := make([]PlayerStatePayload, len(gs.Players))
	for i, p := range gs.Players {
		var holeCards []string
		canSeeCards := showAllCards ||
			gs.Mode == game.ModeSimulate ||
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
		GameStartTime: gs.GameStartTime.Format("2006-01-02T15:04:05Z07:00"),
	}
}

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
