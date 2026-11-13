// Serves /api/waitlist, the sign-up list for the dataset. GET answers how many addresses
// are on it; POST {"email": "..."} adds one. With SUPABASE_URL and SUPABASE_SERVICE_KEY
// set (the same env as the hand store) the list is the dataset_waitlist table, otherwise
// it lives in memory for development and tests. Addresses are never logged or returned.
// The endpoint is public and every accepted address is a row written with the service key,
// so sign-ups are limited per client address and per day.
package api

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/mail"
	"net/netip"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	waitlistCountTTL     = 30 * time.Second // how long a Supabase count is reused
	waitlistCountTimeout = 5 * time.Second  // the longest a count, and so anything waiting on it, takes
	waitlistPerAddress   = 5                // sign-up attempts one client address gets per hour
)

type waitlistStore interface {
	add(email string) (added bool, err error) // added is false when the address was already listed
	count() (int, error)
}

func newWaitlist() waitlistStore {
	if base, key := supabaseEnv(); base != "" {
		return &supabaseWaitlist{url: base, key: key, http: &http.Client{Timeout: 15 * time.Second}}
	}
	return &memoryWaitlist{emails: map[string]bool{}}
}

// waitlistHandler answers GET with {"count": N}; POST with 201 {"count": N} for a valid
// address, the same whether it was new or already listed, so the reply never tells whether
// someone signed up; 400 for an invalid one (bodies over 1 KB included) and 429 past the
// sign-up limits; 503 when the store fails; 405 otherwise. A sign-up that was stored is
// never reported as failed: when only the count after it fails, the answer is the 201
// without "count".
func waitlistHandler(store waitlistStore) http.HandlerFunc {
	limit := newWaitlistLimiter()
	return func(w http.ResponseWriter, r *http.Request) {
		status, out := http.StatusOK, map[string]any{}
		switch r.Method {
		case http.MethodGet:
		case http.MethodPost:
			if !limit.allow(clientAddr(r), time.Now()) {
				writeJSON(w, http.StatusTooManyRequests, map[string]any{"error": "too many requests"})
				return
			}
			var in struct {
				Email string `json:"email"`
			}
			email, ok := "", false
			if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&in) == nil {
				email, ok = cleanEmail(in.Email)
			}
			if !ok {
				limit.release()
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid email"})
				return
			}
			added, err := store.add(email)
			if err != nil {
				limit.release()
				log.Printf("Waitlist: %v", err)
				writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "unavailable"})
				return
			}
			if !added {
				limit.release()
			}
			status = http.StatusCreated
		default:
			w.Header().Set("Allow", "GET, POST")
			writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": "method not allowed"})
			return
		}
		n, err := store.count()
		switch {
		case err == nil:
			out["count"] = n
		case r.Method == http.MethodGet:
			log.Printf("Waitlist: %v", err)
			writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "unavailable"})
			return
		default:
			log.Printf("Waitlist: stored, but %v", err)
		}
		writeJSON(w, status, out)
	}
}

// waitlistLimiter bounds what one sender, and all senders together, can add.
type waitlistLimiter struct {
	mu       sync.Mutex
	tries    map[string]*waitlistTries // by client address, for the current hour
	dailyMax int                       // new rows per UTC day: WAITLIST_DAILY_MAX, default 5000
	day      string
	rows     int
}

type waitlistTries struct {
	since time.Time
	n     int
}

func newWaitlistLimiter() *waitlistLimiter {
	return &waitlistLimiter{tries: map[string]*waitlistTries{}, dailyMax: envInt("WAITLIST_DAILY_MAX", 5000)}
}

// allow counts one sign-up attempt and, when it may go on, reserves the row it could add,
// so sign-ups in flight together cannot pass the daily limit; release gives the row back
// when none was added. addr is "" when the sender is unknown (no edge in front: local
// runs); then only the daily limit applies.
func (l *waitlistLimiter) allow(addr string, now time.Time) bool {
	l.mu.Lock()
	defer l.mu.Unlock()
	if day := now.UTC().Format(time.DateOnly); day != l.day {
		l.day, l.rows = day, 0
	}
	if l.rows >= l.dailyMax {
		return false
	}
	if addr != "" {
		if len(l.tries) >= 10000 { // bounded whatever arrives: drop the hours that have passed, else start over
			for a, t := range l.tries {
				if now.Sub(t.since) >= time.Hour {
					delete(l.tries, a)
				}
			}
			if len(l.tries) >= 10000 {
				clear(l.tries)
			}
		}
		t := l.tries[addr]
		if t == nil || now.Sub(t.since) >= time.Hour {
			t = &waitlistTries{since: now}
			l.tries[addr] = t
		}
		if t.n++; t.n > waitlistPerAddress {
			return false
		}
	}
	l.rows++
	return true
}

// release returns a reserved row that was not added (an invalid or listed address, a store failure).
func (l *waitlistLimiter) release() {
	l.mu.Lock()
	if l.rows > 0 {
		l.rows--
	}
	l.mu.Unlock()
}

