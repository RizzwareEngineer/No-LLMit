package api

import (
	"encoding/json"
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
