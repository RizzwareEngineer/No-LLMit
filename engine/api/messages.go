// Stream message types and payloads sent to the frontend (web/) on GET /stream; see
// docs/stream.md.
package api

import (
	"github.com/rizzwareengineer/no-LLMit/engine/game"
)

type MessageType string

const (
	MsgGameState    MessageType = "game_state"
	MsgHandStart    MessageType = "hand_start"
	MsgStreetChange MessageType = "street_change"
	MsgHandComplete MessageType = "hand_complete"
	MsgLLMThinking  MessageType = "llm_thinking"
	MsgLLMAction    MessageType = "llm_action"
	MsgButtonCard   MessageType = "button_card"   // Card dealt for button determination
	MsgButtonWinner MessageType = "button_winner" // Who won the button
	MsgTableNotice  MessageType = "table_notice"  // Table stopped or paused; an empty kind clears it
	MsgSnapshot     MessageType = "snapshot"      // Every table as it is now; replaces all table state
	MsgStats        MessageType = "stats"         // All-time stats: the full body, or the rows that changed
)

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
	CurrentPlayerIdx int                  `json:"currentPlayerIdx"`
	ButtonIdx        int                  `json:"buttonIdx"`
	Players          []PlayerStatePayload `json:"players"`
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
// "outage", "saving", or "" when the table runs again.
type TableNoticePayload struct {
	Kind      string `json:"kind"`
	Message   string `json:"message"`
	ReopensAt string `json:"reopensAt,omitempty"` // RFC3339
}

type HandCompletePayload struct {
	Winners    []WinnerPayload `json:"winners"`
	HandNumber int             `json:"handNumber"`
}

// Turn numbers a hand's turns from 1; a turn's llm_thinking and llm_action share it.
type LLMThinkingPayload struct {
	Turn       int    `json:"turn"`
	PlayerIdx  int    `json:"playerIdx"`
	PlayerName string `json:"playerName"`
}

type LLMActionPayload struct {
	Turn       int    `json:"turn"`
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

	return GameStatePayload{
		ID:               gs.ID,
		HandNumber:       gs.HandNumber,
		Street:           gs.Street.String(),
		Pot:              gs.GetTotalPot(),
		CommunityCards:   game.CardStrings(gs.CommunityCards),
		CurrentPlayerIdx: gs.CurrentPlayerIdx,
		ButtonIdx:        gs.ButtonIdx,
		Players:          players,
		Winners:          convertWinners(gs.Winners),
		Stakes: StakesPayload{
			SmallBlind: gs.Stakes.SmallBlind,
			BigBlind:   gs.Stakes.BigBlind,
		},
		GameStartTime: gs.GameStartTime.Format("2006-01-02T15:04:05Z07:00"),
	}
}

func convertWinners(winners []game.Winner) []WinnerPayload {
	var result []WinnerPayload
	for _, w := range winners {
		result = append(result, WinnerPayload{
			PlayerIdx:       w.PlayerIdx,
			Amount:          w.Amount,
			HandType:        w.HandType.String(),
			HandDesc:        w.HandDesc,
			EligiblePlayers: w.EligiblePlayers,
			PotNumber:       w.PotNumber,
		})
	}
	return result
}

// ParseActionType reads an action name as the LLM service sends it (llm/schemas.py). ok is
// false for anything it does not know, which callers must treat as an illegal move rather
// than a fold.
func ParseActionType(s string) (game.ActionType, bool) {
	switch s {
	case "FOLD":
		return game.ActionFold, true
	case "CHECK":
		return game.ActionCheck, true
	case "CALL":
		return game.ActionCall, true
	case "RAISE":
		return game.ActionRaise, true
	case "ALL_IN":
		return game.ActionAllIn, true
	default:
		return game.ActionFold, false
	}
}
