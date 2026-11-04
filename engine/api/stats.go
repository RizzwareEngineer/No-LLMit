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
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/rizzwareengineer/no-LLMit/engine/game"
	"github.com/rizzwareengineer/no-LLMit/engine/history"
	"github.com/rizzwareengineer/no-LLMit/engine/stats"
)

const (
	statsReloadEvery = 5 * time.Minute
	statsRetryEvery  = 15 * time.Second // after a failed load, until one succeeds
	aievPerPass      = 8                // all-ins worked out per recompute, so serving never waits long
)

type statsCache struct {
	load      func() ([]history.HandRecord, error)
	dirty     chan struct{}
	retryWait time.Duration

	mu        sync.Mutex
	hands     []history.HandRecord // in the order played
	seen      map[string]bool
	changed   map[string]bool // sessions with hands added since the last recompute
	all       []byte
	bySession map[string][]byte

	live string // the session of the latest hand; only run touches it
}

func newStatsCache() *statsCache {
	c := &statsCache{dirty: make(chan struct{}, 1), retryWait: statsRetryEvery, seen: map[string]bool{}, changed: map[string]bool{}}
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

// run loads every hand on start and every statsReloadEvery, and recomputes whenever a
// saved hand was added. Nothing is served until a load succeeds; a failed first load is
// retried every retryWait. While all-ins are still being worked out it keeps going, a
// batch at a time, serving partial stats in between.
func (c *statsCache) run() {
	tick := time.NewTicker(statsReloadEvery)
	defer tick.Stop()
	loaded := false
	for reload := true; ; {
		full := false
		if reload {
			if hands, err := c.load(); err != nil {
				log.Printf("!!! Stats: loading hands failed: %v", err)
			} else {
				c.replace(hands)
				loaded, full = true, true
			}
		}
		var again <-chan time.Time
		if !loaded {
			again = time.After(c.retryWait)
		} else if more := c.recompute(full); more {
			again = time.After(0)
		}
		select {
		case <-tick.C:
			reload = true
		case <-c.dirty:
			reload = false
		case <-again:
			reload = !loaded
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

// add inserts a hand in play order; hands replayed from the spill file can arrive late.
func (c *statsCache) add(h history.HandRecord) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.seen[h.HandID] {
		return
	}
	c.seen[h.HandID] = true
	c.changed[stats.SessionID(h)] = true
	i := sort.Search(len(c.hands), func(i int) bool { return c.hands[i].StartedAt.After(h.StartedAt) })
	c.hands = append(c.hands, history.HandRecord{})
	copy(c.hands[i+1:], c.hands[i:])
	c.hands[i] = trimHand(h)
}

// replace swaps in a fresh load, keeping any hand added since the load started.
func (c *statsCache) replace(loaded []history.HandRecord) {
	c.mu.Lock()
	defer c.mu.Unlock()
	old := c.hands
	c.hands, c.seen = nil, map[string]bool{}
	for _, src := range [][]history.HandRecord{loaded, old} {
		for _, h := range src {
			if !c.seen[h.HandID] {
				c.seen[h.HandID] = true
				c.hands = append(c.hands, trimHand(h))
			}
		}
	}
	sort.SliceStable(c.hands, func(i, j int) bool { return c.hands[i].StartedAt.Before(c.hands[j].StartedAt) })
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

// recompute works out the next batch of all-ins, then re-encodes the all-time stats and
// every session that changed (all of them when full). It returns true while all-ins are
// left to work out.
func (c *statsCache) recompute(full bool) (more bool) {
	c.mu.Lock()
	hands := append([]history.HandRecord(nil), c.hands...) // add may shift c.hands while we work
	changed := c.changed
	c.changed = map[string]bool{}
	c.mu.Unlock()

	warmed, remaining := stats.WarmAIEV(hands, aievPerPass)
	for _, i := range warmed {
		changed[stats.SessionID(hands[i])] = true
	}
	live := ""
	if len(hands) > 0 {
		live = stats.SessionID(hands[len(hands)-1])
	}
	if live != c.live { // the old live session has ended
		changed[live], changed[c.live] = true, true
		c.live = live
	}

	now := time.Now().UTC()
	encode := func(hs []history.HandRecord) []byte {
		s := stats.Compute(hs)
		s.GeneratedAt = now
		for i := range s.Sessions {
			if s.Sessions[i].ID == live {
				s.Sessions[i].EndedAt = nil
			}
		}
		b, err := json.Marshal(s)
		if err != nil {
			log.Printf("!!! Stats: %v", err)
		}
		return b
	}
	sessions := map[string][]history.HandRecord{}
	for _, h := range hands {
		if id := stats.SessionID(h); full || changed[id] {
			sessions[id] = append(sessions[id], h)
		}
	}
	updated := map[string][]byte{}
	for id, hs := range sessions {
		updated[id] = encode(hs)
	}
	all := encode(hands)

	c.mu.Lock()
	if full || c.bySession == nil {
		c.bySession = map[string][]byte{}
	}
	for id, b := range updated {
		c.bySession[id] = b
	}
	c.all = all
	c.mu.Unlock()
	return remaining > 0
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

// loadSupabaseHands reads every saved hand in the order played, asking for 1000 rows at a
// time with a Range header. It moves on by the rows actually returned and stops at an
// empty page, so a server row cap below 1000 cannot cut the history short.
func loadSupabaseHands(url, key string) ([]history.HandRecord, error) {
	client := &http.Client{Timeout: 60 * time.Second}
	const page = 1000
	var out []history.HandRecord
	for offset := 0; ; {
		req, err := http.NewRequest("GET", url+"/rest/v1/hands?select=doc&order=started_at,hand_id", nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("apikey", key)
		req.Header.Set("Authorization", "Bearer "+key)
		req.Header.Set("Range-Unit", "items")
		req.Header.Set("Range", fmt.Sprintf("%d-%d", offset, offset+page-1))
		resp, err := client.Do(req)
		if err != nil {
			return nil, err
		}
		var rows []struct {
			Doc history.HandRecord `json:"doc"`
		}
		if resp.StatusCode == http.StatusRequestedRangeNotSatisfiable {
			resp.Body.Close()
			return out, nil // past the last row
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
		if len(rows) == 0 {
			return out, nil
		}
		for _, r := range rows {
			out = append(out, r.Doc)
		}
		offset += len(rows)
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
