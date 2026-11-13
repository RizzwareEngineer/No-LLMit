// This file defines the structures used to record a hand for LLMs. game.go appends an
// LLMAction for every action; engine/api/decision.go turns the hand into the data the LLM
// service renders its prompt from (llm/prompts.py).
package game

// LLMValidAction is one legal move as the LLM service gets it (llm/schemas.py LegalAction)
// and as each saved decision keeps it in legal_actions. Type is FOLD, CHECK, CALL, BET,
// RAISE or ALL-IN; Amount is chips to add for CALL and the street total for ALL-IN; Min and
// Max are the street-total range of a BET or RAISE.
type LLMValidAction struct {
	Type   string `json:"type"`
	Amount int    `json:"amount,omitempty"`
	Min    int    `json:"min,omitempty"`
	Max    int    `json:"max,omitempty"`
}

// One recorded action. Amount is what the player put in for a blind or call, and the
// total bet on that street for a raise or all-in. Pot is the pot after the action.
type LLMAction struct {
	Seat   int
	Action string
	Amount int
	Street Street
	Pot    int
}