// clientAddr is the sender as Railway's edge reports it (X-Real-IP, which the edge sets on
// every request), or "" without that header. IPv6 senders are grouped by /64, the block one
// subscriber controls.
func clientAddr(r *http.Request) string {
	s := strings.TrimSpace(r.Header.Get("X-Real-IP"))
	if ip, err := netip.ParseAddr(s); err == nil && ip.Is6() && !ip.Is4In6() {
		return netip.PrefixFrom(ip, 64).Masked().String()
	}
	return s
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

// cleanEmail trims and lowercases an address and says whether it is one we accept: at
// most 254 characters, printable ASCII only (browsers send an international domain in its
// ASCII form and refuse other local parts; anything else is mostly look-alike copies of an
// address that the unique index cannot catch), a plain address as net/mail reads it (no
// display name, quotes or comments), not starting with = + or - (a formula once the list
// is opened in a spreadsheet), and a host name after the "@".
func cleanEmail(s string) (string, bool) {
	s = strings.ToLower(strings.TrimSpace(s))
	if s == "" || len(s) > 254 || strings.IndexByte("=+-", s[0]) >= 0 {
		return s, false
	}
	for i := 0; i < len(s); i++ {
		if s[i] <= ' ' || s[i] > '~' {
			return s, false
		}
	}
	parsed, err := mail.ParseAddress(s)
	at := strings.LastIndex(s, "@")
	return s, err == nil && parsed.Address == s && parsed.Name == "" && at > 0 && isHostName(s[at+1:])
}

// isHostName reports whether h is two or more labels of letters, digits and inner hyphens,
// each at most 63 long, the last one with a letter (so an IP address is not one).
func isHostName(h string) bool {
	labels := strings.Split(h, ".")
	if len(labels) < 2 {
		return false
	}
	for _, l := range labels {
		if l == "" || len(l) > 63 || l[0] == '-' || l[len(l)-1] == '-' {
			return false
		}
		for i := 0; i < len(l); i++ {
			if c := l[i]; !(c >= 'a' && c <= 'z' || c >= '0' && c <= '9' || c == '-') {
				return false
			}
		}
	}
	return strings.ContainsAny(labels[len(labels)-1], "abcdefghijklmnopqrstuvwxyz")
}

// memoryWaitlist is the list without Supabase; it lasts as long as the process.
type memoryWaitlist struct {
	mu     sync.Mutex
	emails map[string]bool
}

func (m *memoryWaitlist) add(email string) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.emails[email] {
		return false, nil
	}
	m.emails[email] = true
	return true, nil
}

func (m *memoryWaitlist) count() (int, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	return len(m.emails), nil
}

// supabaseWaitlist is the dataset_waitlist table through PostgREST (schema:
// supabase/migrations). The count is cached for waitlistCountTTL and counted again after
// each insert; one request counts at a time while the others wait (at most
// waitlistCountTimeout), and a failed count is remembered for the TTL too, whatever is
// inserted meanwhile (the last total is served if there is one), so a struggling store is
// asked once per TTL, not on every request.
type supabaseWaitlist struct {
	url  string
	key  string
	http *http.Client

	mu        sync.Mutex
	cached    int
	counted   bool // cached holds a total the store gave
	cachedErr error
	cachedAt  time.Time // when the store last gave a total; zeroed by an insert so the next count asks again
	failedAt  time.Time // when a count last failed; inserts leave it, so they cannot make a struggling store be asked again
}

func (s *supabaseWaitlist) do(ctx context.Context, method, query string, body []byte, prefer string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, method, s.url+"/rest/v1/dataset_waitlist"+query, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	setSupabaseAuth(req, s.key)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Prefer", prefer)
	return s.http.Do(req)
}

// add inserts the address; the table's unique index on lower(email) makes a duplicate a 409.
// Errors carry only the status, never the response body, which could echo the address.
func (s *supabaseWaitlist) add(email string) (bool, error) {
	body, _ := json.Marshal(map[string]string{"email": email})
	resp, err := s.do(context.Background(), "POST", "", body, "return=minimal")
	if err != nil {
		return false, err
	}
	resp.Body.Close()
	switch resp.StatusCode {
	case http.StatusCreated:
		s.mu.Lock()
		s.cached++               // right if the count that follows fails
		s.cachedAt = time.Time{} // count again: a count in flight may or may not have seen this row
		s.mu.Unlock()
		return true, nil
	case http.StatusConflict:
		return false, nil
	default:
		return false, fmt.Errorf("insert: status %d", resp.StatusCode)
	}
}

func (s *supabaseWaitlist) count() (int, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if time.Since(s.cachedAt) < waitlistCountTTL || time.Since(s.failedAt) < waitlistCountTTL {
		return s.cached, s.cachedErr
	}
	n, err := s.fetchCount()
	switch {
	case err == nil:
		s.cached, s.counted, s.cachedErr, s.cachedAt, s.failedAt = n, true, nil, time.Now(), time.Time{}
	case s.counted:
		log.Printf("Waitlist: serving the last total: %v", err)
		s.cachedErr, s.failedAt = nil, time.Now()
	default:
		s.cachedErr, s.failedAt = err, time.Now()
	}
	return s.cached, s.cachedErr
}

func (s *supabaseWaitlist) fetchCount() (int, error) {
	ctx, cancel := context.WithTimeout(context.Background(), waitlistCountTimeout)
	defer cancel()
	resp, err := s.do(ctx, "GET", "?select=id&limit=1", nil, "count=exact")
	if err != nil {
		return 0, err
	}
	resp.Body.Close()
	if resp.StatusCode >= 300 {
		return 0, fmt.Errorf("count: status %d", resp.StatusCode)
	}
	return contentRangeTotal(resp.Header.Get("Content-Range"))
}

// contentRangeTotal reads the total after the slash of a PostgREST Content-Range header:
// "0-0/42", or "*/0" for an empty table.
func contentRangeTotal(h string) (int, error) {
	_, total, ok := strings.Cut(h, "/")
	n, err := strconv.Atoi(total)
	if !ok || err != nil {
		return 0, fmt.Errorf("no total in Content-Range %q", h)
	}
	return n, nil
}
