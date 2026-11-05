// Saves finished hands. With SUPABASE_URL and SUPABASE_SERVICE_KEY set, hands go to the
// Supabase database; otherwise they are appended to local files for development. Saving
// runs in the background so a slow or unavailable database never holds up the table. A
// hand that cannot be saved is spilled to data/unsaved.jsonl and saved again later.
package api

import (
	"bufio"
	"bytes"
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
)

type savedHand struct {
	Record       HandRecord   `json:"hand"`
	Prompts      []HandPrompt `json:"prompts"`
	SystemPrompt string       `json:"system_prompt,omitempty"` // only written to the spill file
}

type handSaver interface {
	save(h savedHand) error
	describe() string
}

// HandStore queues hands and saves them one at a time, retrying on failure. A hand that
// still fails is appended to the spill file, which is replayed at startup and after every
// successful save.
type HandStore struct {
	saver     handSaver
	queue     chan savedHand
	spillPath string
	spillMu   sync.Mutex
	retryWait time.Duration // first wait between attempts; doubles each time
}

func NewHandStore() *HandStore {
	dir := os.Getenv("HAND_LOG_DIR")
	if dir == "" {
		dir = "data"
	}
	var saver handSaver
	if url, key := os.Getenv("SUPABASE_URL"), os.Getenv("SUPABASE_SERVICE_KEY"); url != "" && key != "" {
		sb := &supabaseSaver{url: strings.TrimRight(url, "/"), key: key, http: &http.Client{Timeout: 15 * time.Second}}
		go sb.keepAlive()
		saver = sb
	} else {
		saver = &fileSaver{dir: dir}
	}
	log.Printf("Saving hands to %s", saver.describe())

	s := &HandStore{
		saver:     saver,
		queue:     make(chan savedHand, 256),
		spillPath: filepath.Join(dir, "unsaved.jsonl"),
		retryWait: 2 * time.Second,
	}
	go s.run()
	return s
}

// Save queues a hand. If the queue is full the hand is spilled to disk instead, so a long
// database outage cannot stall play or grow memory without bound.
func (s *HandStore) Save(h savedHand) {
	select {
	case s.queue <- h:
	default:
		log.Printf("!!! Save queue is full")
		s.spill(h)
	}
}

func (s *HandStore) run() {
	s.replaySpill()
	for h := range s.queue {
		s.saveWithRetry(h)
	}
}

// saveWithRetry tries a hand up to 5 times. On success it also replays any spilled hands;
// on failure it spills this one.
func (s *HandStore) saveWithRetry(h savedHand) {
	var err error
	for attempt, wait := 1, s.retryWait; attempt <= 5; attempt, wait = attempt+1, wait*2 {
		if err = s.saver.save(h); err == nil {
			s.replaySpill()
			return
		}
		log.Printf("Saving hand %s failed (attempt %d): %v", h.Record.HandID, attempt, err)
		time.Sleep(wait)
	}
	log.Printf("!!! Hand %s not saved after 5 attempts", h.Record.HandID)
	s.spill(h)
}

// spill appends a hand to the spill file. Losing it here is the only way a hand is lost.
func (s *HandStore) spill(h savedHand) {
	s.spillMu.Lock()
	defer s.spillMu.Unlock()
	if err := os.MkdirAll(filepath.Dir(s.spillPath), 0o755); err != nil {
		log.Printf("!!! Hand %s lost: %v", h.Record.HandID, err)
		return
	}
	if err := appendJSONLine(s.spillPath, h); err != nil {
		log.Printf("!!! Hand %s lost: %v", h.Record.HandID, err)
		return
	}
	log.Printf("Hand %s spilled to %s", h.Record.HandID, s.spillPath)
}

