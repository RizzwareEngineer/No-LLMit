// Serves GET /api/stats (optionally ?session=<id>). Hands are loaded from Supabase, or from
// HAND_LOG_DIR/hands.jsonl when Supabase is not configured; every 5 minutes they are
// reloaded, and each newly saved hand is added as it lands. The JSON for the whole table
// and for each session is precomputed, so a request only copies bytes.
package api

import (
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/rizzwareengineer/no-LLMit/engine/game"
	"github.com/rizzwareengineer/no-LLMit/engine/history"
	"github.com/rizzwareengineer/no-LLMit/engine/stats"
)

const statsReloadEvery = 5 * time.Minute

type statsCache struct {
	load  func() ([]history.HandRecord, error)
	dirty chan struct{}

	mu        sync.Mutex
	hands     []history.HandRecord
	seen      map[string]bool
	all       []byte
	bySession map[string][]byte
}

func newStatsCache() *statsCache {
	c := &statsCache{dirty: make(chan struct{}, 1), seen: map[string]bool{}}
	if url, key := os.Getenv("SUPABASE_URL"), os.Getenv("SUPABASE_SERVICE_KEY"); url != "" && key != "" {
		c.load = func() ([]history.HandRecord, error) { return loadSupabaseHands(strings.TrimRight(url, "/"), key) }
	} else {
		dir := os.Getenv("HAND_LOG_DIR")
		if dir == "" {
			dir = "data"
		}
		c.load = func() ([]history.HandRecord, error) { return loadHandFile(filepath.Join(dir, "hands.jsonl")) }
	}
	go c.run()
	return c
}

// run reloads every hand on start and every statsReloadEvery, and recomputes whenever a
// saved hand was added in between.
func (c *statsCache) run() {
	tick := time.NewTicker(statsReloadEvery)
	defer tick.Stop()
	for reload := true; ; {
		if reload {
			if hands, err := c.load(); err != nil {
				log.Printf("!!! Stats: loading hands failed: %v", err)
			} else {
				c.replace(hands)
			}
		}
		c.recompute()
		select {
		case <-tick.C:
			reload = true
		case <-c.dirty:
			reload = false
		}
	}
}

// Add records a hand that was just saved and schedules a recompute.
func (c *statsCache) Add(h history.HandRecord) {
	c.add(h)
	select {
	case c.dirty <- struct{}{}:
	default:
	}
}

func (c *statsCache) add(h history.HandRecord) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if !c.seen[h.HandID] {
		c.seen[h.HandID] = true
		c.hands = append(c.hands, trimHand(h))
	}
}

// replace swaps in a fresh load, keeping any hand added since the load started.
func (c *statsCache) replace(loaded []history.HandRecord) {
	c.mu.Lock()
	defer c.mu.Unlock()
	old := c.hands
	c.hands, c.seen = nil, map[string]bool{}
	for _, h := range append(loaded, old...) {
		if !c.seen[h.HandID] {
			c.seen[h.HandID] = true
			c.hands = append(c.hands, trimHand(h))
		}
	}
}

// trimHand drops what stats never read (the deck and the legal action descriptions) to keep memory down.
func trimHand(h history.HandRecord) history.HandRecord {
	h.Deck = nil
	h.Actions = append([]history.ActionRecord(nil), h.Actions...) // the caller may still hold the original
	for i, a := range h.Actions {
		h.Actions[i].LegalActions = append([]game.LLMValidAction(nil), a.LegalActions...)
		for j := range h.Actions[i].LegalActions {
			h.Actions[i].LegalActions[j].Description = ""
		}
	}
	return h
}

func (c *statsCache) recompute() {
	c.mu.Lock()
	hands := c.hands
	c.mu.Unlock()

	now := time.Now().UTC()
	encode := func(hs []history.HandRecord) []byte {
		s := stats.Compute(hs)
		s.GeneratedAt = now
		b, err := json.Marshal(s)
		if err != nil {
			log.Printf("!!! Stats: %v", err)
		}
		return b
	}
	sessions := map[string][]history.HandRecord{}
	for _, h := range hands {
		id := stats.SessionID(h)
		sessions[id] = append(sessions[id], h)
	}
	bySession := map[string][]byte{}
	for id, hs := range sessions {
		bySession[id] = encode(hs)
	}
	all := encode(hands)

	c.mu.Lock()
	c.all, c.bySession = all, bySession
	c.mu.Unlock()
}

func (c *statsCache) handle(w http.ResponseWriter, r *http.Request) {
	c.mu.Lock()
	body := c.all
	if id := r.URL.Query().Get("session"); id != "" {
		var ok bool
		if body, ok = c.bySession[id]; !ok {
			c.mu.Unlock()
			http.Error(w, "unknown session", http.StatusNotFound)
			return
		}
	}
	c.mu.Unlock()
	if body == nil {
		http.Error(w, "stats are still loading", http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Write(body)
}

// loadSupabaseHands reads every saved hand in the order played, 1000 rows a page.
func loadSupabaseHands(url, key string) ([]history.HandRecord, error) {
	client := &http.Client{Timeout: 60 * time.Second}
	const page = 1000
	var out []history.HandRecord
	for offset := 0; ; offset += page {
		req, err := http.NewRequest("GET", fmt.Sprintf("%s/rest/v1/hands?select=doc&order=started_at,hand_id&limit=%d&offset=%d", url, page, offset), nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("apikey", key)
		req.Header.Set("Authorization", "Bearer "+key)
		resp, err := client.Do(req)
		if err != nil {
			return nil, err
		}
		var rows []struct {
			Doc history.HandRecord `json:"doc"`
		}
		if resp.StatusCode >= 300 {
			msg, _ := io.ReadAll(io.LimitReader(resp.Body, 500))
			resp.Body.Close()
			return nil, fmt.Errorf("status %d: %s", resp.StatusCode, msg)
		}
		err = json.NewDecoder(resp.Body).Decode(&rows)
		resp.Body.Close()
		if err != nil {
			return nil, err
		}
		for _, r := range rows {
			out = append(out, r.Doc)
		}
		if len(rows) < page {
			return out, nil
		}
	}
}

// loadHandFile reads hands.jsonl as written by fileSaver. A missing file is no hands.
func loadHandFile(path string) ([]history.HandRecord, error) {
	f, err := os.Open(path)
	if os.IsNotExist(err) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return history.ReadHands(f)
}
