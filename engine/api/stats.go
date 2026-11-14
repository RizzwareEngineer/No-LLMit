// Serves GET /api/stats and GET /api/stats/timeline (each optionally ?session=<id>). Hands
// are loaded from Supabase, or from HAND_LOG_DIR/hands.jsonl when Supabase is not
// configured, once on start; each hand this engine saves is added as it lands, and every 5
// minutes only hands newer than the newest one held are fetched from Supabase (another
// writer's: an overlapping deploy), never the whole table again. The JSON for the whole
// table and for each session, and its gzip, is precomputed, so a request only copies bytes.
// The all-time stats also go out on the stream (stream.go): the full body to each joiner,
// and the rows that changed after each recompute that added a hand.
package api

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
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
	statsPollEvery  = 5 * time.Minute  // also what keeps a free Supabase project from pausing for inactivity
	statsRetryEvery = 15 * time.Second // after a failed load, until one succeeds
	aievPerPass     = 8                // all-ins worked out per recompute at least (more with a long history), so serving never waits long
)

type statsCache struct {
	load      func() ([]history.HandRecord, error)
	loadSince func(since time.Time) ([]history.HandRecord, error) // nil: nothing to poll (the hand file has one writer)
	pollEvery time.Duration                                       // 0: statsPollEvery
	dirty     chan struct{}
	retryWait time.Duration

	mu        sync.Mutex
	hands     []history.HandRecord // in the order played
	seen      map[string]bool
	changed   map[string]bool // sessions with hands added since the last recompute
	added     bool            // a hand was added since the last recompute
	all       payload         // /api/stats
	bySession map[string]payload
	timeline  payload // /api/stats/timeline
	tlSession map[string]payload

	live    string            // the live session last encoded; only run touches it
	warming bool              // all-ins were left after the last recompute; only run touches it
	rows    map[string][]byte // each model's row as last published; only run touches it
	hub     *hub              // nil: publish nothing (tests)

	seated    []string  // the table's lineup; set before run starts, never changed after
	tableID   string    // the table this engine is playing: the live session, even before its first hand
	tableFrom time.Time // when that table started; the live session's start until it has a hand
}

// payload is a response body, and its gzip for clients that accept it.
type payload struct{ json, gz []byte }

func newPayload(v any) payload {
	b, err := json.Marshal(v)
	if err != nil {
		log.Printf("!!! Stats: %v", err)
		return payload{}
	}
	var z bytes.Buffer
	w := gzip.NewWriter(&z)
	w.Write(b)
	w.Close()
	return payload{b, z.Bytes()}
}

func newStatsCache() *statsCache {
	c := &statsCache{dirty: make(chan struct{}, 1), retryWait: statsRetryEvery, seen: map[string]bool{}, changed: map[string]bool{}}
	if base, key := supabaseEnv(); base != "" {
		c.load = func() ([]history.HandRecord, error) { return loadSupabaseHands(base, key, time.Time{}) }
		c.loadSince = func(since time.Time) ([]history.HandRecord, error) { return loadSupabaseHands(base, key, since) }
	} else {
		path := filepath.Join(handDir(), "hands.jsonl")
		c.load = func() ([]history.HandRecord, error) { return loadHandFile(path) }
	}
	return c // the caller sets seated, then starts run
}

// run loads every hand once, then adds the hands this engine saves and, every pollEvery,
// the hands newer than the newest one held, recomputing whenever one was added. Nothing is
// served until the first load succeeds; it is retried every retryWait. While all-ins are
// still being worked out it keeps going, a batch at a time, serving partial stats in between.
func (c *statsCache) run() {
	every := c.pollEvery
	if every <= 0 {
		every = statsPollEvery
	}
	tick := time.NewTicker(every)
	defer tick.Stop()
	loaded, try, poll := false, true, false // try: the first load, or its retry once retryWait passes
	for {
		full := false
		if !loaded && try {
			if hands, err := c.load(); err != nil {
				log.Printf("!!! Stats: loading hands failed: %v", err)
			} else {
				c.replace(hands)
				loaded, full = true, true
			}
		} else if loaded && poll && c.loadSince != nil {
			if hands, err := c.loadSince(c.newest()); err != nil {
				log.Printf("!!! Stats: loading new hands failed: %v", err)
			} else {
				for _, h := range hands {
					c.add(h) // the newest one held comes back too: add skips hands it has
				}
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
			try, poll = false, true
		case <-c.dirty:
			try, poll = false, false
		case <-again:
			try, poll = !loaded, false
		}
	}
}

// newest is when the latest hand held started (zero when none is).
func (c *statsCache) newest() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	if len(c.hands) == 0 {
		return time.Time{}
	}
	return c.hands[len(c.hands)-1].StartedAt
}

