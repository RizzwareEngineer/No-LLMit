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
	mu        sync.Mutex
	emails    map[string]bool
	gets      int         // count requests received, served or not
	last      http.Header // headers of the last insert
	down      bool        // every request fails
	countDown bool        // only the count fails
}

func (f *fakePostgREST) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	counting := r.Method == "GET"
	if counting {
		f.gets++
	}
	switch {
	case f.down || counting && f.countDown:
		w.WriteHeader(500)
	case r.URL.Path != "/rest/v1/dataset_waitlist" || r.Header.Get("apikey") != "k" || r.Header.Get("Authorization") != "Bearer k":
		w.WriteHeader(401)
	case r.Method == "POST":
		f.last = r.Header.Clone()
		var row struct{ Email string }
		json.NewDecoder(r.Body).Decode(&row)
		if f.emails[strings.ToLower(row.Email)] {
			w.WriteHeader(409)
			w.Write([]byte(`{"code":"23505"}`))
			return
		}
		f.emails[strings.ToLower(row.Email)] = true
		w.WriteHeader(201)
	case counting && r.URL.RawQuery == "select=id&limit=1" && r.Header.Get("Prefer") == "count=exact":
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
	// One count for the GET, one after the insert; the duplicate is answered from the cache.
	if gets, _ := fake.state(); gets != 2 {
		t.Errorf("the table was counted %d times, want 2", gets)
	}

	// Once the cache expires the count is fetched again and "0-0/1" parsed.
	store.cachedAt = time.Time{}
	if code, out := waitlistCall(t, h, "GET", ""); code != 200 || out["count"] != 1.0 {
		t.Errorf("GET after expiry: %d %v", code, out)
	}
	if gets, _ := fake.state(); gets != 3 {
		t.Errorf("expired cache: counted %d times, want 3", gets)
	}

	// With the store down the last total is served, and the store is not asked again for the TTL.
	fake.mu.Lock()
	fake.down = true
	fake.mu.Unlock()
	store.cachedAt = time.Time{}
	for range 3 {
		if code, out := waitlistCall(t, h, "GET", ""); code != 200 || out["count"] != 1.0 {
			t.Errorf("GET with the store down: %d %v", code, out)
		}
	}
	if gets, _ := fake.state(); gets != 4 {
		t.Errorf("store down: counted %d times, want 4 (one failed attempt per TTL)", gets)
	}
	if code, out := waitlistCall(t, h, "POST", `{"email": "bob@example.com"}`); code != 503 || out["error"] != "unavailable" {
		t.Errorf("POST with the store down: %d %v", code, out)
	}
}

// A store that has never answered has no total to serve: 503, asked once per TTL.
func TestWaitlistSupabaseDownFromTheStart(t *testing.T) {
	fake := &fakePostgREST{emails: map[string]bool{}, down: true}
	srv := httptest.NewServer(fake)
	defer srv.Close()
	h := waitlistHandler(&supabaseWaitlist{url: srv.URL, key: "k", http: srv.Client()})
	for range 3 {
		if code, out := waitlistCall(t, h, "GET", ""); code != 503 || out["error"] != "unavailable" {
			t.Errorf("GET: %d %v", code, out)
		}
	}
	if gets, _ := fake.state(); gets != 1 {
		t.Errorf("counted %d times, want 1", gets)
	}
}

// A sign-up that was stored is never reported as failed because the count after it failed.
func TestWaitlistStoredSignUpWithoutCount(t *testing.T) {
	fake := &fakePostgREST{emails: map[string]bool{}, countDown: true}
	srv := httptest.NewServer(fake)
	defer srv.Close()
	h := waitlistHandler(&supabaseWaitlist{url: srv.URL, key: "k", http: srv.Client()})
	if code, out := waitlistCall(t, h, "POST", `{"email": "ada@example.com"}`); code != 201 || out["count"] != nil || out["error"] != nil {
		t.Errorf("POST new, count failing: %d %v", code, out)
	}
	if code, out := waitlistCall(t, h, "POST", `{"email": "ada@example.com"}`); code != 200 || out["already"] != true || out["count"] != nil {
		t.Errorf("POST again, count failing: %d %v", code, out)
	}
	if !fake.emails["ada@example.com"] {
		t.Error("the address was not stored")
	}
}

