// Called by engine/api/table.go during an LLM's turn: posts the game state as data to
// llm/app.py, which renders the prompts, asks the seat's model and returns the move.
package client

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"time"
)

var (
	llmServiceURL = getEnv("LLM_SERVICE_URL", "http://localhost:5001")
	// The service's whole-turn budget (llm/decide.py TURN_BUDGET, 45s) plus slack.
	llmTimeout = 50 * time.Second
	// TurnBudget is how long a model has for one turn: GET /models' turn_budget_s once
	// GetSeated has read it, llmTimeout until then. Viewers' shot clock counts it down.
	TurnBudget = llmTimeout
)

func getEnv(key, fallback string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return fallback
}

// DecisionRequest is the game state one decision is made from. Mirrors llm/schemas.py.
type DecisionRequest struct {
	PlayerName   string        `json:"player_name"` // roster name of the seat's model; never shown to it
	SmallBlind   int           `json:"small_blind"`
	BigBlind     int           `json:"big_blind"`
	Seats        []Seat        `json:"seats"`   // clockwise from the small blind
	Streets      []Street      `json:"streets"` // preflop first, up to the current street
	Seat         int           `json:"seat"`    // the acting player
	Position     string        `json:"position"`
	HoleCards    []string      `json:"hole_cards"`
	Pot          int           `json:"pot"`
	ToCall       int           `json:"to_call"`
	Stack        int           `json:"stack"`
	LegalActions []LegalAction `json:"legal_actions"`
}

type Seat struct {
	Seat     int    `json:"seat"`
	Position string `json:"position"`
	Stack    int    `json:"stack"` // current stack
}

type Street struct {
	Street  string         `json:"street"`
	Board   []string       `json:"board"`
	Pot     int            `json:"pot"` // pot when the street began
	Actions []StreetAction `json:"actions"`
}

// StreetAction is one action: post, fold, check, call, raise or all_in. Amount is chips
// added for post and call, the street total for raise and all_in.
type StreetAction struct {
	Seat   int    `json:"seat"`
	Action string `json:"action"`
	Amount int    `json:"amount,omitempty"`
}

type LegalAction struct {
	Type   string `json:"type"`
	Amount int    `json:"amount,omitempty"`
	Min    int    `json:"min,omitempty"`
	Max    int    `json:"max,omitempty"`
}

type LLMDecisionResponse struct {
	Action    string `json:"action"`
	Amount    int    `json:"amount"`
	Reason    string `json:"reason"`
	Raw       string `json:"raw"`
	LatencyMs int    `json:"latency_ms"`

	// Status is ok; unparseable or illegal (the model's own miss, twice); timeout or
	// api_error (the provider failed). Anything but ok means Action is the service's
	// fallback (CHECK when legal, else FOLD), not the model's choice.
	Status      string `json:"status"`
	Retried     bool   `json:"retried"`
	Error       string `json:"error"`
	Prompt      string `json:"prompt"`       // the user prompt the model saw
	RetryPrompt string `json:"retry_prompt"` // the follow-up after an invalid reply, when retried

	Provider         string   `json:"provider"`
	Model            string   `json:"model"`
	TokensIn         *int     `json:"tokens_in"`
	TokensOut        *int     `json:"tokens_out"`
	CostUSD          *float64 `json:"cost_usd"`
	PromptVersion    string   `json:"prompt_version"`
	ReasoningTokens  *int     `json:"reasoning_tokens"`
	UpstreamProvider string   `json:"upstream_provider"`
}

func GetLLMDecision(req DecisionRequest) (*LLMDecisionResponse, error) {
	jsonBody, err := json.Marshal(req)
	if err != nil {
		return nil, fmt.Errorf("failed to marshal request: %w", err)
	}

	httpClient := &http.Client{Timeout: llmTimeout}
	url := fmt.Sprintf("%s/decide", llmServiceURL)

	resp, err := httpClient.Post(url, "application/json", bytes.NewBuffer(jsonBody))
	if err != nil {
		return nil, fmt.Errorf("failed to call LLM service: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("LLM service returned status %d", resp.StatusCode)
	}

	var result LLMDecisionResponse
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}

	return &result, nil
}

// getJSON GETs path on the LLM service and decodes its JSON answer into out.
func getJSON(path string, out any) error {
	resp, err := infoClient.Get(llmServiceURL + path)
	if err != nil {
		return fmt.Errorf("LLM service not reachable: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("LLM service returned status %d", resp.StatusCode)
	}
	if err := json.NewDecoder(resp.Body).Decode(out); err != nil {
		return fmt.Errorf("failed to decode response: %w", err)
	}
	return nil
}

var infoClient = &http.Client{Timeout: 5 * time.Second}

// GetLLMUsage returns the LLM service's usage report (provider and spend) as raw JSON.
func GetLLMUsage() (json.RawMessage, error) {
	var raw json.RawMessage
	if err := getJSON("/usage", &raw); err != nil {
		return nil, err
	}
	return raw, nil
}

// GetSystemPrompt returns the system prompt every model receives, for the given version.
func GetSystemPrompt() (version, prompt string, err error) {
	var body struct {
		PromptVersion string `json:"prompt_version"`
		SystemPrompt  string `json:"system_prompt"`
	}
	err = getJSON("/prompt", &body)
	return body.PromptVersion, body.SystemPrompt, err
}

// GetSeated returns the names the LLM service seats at the table, in seat order, and sets
// TurnBudget from the same reply. session is how many sessions the local hand log holds;
// only the mock provider uses it, to rotate the lineup over the whole roster.
func GetSeated(session int) ([]string, error) {
	var body struct {
		Seated      []string `json:"seated"`
		TurnBudgetS float64  `json:"turn_budget_s"`
	}
	err := getJSON(fmt.Sprintf("/models?session=%d", session), &body)
	if err == nil && body.TurnBudgetS > 0 {
		TurnBudget = time.Duration(body.TurnBudgetS * float64(time.Second))
	}
	return body.Seated, err
}