// Add records a hand that was just saved and schedules a recompute.
func (c *statsCache) Add(h history.HandRecord) {
	c.add(h)
	select {
	case c.dirty <- struct{}{}:
	default:
	}
}

// add inserts a hand in play order; another writer's hands can arrive late.
func (c *statsCache) add(h history.HandRecord) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.seen[h.HandID] {
		return
	}
	c.seen[h.HandID] = true
	c.added = true
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
	c.hands, c.seen, c.added = nil, map[string]bool{}, true
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

// trimHand drops what stats never read (the deck, each decision's reply and labels, and every
// legal action but CHECK, which stats only asks about) to keep memory down.
func trimHand(h history.HandRecord) history.HandRecord {
	h.Deck = nil
	h.Actions = append([]history.ActionRecord(nil), h.Actions...) // the caller may still hold the original
	for i, a := range h.Actions {
		a.Parsed, a.PromptID, a.Player, a.Model, a.UpstreamProvider, a.PromptVersion = history.ParsedAction{}, "", "", "", "", ""
		legal := a.LegalActions
		a.LegalActions = nil
		for _, l := range legal {
			if l.Type == "CHECK" {
				a.LegalActions = checkLegal
			}
		}
		h.Actions[i] = a
	}
	return h
}

var checkLegal = []game.LLMValidAction{{Type: "CHECK"}} // shared by every trimmed hand; never changed

// recompute works out the next batch of all-ins, then re-encodes the all-time stats and
// every session that changed (all of them when full). It returns true while all-ins are
// left to work out.
func (c *statsCache) recompute(full bool) (more bool) {
	c.mu.Lock()
	hands := append([]history.HandRecord(nil), c.hands...) // add may shift c.hands while we work
	changed, added := c.changed, c.added
	c.changed, c.added = map[string]bool{}, false
	c.mu.Unlock()

	// One all-in per 1,000 hands held, so a warm-up after a restart takes about 100 passes.
	warmed, remaining := stats.WarmAIEV(hands, max(aievPerPass, len(hands)/1000))
	for _, i := range warmed {
		changed[stats.SessionID(hands[i])] = true
	}
	// The live session is the table being played, never the last one in the log: right after a
	// restart that is the previous run's table.
	live := c.tableID
	if live != c.live { // the old live session has ended
		changed[live], changed[c.live] = true, true
		c.live = live
	}

	now := time.Now().UTC()
	encode := func(hs []history.HandRecord, current bool) (stats.Stats, [2]payload) {
		s, tl := stats.ComputeWithTimeline(hs)
		s.GeneratedAt, tl.GeneratedAt = now, now
		if current {
			s.Seated = c.seated
		}
		found := false
		for i := range s.Sessions {
			if s.Sessions[i].ID == live {
				s.Sessions[i].EndedAt, found = nil, true
			}
		}
		if current && live != "" && !found { // no hand saved yet this run
			s.Sessions = append(s.Sessions, stats.Session{ID: live, StartedAt: c.tableFrom})
		}
		return s, [2]payload{newPayload(s), newPayload(tl)}
	}
	sessions := map[string][]history.HandRecord{}
	for _, h := range hands {
		if id := stats.SessionID(h); full || changed[id] {
			sessions[id] = append(sessions[id], h)
		}
	}
	if _, ok := sessions[live]; live != "" && !ok && (full || changed[live]) {
		sessions[live] = nil // answer ?session=<live> with zero hands until the first one is saved
	}
	updated := map[string][2]payload{}
	for id, hs := range sessions {
		_, updated[id] = encode(hs, id == live)
	}
	allStats, all := encode(hands, true)

	c.mu.Lock()
	if full || c.bySession == nil {
		c.bySession, c.tlSession = map[string]payload{}, map[string]payload{}
	}
	for id, b := range updated {
		c.bySession[id], c.tlSession[id] = b[0], b[1]
	}
	c.all, c.timeline = all[0], all[1]
	c.mu.Unlock()

	warmedUp := c.warming && remaining == 0
	c.warming = remaining > 0
	if c.hub != nil && all[0].json != nil && (added || warmedUp) {
		first := c.rows == nil
		var ev any = c.changedRows(allStats)
		if first {
			ev = json.RawMessage(all[0].json) // a stream that opened before any stats holds no rows to change
		}
		c.hub.publish("", nil, all[0].json, ServerMessage{Type: MsgStats, Payload: ev})
	}
	return remaining > 0
}

