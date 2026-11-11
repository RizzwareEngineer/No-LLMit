package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
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
	return &Table{id: "tbl_test", hub: newHub(), gs: gs}
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
