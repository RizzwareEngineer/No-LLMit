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

func newSaver() handSaver {
	var saver handSaver
	if url, key := os.Getenv("SUPABASE_URL"), os.Getenv("SUPABASE_SERVICE_KEY"); url != "" && key != "" {
		sb := &supabaseSaver{url: strings.TrimRight(url, "/"), key: key, http: &http.Client{Timeout: 15 * time.Second}}
		go sb.keepAlive()
		saver = sb
	} else {
		dir := os.Getenv("HAND_LOG_DIR")
		if dir == "" {
			dir = "data"
		}
		saver = &fileSaver{dir: dir}
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

// keepAlive reads one row every 6 hours, so a free Supabase project is never paused for
// inactivity while the table is closed.
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
