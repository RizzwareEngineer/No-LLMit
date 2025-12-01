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
	PlayerName string      `json:"player_name"`
	Payload    interface{} `json:"payload"`
	Mode       string      `json:"mode,omitempty"`
}

type LLMDecisionResponse struct {
	Action    string `json:"action"`
	Amount    int    `json:"amount"`
	Reason    string `json:"reason"`
	Raw       string `json:"raw"`
	LatencyMs int    `json:"latency_ms"`
}

func GetLLMDecision(playerName string, payload interface{}, mode string) (*LLMDecisionResponse, error) {
	reqBody := LLMDecisionRequest{
		PlayerName: playerName,
		Payload:    payload,
		Mode:       mode,
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
