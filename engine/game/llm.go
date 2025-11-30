// This file defines the JSON structures sent to LLMs when asking for their next action.
// LLMPromptPayload contains everything an LLM needs: their cards, valid actions, pot size,
// all previous actions this hand, and full history of previous hands. game.go builds these
// payloads, and api/llm_handlers.go sends them to the Python LLM service.
package game

type LLMPlayer struct {
	Name     string `json:"name"`
	Seat     int    `json:"seat"`
	Stack    int    `json:"stack"`
	Position string `json:"position"`
}

type LLMValidAction struct {
	Type        string `json:"type"`
	Amount      int    `json:"amount,omitempty"`
	Min         int    `json:"min,omitempty"`
	Max         int    `json:"max,omitempty"`
	Description string `json:"description,omitempty"`
}

// Shared across all LLMs - they see the same hand history
type LLMPreviousHand struct {
	Players        []LLMPlayer      `json:"players"`
	CommunityCards []string         `json:"communityCards"`
	Actions        []map[string]any `json:"actions"`
	Showdown       []map[string]any `json:"showdown"`
	Winners        []map[string]any `json:"winners"`
}

type LLMPromptPayload struct {
	YourName        string            `json:"yourName"`
	YourCards       []string          `json:"yourCards"`
	Players         []LLMPlayer       `json:"players"`
	CommunityCards  []string          `json:"communityCards"`
	Pot             int               `json:"pot"`
	ActionsThisHand []map[string]any  `json:"actionsThisHand"`
	PreviousHands   []LLMPreviousHand `json:"previousHands"`
	ValidActions    []LLMValidAction  `json:"validActions"`
}
