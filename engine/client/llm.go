// Called by engine/api/llm_handlers.go during an LLM's turn.
// Then sends an HTTP request to llm/app.py to get an LLM's decision/action given the current game state.
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
	llmTimeout    = 30 * time.Second
)

func getEnv(key, fallback string) string {
	if val := os.Getenv(key); val != "" {
		return val
	}
	return fallback
}

type LLMDecisionRequest struct {
	PlayerName   string      `json:"player_name"`
	Prompt       string      `json:"prompt"`
	ValidActions interface{} `json:"valid_actions"`
	Mode         string      `json:"mode,omitempty"`
}

type LLMDecisionResponse struct {
	Action    string `json:"action"`
	Amount    int    `json:"amount"`
	Reason    string `json:"reason"`
	Raw       string `json:"raw"`
	LatencyMs int    `json:"latency_ms"`

	// Status is ok, unparseable, timeout or api_error. Anything but ok means the
	// action is a fallback fold, not the model's choice.
	Status        string   `json:"status"`
	Provider      string   `json:"provider"`
	Model         string   `json:"model"`
	TokensIn      *int     `json:"tokens_in"`
	TokensOut     *int     `json:"tokens_out"`
	CostUSD       *float64 `json:"cost_usd"`
	PromptVersion string   `json:"prompt_version"`
}

func GetLLMDecision(playerName, prompt string, validActions interface{}, mode string) (*LLMDecisionResponse, error) {
	reqBody := LLMDecisionRequest{
		PlayerName:   playerName,
		Prompt:       prompt,
		ValidActions: validActions,
		Mode:         mode,
	}

	jsonBody, err := json.Marshal(reqBody)
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

func CheckLLMServiceHealth() error {
	httpClient := &http.Client{Timeout: 5 * time.Second}
	url := fmt.Sprintf("%s/health", llmServiceURL)

	resp, err := httpClient.Get(url)
	if err != nil {
		return fmt.Errorf("LLM service not reachable: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("LLM service unhealthy: status %d", resp.StatusCode)
	}

	return nil
}

// GetLLMUsage returns the LLM service's usage report (provider and spend) as raw JSON.
func GetLLMUsage() (json.RawMessage, error) {
	httpClient := &http.Client{Timeout: 5 * time.Second}
	resp, err := httpClient.Get(fmt.Sprintf("%s/usage", llmServiceURL))
	if err != nil {
		return nil, fmt.Errorf("LLM service not reachable: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("LLM service returned status %d", resp.StatusCode)
	}

	var raw json.RawMessage
	if err := json.NewDecoder(resp.Body).Decode(&raw); err != nil {
		return nil, fmt.Errorf("failed to decode response: %w", err)
	}
	return raw, nil
}

// GetSystemPrompt returns the system prompt every model receives, for the given version.
func GetSystemPrompt() (version, prompt string, err error) {
	httpClient := &http.Client{Timeout: 5 * time.Second}
	resp, err := httpClient.Get(fmt.Sprintf("%s/prompt", llmServiceURL))
	if err != nil {
		return "", "", fmt.Errorf("LLM service not reachable: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode != http.StatusOK {
		return "", "", fmt.Errorf("LLM service returned status %d", resp.StatusCode)
	}

	var body struct {
		PromptVersion string `json:"prompt_version"`
		SystemPrompt  string `json:"system_prompt"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return "", "", fmt.Errorf("failed to decode response: %w", err)
	}
	return body.PromptVersion, body.SystemPrompt, nil
}
