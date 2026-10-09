// This file defines the structures used to record a hand for LLMs. game.go appends an
// LLMAction for every action, and prompt.go turns the current hand into the text prompt
// that api/llm_handlers.go sends to the Python LLM service.
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

// One recorded action. Amount is what the player put in for a blind or call, and the
// total bet on that street for a raise or all-in. Pot is the pot after the action.
type LLMAction struct {
	Player string `json:"player"`
	Action string `json:"action"`
	Amount int    `json:"amount,omitempty"`
	Street string `json:"street"`
	Pot    int    `json:"pot"`
}

// Shared across all LLMs - they see the same hand history
type LLMPreviousHand struct {
	Players        []LLMPlayer      `json:"players"`
	CommunityCards []string         `json:"communityCards"`
	Actions        []LLMAction      `json:"actions"`
	Showdown       []map[string]any `json:"showdown"`
	Winners        []map[string]any `json:"winners"`
}
