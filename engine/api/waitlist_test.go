package api

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"time"
)

func waitlistCall(t *testing.T, h http.Handler, method, body string) (int, map[string]any) {
	t.Helper()
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, httptest.NewRequest(method, "/api/waitlist", strings.NewReader(body)))
	var out map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("%s: body is not JSON: %q", method, rec.Body.String())
	}
	return rec.Code, out
}

func TestWaitlistInMemory(t *testing.T) {
	h := waitlistHandler(&memoryWaitlist{emails: map[string]bool{}})
	if code, out := waitlistCall(t, h, "GET", ""); code != 200 || out["count"] != 0.0 {
		t.Errorf("GET empty: %d %v", code, out)
	}
	if code, out := waitlistCall(t, h, "POST", `{"email": " Ada@Example.com "}`); code != 201 || out["count"] != 1.0 || out["already"] != nil {
		t.Errorf("POST new: %d %v", code, out)
	}
	if code, out := waitlistCall(t, h, "POST", `{"email": "ada@example.COM"}`); code != 200 || out["count"] != 1.0 || out["already"] != true {
		t.Errorf("POST same address, other case: %d %v", code, out)
	}
	if code, out := waitlistCall(t, h, "GET", ""); code != 200 || out["count"] != 1.0 {
		t.Errorf("GET after: %d %v", code, out)
	}
	for _, m := range []string{"PUT", "DELETE", "PATCH"} {
		if code, _ := waitlistCall(t, h, m, ""); code != 405 {
			t.Errorf("%s: %d", m, code)
		}
	}
}

func TestWaitlistRejectsBadInput(t *testing.T) {
	h := waitlistHandler(&memoryWaitlist{emails: map[string]bool{}})
	bad := []string{"", "ada", "ada@", "@example.com", "ada@example", "ada@@example.com", "a@b@example.com",
		"ad a@example.com", "ada@exam ple.com", strings.Repeat("a", 243) + "@example.com"}
	for _, email := range bad {
		body, _ := json.Marshal(map[string]string{"email": email})
		if code, out := waitlistCall(t, h, "POST", string(body)); code != 400 || out["error"] != "invalid email" {
			t.Errorf("%q: %d %v", email, code, out)
		}
	}
	// 254 characters exactly is still accepted.
	if code, _ := waitlistCall(t, h, "POST", `{"email": "`+strings.Repeat("a", 242)+`@example.com"}`); code != 201 {
		t.Errorf("254-character address: %d", code)
	}
	bodies := map[string]string{
		"not json":  "nope",
		"no field":  `{}`,
		"oversized": `{"pad": "` + strings.Repeat("x", 2000) + `", "email": "ok@example.com"}`,
	}
	for name, body := range bodies {
		if code, _ := waitlistCall(t, h, "POST", body); code != 400 && code != 413 {
			t.Errorf("%s: %d", name, code)
		}
	}
	if code, out := waitlistCall(t, h, "GET", ""); code != 200 || out["count"] != 1.0 {
		t.Errorf("only the one valid address should be listed: %d %v", code, out)
	}
}

// fakePostgREST is the dataset_waitlist table as PostgREST serves it: 201 on an insert, 409
// on a duplicate, and the total in Content-Range on a count request.
type fakePostgREST struct {
	mu     sync.Mutex
	emails map[string]bool
	gets   int         // count requests served
	last   http.Header // headers of the last request
	down   bool
}

func (f *fakePostgREST) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.last = r.Header.Clone()
	switch {
	case f.down:
		w.WriteHeader(500)
	case r.URL.Path != "/rest/v1/dataset_waitlist" || r.Header.Get("apikey") != "k" || r.Header.Get("Authorization") != "Bearer k":
		w.WriteHeader(401)
	case r.Method == "POST":
		var row struct{ Email string }
		json.NewDecoder(r.Body).Decode(&row)
		if f.emails[strings.ToLower(row.Email)] {
			w.WriteHeader(409)
			w.Write([]byte(`{"code":"23505"}`))
			return
		}
		f.emails[strings.ToLower(row.Email)] = true
		w.WriteHeader(201)
	case r.Method == "GET" && r.URL.RawQuery == "select=id&limit=1" && r.Header.Get("Prefer") == "count=exact":
		f.gets++
		total := fmt.Sprintf("0-0/%d", len(f.emails))
		if len(f.emails) == 0 {
			total = "*/0"
		}
		w.Header().Set("Content-Range", total)
		w.Write([]byte("[]"))
	default:
		w.WriteHeader(400)
	}
}

func (f *fakePostgREST) state() (gets int, last http.Header) {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.gets, f.last
}

func TestWaitlistSupabase(t *testing.T) {
	fake := &fakePostgREST{emails: map[string]bool{}}
	srv := httptest.NewServer(fake)
	defer srv.Close()
	store := &supabaseWaitlist{url: srv.URL, key: "k", http: srv.Client()}
	h := waitlistHandler(store)

	if code, out := waitlistCall(t, h, "GET", ""); code != 200 || out["count"] != 0.0 {
		t.Errorf(`GET empty ("*/0"): %d %v`, code, out)
	}
	if code, out := waitlistCall(t, h, "POST", `{"email": "Ada@Example.com"}`); code != 201 || out["count"] != 1.0 {
		t.Errorf("POST new: %d %v", code, out)
	}
	if _, last := fake.state(); last.Get("Prefer") != "return=minimal" || last.Get("Content-Type") != "application/json" {
		t.Errorf("insert headers: %v", last)
	}
	if code, out := waitlistCall(t, h, "POST", `{"email": "ada@example.com"}`); code != 200 || out["count"] != 1.0 || out["already"] != true {
		t.Errorf("POST duplicate (409): %d %v", code, out)
	}
	if gets, _ := fake.state(); gets != 1 {
		t.Errorf("the table was counted %d times; the cached count should answer after the first", gets)
	}

	// Once the cache expires the count is fetched again and "0-0/1" parsed.
	store.cachedAt = time.Time{}
	if code, out := waitlistCall(t, h, "GET", ""); code != 200 || out["count"] != 1.0 {
		t.Errorf("GET after expiry: %d %v", code, out)
	}
	if gets, _ := fake.state(); gets != 2 {
		t.Errorf("expired cache: counted %d times, want 2", gets)
	}

	fake.mu.Lock()
	fake.down = true
	fake.mu.Unlock()
	store.cachedAt = time.Time{}
	if code, out := waitlistCall(t, h, "GET", ""); code != 503 || out["error"] != "unavailable" {
		t.Errorf("GET with the store down: %d %v", code, out)
	}
	if code, out := waitlistCall(t, h, "POST", `{"email": "bob@example.com"}`); code != 503 || out["error"] != "unavailable" {
		t.Errorf("POST with the store down: %d %v", code, out)
	}
}

func TestContentRangeTotal(t *testing.T) {
	for h, want := range map[string]int{"0-0/42": 42, "*/0": 0, "0-999/1000": 1000} {
		if got, err := contentRangeTotal(h); err != nil || got != want {
			t.Errorf("%q: %d %v, want %d", h, got, err, want)
		}
	}
	for _, h := range []string{"", "0-0/*", "0-0", "junk"} {
		if n, err := contentRangeTotal(h); err == nil {
			t.Errorf("%q: %d, want an error", h, n)
		}
	}
}
