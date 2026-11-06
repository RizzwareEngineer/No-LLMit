package client

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestGetSeated(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/models" || r.URL.Query().Get("session") != "3" {
			t.Errorf("unexpected request %s", r.URL)
		}
		w.Write([]byte(`{"provider":"mock","seated":["A","B"],"models":[]}`))
	}))
	defer srv.Close()
	old := llmServiceURL
	defer func() { llmServiceURL = old }()

	llmServiceURL = srv.URL
	if got, err := GetSeated(3); err != nil || len(got) != 2 || got[0] != "A" {
		t.Fatalf("GetSeated = %v, %v", got, err)
	}

	srv.Close() // the service is down
	if _, err := GetSeated(0); err == nil {
		t.Fatal("expected an error when the service is down")
	}
}
