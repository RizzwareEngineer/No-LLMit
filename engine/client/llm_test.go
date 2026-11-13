package client

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/rizzwareengineer/no-LLMit/engine/game"
)

func TestGetSeated(t *testing.T) {
	budget := ``
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/models" || r.URL.Query().Get("session") != "3" {
			t.Errorf("unexpected request %s", r.URL)
		}
		w.Write([]byte(`{"provider":"mock","seated":["A","B"],"models":[]` + budget + `}`))
	}))
	defer srv.Close()
	old := llmServiceURL
	defer func() { llmServiceURL, TurnBudget = old, llmTimeout }()

	llmServiceURL = srv.URL
	if got, err := GetSeated(3); err != nil || len(got) != 2 || got[0] != "A" {
		t.Fatalf("GetSeated = %v, %v", got, err)
	}
	if TurnBudget != llmTimeout {
		t.Errorf("no turn_budget_s: TurnBudget %v, want the decide timeout %v", TurnBudget, llmTimeout)
	}
	budget = `,"turn_budget_s":45.0`
	if _, err := GetSeated(3); err != nil || TurnBudget != 45*time.Second {
		t.Errorf("turn_budget_s 45: TurnBudget %v, %v", TurnBudget, err)
	}

	srv.Close() // the service is down
	if _, err := GetSeated(0); err == nil {
		t.Fatal("expected an error when the service is down")
	}
}

func TestGetLLMDecisionPostsTheStateAndReadsTheMove(t *testing.T) {
	var got DecisionRequest
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/decide" || r.Method != http.MethodPost {
			t.Errorf("unexpected request %s %s", r.Method, r.URL)
		}
		if err := json.NewDecoder(r.Body).Decode(&got); err != nil {
			t.Error(err)
		}
		w.Write([]byte(`{"action":"RAISE","amount":30,"reason":"Open.","raw":"ACTION: RAISE","latency_ms":9,"status":"ok",
			"retried":false,"error":null,"prompt":"Blinds 5/10","retry_prompt":null,"provider":"openrouter","model":"m",
			"tokens_in":100,"tokens_out":10,"cost_usd":0.001,"prompt_version":"abc1234","reasoning_tokens":null,
			"finish_reason":"stop","upstream_provider":"Host"}`))
	}))
	defer srv.Close()
	old := llmServiceURL
	defer func() { llmServiceURL = old }()
	llmServiceURL = srv.URL

	req := DecisionRequest{PlayerName: "Phi-4", SmallBlind: 5, BigBlind: 10, Seat: 2, Position: "UTG", HoleCards: []string{"Ks", "4d"},
		Seats:        []Seat{{Seat: 0, Position: "SB", Stack: 1995}},
		Streets:      []Street{{Street: "preflop", Actions: []StreetAction{{Seat: 0, Action: "post", Amount: 5}}}},
		LegalActions: []game.LLMValidAction{{Type: "FOLD"}, {Type: "CALL", Amount: 10}}}
	d, err := GetLLMDecision(req)
	if err != nil {
		t.Fatal(err)
	}
	if got.PlayerName != "Phi-4" || got.Streets[0].Actions[0].Amount != 5 || got.LegalActions[1].Amount != 10 {
		t.Errorf("request sent: %+v", got)
	}
	if d.Action != "RAISE" || d.Amount != 30 || d.Status != "ok" || d.Prompt != "Blinds 5/10" || d.UpstreamProvider != "Host" ||
		d.Model != "m" || *d.TokensIn != 100 || d.ReasoningTokens != nil || d.PromptVersion != "abc1234" {
		t.Errorf("decoded: %+v", d)
	}
}
