package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/rizzwareengineer/no-LLMit/engine/game"
	"github.com/rizzwareengineer/no-LLMit/engine/history"
)

// fakeSaver records saved hand IDs and fails the first fails attempts.
type fakeSaver struct {
	fails int
	tries int
	saved []string
}

func (f *fakeSaver) save(h savedHand) error {
	if f.tries++; f.tries <= f.fails {
		return errors.New("database unavailable")
	}
	f.saved = append(f.saved, h.Record.HandID+"|"+h.SystemPrompt)
	return nil
}

func (f *fakeSaver) describe() string { return "fake" }

// testTable is a table that publishes to its own hub and has a hand on.
func testTable(t *testing.T) *Table {
	gs := game.NewGame(game.GameConfig{PlayerNames: []string{"A", "B", "C"}, StartingStack: 1000, Stakes: game.Stakes{SmallBlind: 5, BigBlind: 10}})
	if err := gs.StartHand(); err != nil {
		t.Fatal(err)
	}
	return &Table{id: "tbl_test", hub: newHub(), floor: &floor{dailyCallCap: 1000}, cfg: tableConfig{5, 10, 100}, gs: gs, now: time.Now, pause: time.Sleep}
}

// noticeKinds lists the table_notice kinds in the hub's recent frames, in order.
func noticeKinds(h *hub) []string {
	var kinds []string
	for _, f := range h.since(0, false).frames {
		var m struct {
			Type    MessageType
			Payload TableNoticePayload
		}
		json.Unmarshal(f[len("data: "):], &m)
		if m.Type == MsgTableNotice {
			kinds = append(kinds, m.Payload.Kind)
		}
	}
	return kinds
}

// A failing save pauses the table behind the "saving" notice; the success that follows
// clears it, and the hand is counted once.
func TestFailingSavePausesUntilItSucceeds(t *testing.T) {
	tbl := testTable(t)
	saver := &fakeSaver{fails: 3}
	var notified []string
	tbl.saver, tbl.saveWait = saver, time.Millisecond
	tbl.onSaved = func(h history.HandRecord) { notified = append(notified, h.HandID) }

	tbl.saveWithRetry(savedHand{Record: history.HandRecord{HandID: "h1"}, SystemPrompt: "sys"})
	if saver.tries != 4 || strings.Join(saver.saved, ",") != "h1|sys" {
		t.Errorf("%d tries, saved %v", saver.tries, saver.saved)
	}
	if strings.Join(notified, ",") != "h1" {
		t.Errorf("onSaved saw %v", notified)
	}
	if got := strings.Join(noticeKinds(tbl.hub), ","); got != "saving," {
		t.Errorf("notices %q, want saving then cleared", got)
	}
	if tbl.notice.Kind != "" {
		t.Errorf("notice left as %q", tbl.notice.Kind)
	}

	// A save that works at once shows no notice.
	tbl.saveWithRetry(savedHand{Record: history.HandRecord{HandID: "h2"}})
	if got := strings.Join(noticeKinds(tbl.hub), ","); got != "saving," || len(notified) != 2 {
		t.Errorf("notices %q, onSaved %v", got, notified)
	}
}

// saveHand sends a real model hand to Supabase, but never a mock-provider hand or a hand
// with no decision.
func TestSaveHandKeepsMockHandsOutOfSupabase(t *testing.T) {
	posts := 0
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/rest/v1/rpc/save_hand" {
			posts++
		}
	}))
	defer srv.Close()
	for _, c := range []struct {
		provider string
		actions  int
		want     int
	}{{"mock", 1, 0}, {"openrouter", 0, 0}, {"openrouter", 1, 1}} {
		tbl := testTable(t)
		tbl.saver = &supabaseSaver{url: srv.URL, key: "k", http: srv.Client()}
		tbl.recorder = newHandRecorder(tbl.gs, tbl.id, "", nil)
		tbl.recorder.record.Config.Provider = c.provider
		for range c.actions {
			tbl.recorder.record.Actions = append(tbl.recorder.record.Actions, history.ActionRecord{Status: "ok"})
		}
		posts = 0
		if voided := tbl.saveHand(); voided || posts != c.want {
			t.Errorf("%s with %d actions: voided %v, %d saves, want %d", c.provider, c.actions, voided, posts, c.want)
		}
	}
}

// Every table saves through one fileSaver: saving at once, each line stays whole, a hand's
// prompts stay together, and every hand id is unique.
func TestFileSaverKeepsEachTablesHandsWhole(t *testing.T) {
	s := &fileSaver{dir: t.TempDir()}
	big := strings.Repeat("x", 100_000) // well past what one write is sure to keep whole
	var wg sync.WaitGroup
	for table := range 4 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for n := 1; n <= 20; n++ {
				id := fmt.Sprintf("tbl_%d-%06d", table, n)
				h := savedHand{Record: history.HandRecord{HandID: id, TableID: fmt.Sprintf("tbl_%d", table)}}
				for p := 1; p <= 3; p++ {
					h.Prompts = append(h.Prompts, HandPrompt{PromptID: fmt.Sprintf("%s-%02d", id, p), Prompt: big})
				}
				if err := s.save(h); err != nil {
					t.Error(err)
				}
			}
		}()
	}
	wg.Wait()
	hands, err := loadHandFile(filepath.Join(s.dir, "hands.jsonl"))
	if err != nil || len(hands) != 80 {
		t.Fatalf("%d hands read back: %v", len(hands), err)
	}
	ids := map[string]bool{}
	for _, h := range hands {
		ids[h.HandID] = true
	}
	if len(ids) != 80 {
		t.Errorf("%d distinct hand ids, want 80", len(ids))
	}
	raw, err := os.ReadFile(filepath.Join(s.dir, "prompts.jsonl"))
	if err != nil {
		t.Fatal(err)
	}
	lines := strings.Split(strings.TrimSuffix(string(raw), "\n"), "\n")
	if len(lines) != 240 {
		t.Fatalf("%d prompt lines, want 240", len(lines))
	}
	hand := ""
	for i, line := range lines {
		var p HandPrompt
		if err := json.Unmarshal([]byte(line), &p); err != nil || len(p.Prompt) != len(big) {
			t.Fatalf("prompt line %d is not whole: %v", i, err)
		}
		if i%3 == 0 {
			hand = strings.TrimSuffix(p.PromptID, "-01")
		}
		if want := fmt.Sprintf("%s-%02d", hand, i%3+1); p.PromptID != want {
			t.Fatalf("prompt line %d is %s, want %s: one hand's prompts were split by another's", i, p.PromptID, want)
		}
	}
}