// Many requests on a stale cache make one count, not one each.
func TestWaitlistCountsOnceUnderABurst(t *testing.T) {
	fake := &fakePostgREST{emails: map[string]bool{"ada@example.com": true}}
	srv := httptest.NewServer(fake)
	defer srv.Close()
	h := waitlistHandler(&supabaseWaitlist{url: srv.URL, key: "k", http: srv.Client()})
	var wg sync.WaitGroup
	for range 50 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			rec := httptest.NewRecorder()
			h.ServeHTTP(rec, httptest.NewRequest("GET", "/api/waitlist", nil))
			if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"count":1`) {
				t.Errorf("GET: %d %s", rec.Code, rec.Body.String())
			}
		}()
	}
	wg.Wait()
	if gets, _ := fake.state(); gets != 1 {
		t.Errorf("50 simultaneous GETs counted the table %d times, want 1", gets)
	}
}

func waitlistFrom(h http.Handler, addr, email string) int {
	req := httptest.NewRequest("POST", "/api/waitlist", strings.NewReader(`{"email": "`+email+`"}`))
	if addr != "" {
		req.Header.Set("X-Real-IP", addr)
	}
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec.Code
}

func TestWaitlistLimitsEachSender(t *testing.T) {
	list := &memoryWaitlist{emails: map[string]bool{}}
	h := waitlistHandler(list)
	for i := range waitlistPerAddress {
		if code := waitlistFrom(h, "203.0.113.7", fmt.Sprintf("a%d@example.com", i)); code != 201 {
			t.Errorf("attempt %d: %d", i+1, code)
		}
	}
	// The next one is refused whatever it holds (a new address, a listed one, junk), and nothing is stored.
	for _, email := range []string{"one-more@example.com", "a0@example.com", "junk"} {
		if code := waitlistFrom(h, "203.0.113.7", email); code != 429 {
			t.Errorf("%q past the limit: %d, want 429", email, code)
		}
	}
	if code := waitlistFrom(h, "203.0.113.8", "other@example.com"); code != 201 {
		t.Errorf("another sender: %d", code)
	}
	// One IPv6 subscriber (a /64) is one sender; the next /64 is another.
	for i := range waitlistPerAddress {
		waitlistFrom(h, fmt.Sprintf("2001:db8:1:2::%x", i+1), fmt.Sprintf("v6-%d@example.com", i))
	}
	if code := waitlistFrom(h, "2001:db8:1:2:ffff::9", "v6-more@example.com"); code != 429 {
		t.Errorf("same /64 past the limit: %d, want 429", code)
	}
	if code := waitlistFrom(h, "2001:db8:1:3::1", "v6-next@example.com"); code != 201 {
		t.Errorf("the next /64: %d", code)
	}
	// Without the edge's header (local runs) the sender is unknown and only the daily limit applies.
	for i := range waitlistPerAddress + 3 {
		if code := waitlistFrom(h, "", fmt.Sprintf("local%d@example.com", i)); code != 201 {
			t.Errorf("local attempt %d: %d", i+1, code)
		}
	}
	if n, _ := list.count(); n != 2*waitlistPerAddress+2+waitlistPerAddress+3 {
		t.Errorf("%d addresses stored", n)
	}
	if code, out := waitlistCall(t, h, "GET", ""); code != 200 || out["count"] == nil {
		t.Errorf("GET is never limited: %d %v", code, out)
	}
}

func TestWaitlistDailyLimit(t *testing.T) {
	t.Setenv("WAITLIST_DAILY_MAX", "2")
	h := waitlistHandler(&memoryWaitlist{emails: map[string]bool{}})
	for i, want := range []int{201, 200, 201, 429, 429} { // a repeat adds no row; the third new row is over
		email := []string{"a@example.com", "a@example.com", "b@example.com", "c@example.com", "a@example.com"}[i]
		if code := waitlistFrom(h, fmt.Sprintf("203.0.113.%d", i), email); code != want {
			t.Errorf("request %d (%s): %d, want %d", i+1, email, code, want)
		}
	}
	// The next UTC day starts a new allowance.
	l := newWaitlistLimiter()
	now := time.Date(2026, 11, 9, 23, 59, 0, 0, time.UTC)
	l.allow("", now)
	l.added()
	l.added()
	if l.allow("", now) || !l.allow("", now.Add(2*time.Minute)) {
		t.Error("the daily limit should hold until midnight UTC and reset after it")
	}
}

func TestWaitlistLimiterStaysBounded(t *testing.T) {
	l := newWaitlistLimiter()
	now := time.Now()
	for i := range 25000 {
		l.allow(fmt.Sprintf("198.51.%d.%d", i/256, i%256), now)
	}
	if len(l.tries) > 10000 {
		t.Errorf("%d senders remembered, want at most 10000", len(l.tries))
	}
	// An hour later the same sender has a fresh allowance.
	for range waitlistPerAddress {
		l.allow("203.0.113.7", now)
	}
	if l.allow("203.0.113.7", now.Add(59*time.Minute)) || !l.allow("203.0.113.7", now.Add(61*time.Minute)) {
		t.Error("a sender's allowance should last the hour and return after it")
	}
}

func TestCleanEmail(t *testing.T) {
	good := []string{"ada@example.com", "first.last+tag@sub.example.co.uk", "o'brien@example.ie", "ünï@exämple.de", " Ada@Example.com "}
	for _, s := range good {
		if _, ok := cleanEmail(s); !ok {
			t.Errorf("%q should be accepted", s)
		}
	}
	bad := []string{
		"a@.", ".@.", "a@-.-", "a@b..c", "a@-b.com", "a@b", "ada", "@example.com", "a@@example.com", "x,victim@example.com",
		"<script>alert(1)</script>@x.y", `=hyperlink("http://evil.example","x")&"@x.y`, "Ada <ada@example.com>", `"ada"@example.com`,
		"ada@example.com\x00", "ada\x08@example.com", "ada@exam\u2028ple.com", "ada\u00a0b@example.com", "ada\u200b@example.com",
		"ad a@example.com", "ada@example.com\nbcc: x@example.com",
	}
	for _, s := range bad {
		if _, ok := cleanEmail(s); ok {
			t.Errorf("%q should be refused", s)
		}
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
