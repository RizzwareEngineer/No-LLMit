package api

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// fakeSaver records saved hand IDs and fails while down is set.
type fakeSaver struct {
	down  bool
	saved []string
}

func (f *fakeSaver) save(h savedHand) error {
	if f.down {
		return errors.New("database unavailable")
	}
	f.saved = append(f.saved, h.Record.HandID+"|"+h.SystemPrompt)
	return nil
}

func (f *fakeSaver) describe() string { return "fake" }

func hand(id string) savedHand {
	return savedHand{Record: HandRecord{HandID: id}, SystemPrompt: "sys-" + id}
}

func TestFailedSaveSpillsAndReplays(t *testing.T) {
	saver := &fakeSaver{down: true}
	s := &HandStore{saver: saver, spillPath: filepath.Join(t.TempDir(), "unsaved.jsonl"), retryWait: time.Millisecond}

	s.saveWithRetry(hand("h1"))
	s.saveWithRetry(hand("h2"))
	data, err := os.ReadFile(s.spillPath)
	if err != nil || strings.Count(string(data), "\n") != 2 {
		t.Fatalf("both hands should be spilled: %q %v", data, err)
	}

	// Still down at startup: nothing is lost.
	s.replaySpill()
	if data2, _ := os.ReadFile(s.spillPath); string(data2) != string(data) {
		t.Fatalf("spill file changed while the database was down: %q", data2)
	}

	// The next successful save replays the spill, in order, with its system prompt.
	saver.down = false
	s.saveWithRetry(hand("h3"))
	want := "h3|sys-h3,h1|sys-h1,h2|sys-h2"
	if got := strings.Join(saver.saved, ","); got != want {
		t.Errorf("saved %s, want %s", got, want)
	}
	if _, err := os.Stat(s.spillPath); !os.IsNotExist(err) {
		t.Errorf("spill file should be removed once replayed: %v", err)
	}
}

func TestReplayKeepsUnreadableLines(t *testing.T) {
	saver := &fakeSaver{}
	s := &HandStore{saver: saver, spillPath: filepath.Join(t.TempDir(), "unsaved.jsonl"), retryWait: time.Millisecond}
	s.spill(hand("h1"))
	f, _ := os.OpenFile(s.spillPath, os.O_APPEND|os.O_WRONLY, 0o644)
	f.WriteString("{not json\n")
	f.Close()
	s.spill(hand("h2"))

	s.replaySpill()
	if got := strings.Join(saver.saved, ","); got != "h1|sys-h1,h2|sys-h2" {
		t.Errorf("saved %s", got)
	}
	if data, _ := os.ReadFile(s.spillPath); string(data) != "{not json\n" {
		t.Errorf("only the unreadable line should be kept, got %q", data)
	}
}

func TestSupabaseKeepAlivePing(t *testing.T) {
	var gotPath, gotKey, gotAuth string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath, gotKey, gotAuth = r.URL.RequestURI(), r.Header.Get("apikey"), r.Header.Get("Authorization")
		w.Write([]byte("[]"))
	}))
	defer srv.Close()

	s := &supabaseSaver{url: srv.URL, key: "k", http: srv.Client()}
	if err := s.ping(); err != nil {
		t.Fatal(err)
	}
	if gotPath != "/rest/v1/hands?select=hand_id&limit=1" || gotKey != "k" || gotAuth != "Bearer k" {
		t.Errorf("path %q apikey %q auth %q", gotPath, gotKey, gotAuth)
	}
}