// replaySpill saves the spilled hands in order. It stops at the first failure and keeps
// that hand and every later one in the file; lines it cannot read are kept as they are.
func (s *HandStore) replaySpill() {
	s.spillMu.Lock()
	defer s.spillMu.Unlock()
	data, err := os.ReadFile(s.spillPath)
	if err != nil || len(data) == 0 {
		return
	}

	var keep [][]byte
	saved, failed := 0, false
	scanner := bufio.NewScanner(bytes.NewReader(data))
	scanner.Buffer(nil, len(data)+1)
	for scanner.Scan() {
		line := append([]byte(nil), scanner.Bytes()...)
		if len(bytes.TrimSpace(line)) == 0 {
			continue
		}
		var h savedHand
		if failed {
			keep = append(keep, line)
		} else if err := json.Unmarshal(line, &h); err != nil {
			log.Printf("!!! Unreadable line in %s kept: %v", s.spillPath, err)
			keep = append(keep, line)
		} else if err := s.saver.save(h); err != nil {
			log.Printf("Replaying spilled hand %s failed: %v", h.Record.HandID, err)
			keep = append(keep, line)
			failed = true
		} else {
			saved++
		}
	}
	if saved == 0 {
		return
	}
	log.Printf("Saved %d spilled hand(s), %d left in %s", saved, len(keep), s.spillPath)

	if len(keep) == 0 {
		if err := os.Remove(s.spillPath); err != nil {
			log.Printf("Could not remove %s: %v", s.spillPath, err)
		}
		return
	}
	// Write the rest to a temporary file and rename it, so a crash never leaves a half-written spill file.
	tmp := s.spillPath + ".tmp"
	if err := os.WriteFile(tmp, append(bytes.Join(keep, []byte("\n")), '\n'), 0o644); err != nil {
		log.Printf("Could not rewrite %s: %v", s.spillPath, err)
		return
	}
	if err := os.Rename(tmp, s.spillPath); err != nil {
		log.Printf("Could not rewrite %s: %v", s.spillPath, err)
	}
}

// supabaseSaver calls the save_hand database function, which writes the hand and its
// prompts in one transaction and ignores a hand it already has.
type supabaseSaver struct {
	url  string
	key  string
	http *http.Client
}

func (s *supabaseSaver) describe() string { return "Supabase (" + s.url + ")" }

// keepAlive reads one row every 6 hours, so a free Supabase project is never paused for
// inactivity while the table is closed or idle.
func (s *supabaseSaver) keepAlive() {
	for {
		if err := s.ping(); err != nil {
			log.Printf("!!! Supabase keep-alive failed: %v", err)
		} else {
			log.Printf("Supabase keep-alive ok")
		}
		time.Sleep(6 * time.Hour)
	}
}

func (s *supabaseSaver) ping() error {
	req, err := http.NewRequest("GET", s.url+"/rest/v1/hands?select=hand_id&limit=1", nil)
	if err != nil {
		return err
	}
	req.Header.Set("apikey", s.key)
	req.Header.Set("Authorization", "Bearer "+s.key)
	resp, err := s.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		msg, _ := io.ReadAll(io.LimitReader(resp.Body, 500))
		return fmt.Errorf("status %d: %s", resp.StatusCode, msg)
	}
	return nil
}

func (s *supabaseSaver) save(h savedHand) error {
	body, err := json.Marshal(map[string]any{
		"p_hand":          h.Record,
		"p_prompts":       h.Prompts,
		"p_system_prompt": h.SystemPrompt,
	})
	if err != nil {
		return err
	}

	req, err := http.NewRequest("POST", s.url+"/rest/v1/rpc/save_hand", bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("apikey", s.key)
	req.Header.Set("Authorization", "Bearer "+s.key)

	resp, err := s.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		msg, _ := io.ReadAll(io.LimitReader(resp.Body, 500))
		return fmt.Errorf("status %d: %s", resp.StatusCode, msg)
	}
	return nil
}

// fileSaver appends one JSON line per hand to hands.jsonl and one per decision to
// prompts.jsonl.
type fileSaver struct {
	dir string
}

func (s *fileSaver) describe() string { return "local files in " + s.dir + "/" }

func (s *fileSaver) save(h savedHand) error {
	if err := os.MkdirAll(s.dir, 0o755); err != nil {
		return err
	}
	if err := appendJSONLine(filepath.Join(s.dir, "hands.jsonl"), h.Record); err != nil {
		return err
	}
	for _, p := range h.Prompts {
		if err := appendJSONLine(filepath.Join(s.dir, "prompts.jsonl"), p); err != nil {
			return err
		}
	}
	return nil
}

func appendJSONLine(path string, v any) error {
	line, err := json.Marshal(v)
	if err != nil {
		return err
	}
	f, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = f.Write(append(line, '\n'))
	return err
}