// statsChange is the stream's stats event: the all-time envelope, every model name in
// order, and the rows that differ from the ones last published.
type statsChange struct {
	GeneratedAt    time.Time         `json:"generated_at"`
	Scope          stats.Scope       `json:"scope"`
	Sessions       []stats.Session   `json:"sessions"`
	Seated         []string          `json:"seated,omitempty"`
	DefinitionsURL string            `json:"definitions_url"`
	Partial        bool              `json:"partial"`
	ModelNames     []string          `json:"model_names"`
	Changed        []json.RawMessage `json:"changed"`
}

// changedRows builds the stats event for s and remembers its rows as published. Only run calls it.
func (c *statsCache) changedRows(s stats.Stats) statsChange {
	ev := statsChange{
		GeneratedAt: s.GeneratedAt, Scope: s.Scope, Sessions: s.Sessions, Seated: s.Seated,
		DefinitionsURL: s.DefinitionsURL, Partial: s.Partial,
		ModelNames: []string{}, Changed: []json.RawMessage{},
	}
	rows := make(map[string][]byte, len(s.Models))
	for _, m := range s.Models {
		b, err := json.Marshal(m)
		if err != nil {
			log.Printf("!!! Stats: %v", err)
			continue
		}
		rows[m.Name] = b
		ev.ModelNames = append(ev.ModelNames, m.Name)
		if !bytes.Equal(c.rows[m.Name], b) {
			ev.Changed = append(ev.Changed, b)
		}
	}
	c.rows = rows
	return ev
}

func (c *statsCache) handle(w http.ResponseWriter, r *http.Request) { c.serve(w, r, false) }

func (c *statsCache) handleTimeline(w http.ResponseWriter, r *http.Request) { c.serve(w, r, true) }

func (c *statsCache) serve(w http.ResponseWriter, r *http.Request, timeline bool) {
	c.mu.Lock()
	body, bySession := c.all, c.bySession
	if timeline {
		body, bySession = c.timeline, c.tlSession
	}
	if id := r.URL.Query().Get("session"); id != "" {
		var ok bool
		if body, ok = bySession[id]; !ok {
			c.mu.Unlock()
			http.Error(w, "unknown session", http.StatusNotFound)
			return
		}
	}
	c.mu.Unlock()
	if body.json == nil {
		http.Error(w, "stats are still loading", http.StatusServiceUnavailable)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Vary", "Accept-Encoding")
	// shortcut: any "gzip" in Accept-Encoding counts, even gzip;q=0, which no browser sends.
	if strings.Contains(r.Header.Get("Accept-Encoding"), "gzip") {
		w.Header().Set("Content-Encoding", "gzip")
		w.Write(body.gz)
		return
	}
	w.Write(body.json)
}

// loadSupabaseHands reads the saved hands that started at or after since (every hand when
// since is zero) in the order played, asking for 1000 rows at a time with a Range header.
// It moves on by the rows actually returned and stops at an empty page, so a server row
// cap below 1000 cannot cut the history short.
func loadSupabaseHands(base, key string, since time.Time) ([]history.HandRecord, error) {
	query := "/rest/v1/hands?select=doc&order=started_at,hand_id"
	if !since.IsZero() {
		query += "&started_at=gte." + url.QueryEscape(since.UTC().Format(time.RFC3339Nano))
	}
	client := &http.Client{Timeout: 60 * time.Second}
	const page = 1000
	var out []history.HandRecord
	for offset := 0; ; {
		req, err := http.NewRequest("GET", base+query, nil)
		if err != nil {
			return nil, err
		}
		setSupabaseAuth(req, key)
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
