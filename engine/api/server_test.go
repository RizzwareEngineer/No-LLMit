package api

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"
	"time"
)

// While one request waits on a slow usage fetch, the others get the last answer at once.
func TestUsageRequestsDoNotQueueBehindAFetch(t *testing.T) {
	defer func(old func() (json.RawMessage, error)) { getLLMUsage = old }(getLLMUsage)
	release := make(chan struct{})
	getLLMUsage = func() (json.RawMessage, error) {
		<-release
		return json.RawMessage(`"new"`), nil
	}
	s := &Server{usageLLM: json.RawMessage(`"old"`)}
	done := make(chan json.RawMessage)
	go func() { done <- s.llmUsage() }()
	waitFor(t, "the fetch to start", func() bool {
		s.usageMu.Lock()
		defer s.usageMu.Unlock()
		return !s.usageAt.IsZero()
	})

	got := make(chan json.RawMessage)
	go func() { got <- s.llmUsage() }()
	select {
	case b := <-got:
		if string(b) != `"old"` {
			t.Errorf("during the fetch: %s", b)
		}
	case <-time.After(time.Second):
		t.Fatal("a request waited on the fetch")
	}
	close(release)
	if b := <-done; string(b) != `"new"` {
		t.Errorf("the fetching request got %s", b)
	}
	if b := s.llmUsage(); string(b) != `"new"` {
		t.Errorf("after the fetch: %s", b)
	}
}

// /dev/pace exists only with DEV_CONTROLS=1; a POST sets the pace the next pause uses, and a bad value is a 400.
func TestDevPace(t *testing.T) {
	s := &Server{table: &Table{}}
	s.table.setPace(1)
	do := func(mux *http.ServeMux, method, target string) *httptest.ResponseRecorder {
		w := httptest.NewRecorder()
		mux.ServeHTTP(w, httptest.NewRequest(method, target, nil))
		return w
	}

	t.Setenv("DEV_CONTROLS", "")
	off := http.NewServeMux()
	s.devRoutes(off)
	if w := do(off, "POST", "/dev/pace?pace=0.5"); w.Code != http.StatusNotFound {
		t.Fatalf("without DEV_CONTROLS: %d", w.Code)
	}
	if s.table.Pace() != 1 {
		t.Fatalf("without DEV_CONTROLS the pace changed to %g", s.table.Pace())
	}

	t.Setenv("DEV_CONTROLS", "1")
	on := http.NewServeMux()
	s.devRoutes(on)
	for _, bad := range []string{"", "abc", "0", "0.05", "2.5", "NaN", "-1"} {
		if w := do(on, "POST", "/dev/pace?pace="+url.QueryEscape(bad)); w.Code != http.StatusBadRequest {
			t.Errorf("pace %q: %d", bad, w.Code)
		}
	}
	if w := do(on, "POST", "/dev/pace?pace=0.5"); w.Code != http.StatusOK || !strings.Contains(w.Body.String(), `"pace":0.5`) {
		t.Fatalf("POST 0.5: %d %s", w.Code, w.Body)
	}
	if got := s.table.paced(10 * time.Second); got != 5*time.Second {
		t.Errorf("the next 10s pause is %v, want 5s", got)
	}
	if w := do(on, "GET", "/dev/pace"); w.Code != http.StatusOK || strings.TrimSpace(w.Body.String()) != `{"pace":0.5}` {
		t.Errorf("GET: %d %s", w.Code, w.Body)
	}
	if w := do(on, "DELETE", "/dev/pace"); w.Code != http.StatusMethodNotAllowed {
		t.Errorf("DELETE: %d", w.Code)
	}
	// Another site's page cannot set it; the local site can.
	post := func(origin string) int {
		w, r := httptest.NewRecorder(), httptest.NewRequest("POST", "/dev/pace?pace=0.7", nil)
		r.Header.Set("Origin", origin)
		on.ServeHTTP(w, r)
		return w.Code
	}
	if c := post("https://evil.example"); c != http.StatusForbidden || s.table.Pace() != 0.5 {
		t.Errorf("POST from another site: %d, pace %g", c, s.table.Pace())
	}
	if c := post("http://localhost:3000"); c != http.StatusOK || s.table.Pace() != 0.7 {
		t.Errorf("POST from the local site: %d, pace %g", c, s.table.Pace())
	}
}
