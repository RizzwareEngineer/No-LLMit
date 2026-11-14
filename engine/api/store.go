// Saves finished hands. With SUPABASE_URL and SUPABASE_SERVICE_KEY set, hands go to the
// Supabase database; otherwise they are appended to local files for development. The table
// waits for each save, retrying until it succeeds, so a hand is counted only once it is kept.
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
	"time"

	"github.com/rizzwareengineer/no-LLMit/engine/history"
)

type savedHand struct {
	Record       history.HandRecord
	Prompts      []HandPrompt
	SystemPrompt string
}

type handSaver interface {
	save(h savedHand) error
	describe() string
}

const (
	firstSaveWait = 2 * time.Second
	maxSaveWait   = 60 * time.Second
)

// supabaseEnv returns the Supabase base URL and service key, both "" unless both are set.
// The hand store, the stats and the waitlist all use it.
func supabaseEnv() (base, key string) {
	base, key = strings.TrimRight(os.Getenv("SUPABASE_URL"), "/"), os.Getenv("SUPABASE_SERVICE_KEY")
	if base == "" || key == "" {
		return "", ""
	}
	return base, key
}

// handDir is where hands are kept without Supabase: HAND_LOG_DIR, by default "data".
func handDir() string {
	if dir := os.Getenv("HAND_LOG_DIR"); dir != "" {
		return dir
	}
	return "data"
}

func setSupabaseAuth(req *http.Request, key string) {
	req.Header.Set("apikey", key)
	req.Header.Set("Authorization", "Bearer "+key)
}

func newSaver() handSaver {
	var saver handSaver = &fileSaver{dir: handDir()}
	if base, key := supabaseEnv(); base != "" {
		saver = &supabaseSaver{url: base, key: key, http: &http.Client{Timeout: 15 * time.Second}}
	}
	log.Printf("Saving hands to %s", saver.describe())
	return saver
}

// saveWithRetry saves a finished hand, retrying until it succeeds, and the table waits
// meanwhile. After the first failure viewers see the "saving" notice until it succeeds.
func (t *Table) saveWithRetry(h savedHand) {
	failed := false
	for wait := t.saveWait; ; wait = min(wait*2, maxSaveWait) {
		err := t.saver.save(h)
		if err == nil {
			break
		}
		log.Printf("!!! Saving hand %s failed, table paused, retrying in %s: %v", h.Record.HandID, wait, err)
		if !failed {
			failed = true
			t.mu.Lock()
			t.setNotice(TableNoticePayload{Kind: "saving", Message: "The table is paused until the last hand is saved."})
			t.mu.Unlock()
		}
		time.Sleep(wait)
	}
	if failed {
		log.Printf("Hand %s saved, table resumed", h.Record.HandID)
		t.mu.Lock()
		t.setNotice(TableNoticePayload{})
		t.mu.Unlock()
	}
	if t.onSaved != nil {
		t.onSaved(h.Record)
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
	setSupabaseAuth(req, s.key)

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
