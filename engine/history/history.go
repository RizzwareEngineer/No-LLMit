// The saved record of one hand: who sat where with which cards, every decision in
// order with the situation the player faced and what they did, and the result. Built by
// api/record.go, read by stats/.
package history

import (
	"bufio"
	"encoding/json"
	"io"
	"log"
	"strings"
	"time"

	"github.com/rizzwareengineer/no-LLMit/engine/game"
)

type HandRecord struct {
	Schema     int            `json:"schema"`
	HandID     string         `json:"hand_id"`
	TableID    string         `json:"table_id"`
	HandNumber int            `json:"hand_number"`
	StartedAt  time.Time      `json:"started_at"`
	EndedAt    time.Time      `json:"ended_at"`
	Config     HandConfig     `json:"config"`
	ButtonSeat int            `json:"button_seat"`
	Seats      []SeatRecord   `json:"seats"`
	Blinds     []BlindRecord  `json:"blinds"`
	Deck       []string       `json:"deck"`
	Board      []string       `json:"board"`
	Actions    []ActionRecord `json:"actions"`
	Result     HandResult     `json:"result"`
}

type HandConfig struct {
	SmallBlind    int    `json:"small_blind"`
	BigBlind      int    `json:"big_blind"`
	Provider      string `json:"provider"`
	PromptVersion string `json:"prompt_version"`
	Memory        string `json:"memory"` // what the models are told about earlier hands
}

type SeatRecord struct {
	Seat       int      `json:"seat"`
	Name       string   `json:"name"`
	Model      string   `json:"model,omitempty"`
	Position   string   `json:"position"`
	StackStart int      `json:"stack_start"`
	HoleCards  []string `json:"hole_cards"`
	Rebought   bool     `json:"rebought,omitempty"` // topped back up before this hand
}

type BlindRecord struct {
	Seat   int `json:"seat"`
	Amount int `json:"amount"`
}

type ActionRecord struct {
	N            int                   `json:"n"`
	Street       string                `json:"street"`
	Seat         int                   `json:"seat"`
	Player       string                `json:"player"`
	PotBefore    int                   `json:"pot_before"`
	ToCall       int                   `json:"to_call"`
	StackBefore  int                   `json:"stack_before"`
	LegalActions []game.LLMValidAction `json:"legal_actions"`
	PromptID     string                `json:"prompt_id"`
	Parsed       ParsedAction          `json:"parsed"`
	// Status is ok, or why Applied is not the model's own choice. unparseable and illegal
	// are the model's own miss: it was asked once more (Retried) and the retry was bad
	// too. timeout and api_error are the provider's failure, service_error the LLM
	// service being unreachable. Any fallback is CHECK when legal and FOLD otherwise.
	Status    string        `json:"status"`
	Retried   bool          `json:"retried"`
	Applied   AppliedAction `json:"applied"`
	LatencyMs int           `json:"latency_ms"`
	TokensIn  *int          `json:"tokens_in"`
	TokensOut *int          `json:"tokens_out"`
	CostUSD   *float64      `json:"cost_usd"`
	// Added with the Python-owned prompts; absent on older records.
	PromptVersion    string `json:"prompt_version,omitempty"`    // system prompt, user template and parser
	Model            string `json:"model,omitempty"`             // the model OpenRouter reports serving the call
	UpstreamProvider string `json:"upstream_provider,omitempty"` // the host OpenRouter routed to
	ReasoningTokens  *int   `json:"reasoning_tokens,omitempty"`
}

// ParsedAction is what we read from the model's reply.
type ParsedAction struct {
	Action string `json:"action"`
	Amount int    `json:"amount"`
	Reason string `json:"reason"`
}

// AppliedAction is what the engine actually did: FOLD, CHECK, CALL, BET, RAISE or ALL_IN.
// Amount is chips put in for a call, and the total bet this street otherwise.
type AppliedAction struct {
	Type   string `json:"type"`
	Amount int    `json:"amount,omitempty"`
}

type HandResult struct {
	Pots     []PotRecord      `json:"pots"`
	Showdown []ShowdownRecord `json:"showdown"`
	Net      map[string]int   `json:"net"` // seat -> chips won or lost; sums to zero
}

type PotRecord struct {
	Amount        int   `json:"amount"`
	WinnerSeat    int   `json:"winner_seat"`
	EligibleSeats []int `json:"eligible_seats,omitempty"`
	PotNumber     int   `json:"pot_number,omitempty"` // 1 = main pot, 2+ = side pots
}

type ShowdownRecord struct {
	Seat      int      `json:"seat"`
	HoleCards []string `json:"hole_cards"`
}

// ReadHands parses one hand record per line, skipping blank lines. A line that does not
// parse (such as one cut short by a crash mid-append) is logged and skipped.
func ReadHands(r io.Reader) ([]HandRecord, error) {
	var out []HandRecord
	scanner := bufio.NewScanner(r)
	scanner.Buffer(nil, 64<<20)
	for line := 1; scanner.Scan(); line++ {
		if len(strings.TrimSpace(scanner.Text())) == 0 {
			continue
		}
		var h HandRecord
		if err := json.Unmarshal(scanner.Bytes(), &h); err != nil {
			log.Printf("!!! Skipping unreadable hand on line %d: %v", line, err)
			continue
		}
		out = append(out, h)
	}
	return out, scanner.Err()
}
