// Saves finished hands. With SUPABASE_URL and SUPABASE_SERVICE_KEY set, hands go to the
// Supabase database; otherwise they are appended to local files for development. Saving
// runs in the background so a slow or unavailable database never holds up the table.
package api

import (
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
	SystemPrompt string       `json:"-"`
}

type handSaver interface {
	save(h savedHand) error
	describe() string
}

// HandStore queues hands and saves them one at a time, retrying on failure.
type HandStore struct {
	saver handSaver
	queue chan savedHand
	wg    sync.WaitGroup
}

func NewHandStore() *HandStore {
	var saver handSaver
	if url, key := os.Getenv("SUPABASE_URL"), os.Getenv("SUPABASE_SERVICE_KEY"); url != "" && key != "" {
		saver = &supabaseSaver{url: strings.TrimRight(url, "/"), key: key, http: &http.Client{Timeout: 15 * time.Second}}
	} else {
		dir := os.Getenv("HAND_LOG_DIR")
		if dir == "" {
			dir = "data"
		}
		saver = &fileSaver{dir: dir}
	}
	log.Printf("Saving hands to %s", saver.describe())

	s := &HandStore{saver: saver, queue: make(chan savedHand, 256)}
	s.wg.Add(1)
	go s.run()
	return s
}

// Save queues a hand. If the queue is full the hand is dropped and logged, so a long
// database outage cannot stall play or grow memory without bound.
func (s *HandStore) Save(h savedHand) {
	select {
	case s.queue <- h:
	default:
		log.Printf("!!! Hand %s not saved: save queue is full", h.Record.HandID)
	}
}

func (s *HandStore) run() {
	defer s.wg.Done()
	for h := range s.queue {
		var err error
		for attempt, wait := 1, 2*time.Second; attempt <= 5; attempt, wait = attempt+1, wait*2 {
			if err = s.saver.save(h); err == nil {
				break
			}
			log.Printf("Saving hand %s failed (attempt %d): %v", h.Record.HandID, attempt, err)
			time.Sleep(wait)
		}
		if err != nil {
			log.Printf("!!! Hand %s not saved after 5 attempts", h.Record.HandID)
		}
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
