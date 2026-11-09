// Serves /api/waitlist, the sign-up list for the dataset. GET answers how many addresses
// are on it; POST {"email": "..."} adds one. With SUPABASE_URL and SUPABASE_SERVICE_KEY
// set (the same env as the hand store) the list is the dataset_waitlist table, otherwise
// it lives in memory for development and tests. Addresses are never logged or returned.
package api

import (
	"bytes"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

const waitlistCountTTL = 30 * time.Second // how long a Supabase count is reused

type waitlistStore interface {
	add(email string) (added bool, err error) // added is false when the address was already listed
	count() (int, error)
}

func newWaitlist() waitlistStore {
	if url, key := os.Getenv("SUPABASE_URL"), os.Getenv("SUPABASE_SERVICE_KEY"); url != "" && key != "" {
		return &supabaseWaitlist{url: strings.TrimRight(url, "/"), key: key, http: &http.Client{Timeout: 15 * time.Second}}
	}
	return &memoryWaitlist{emails: map[string]bool{}}
}

// waitlistHandler answers GET with {"count": N}; POST with 201 {"count": N} for a new
// address, 200 {"count": N, "already": true} for one already listed and 400 for an
// invalid one (bodies over 1 KB included); 503 when the store fails; 405 otherwise.
func waitlistHandler(store waitlistStore) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		status, out := http.StatusOK, map[string]any{}
		switch r.Method {
		case http.MethodGet:
		case http.MethodPost:
			var in struct {
				Email string `json:"email"`
			}
			email, ok := "", false
			if json.NewDecoder(http.MaxBytesReader(w, r.Body, 1024)).Decode(&in) == nil {
				email, ok = cleanEmail(in.Email)
			}
			if !ok {
				writeJSON(w, http.StatusBadRequest, map[string]any{"error": "invalid email"})
				return
			}
			added, err := store.add(email)
			if err != nil {
				log.Printf("Waitlist: %v", err)
				writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "unavailable"})
				return
			}
			if added {
				status = http.StatusCreated
			} else {
				out["already"] = true
			}
		default:
			w.Header().Set("Allow", "GET, POST")
			writeJSON(w, http.StatusMethodNotAllowed, map[string]any{"error": "method not allowed"})
			return
		}
		n, err := store.count()
		if err != nil {
			log.Printf("Waitlist: %v", err)
			writeJSON(w, http.StatusServiceUnavailable, map[string]any{"error": "unavailable"})
			return
		}
		out["count"] = n
		writeJSON(w, status, out)
	}
}

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

// cleanEmail trims and lowercases an address and says whether it is one we accept: at
// most 254 characters, one "@" with something before it, a domain with a dot, no spaces.
func cleanEmail(s string) (string, bool) {
	s = strings.ToLower(strings.TrimSpace(s))
	at := strings.Index(s, "@")
	ok := len(s) <= 254 && at > 0 && strings.Count(s, "@") == 1 &&
		strings.Contains(s[at+1:], ".") && !strings.ContainsAny(s, " \t\r\n")
	return s, ok
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

// supabaseWaitlist is the dataset_waitlist table through PostgREST. The count is cached for
// waitlistCountTTL and bumped on each insert, so the table is counted at most twice a minute.
type supabaseWaitlist struct {
	url  string
	key  string
	http *http.Client

	mu       sync.Mutex
	cached   int
	cachedAt time.Time
}

func (s *supabaseWaitlist) do(method, query string, body []byte, prefer string) (*http.Response, error) {
	req, err := http.NewRequest(method, s.url+"/rest/v1/dataset_waitlist"+query, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("apikey", s.key)
	req.Header.Set("Authorization", "Bearer "+s.key)
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Prefer", prefer)
	return s.http.Do(req)
}

// add inserts the address; the table's unique index on lower(email) makes a duplicate a 409.
// Errors carry only the status, never the response body, which could echo the address.
func (s *supabaseWaitlist) add(email string) (bool, error) {
	body, _ := json.Marshal(map[string]string{"email": email})
	resp, err := s.do("POST", "", body, "return=minimal")
	if err != nil {
		return false, err
	}
	resp.Body.Close()
	switch resp.StatusCode {
	case http.StatusCreated:
		s.mu.Lock()
		s.cached++ // a stale count is fetched again by count anyway
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
	n, fresh := s.cached, time.Since(s.cachedAt) < waitlistCountTTL
	s.mu.Unlock()
	if fresh {
		return n, nil
	}
	resp, err := s.do("GET", "?select=id&limit=1", nil, "count=exact")
	if err != nil {
		return 0, err
	}
	resp.Body.Close()
	if resp.StatusCode >= 300 {
		return 0, fmt.Errorf("count: status %d", resp.StatusCode)
	}
	if n, err = contentRangeTotal(resp.Header.Get("Content-Range")); err != nil {
		return 0, err
	}
	s.mu.Lock()
	s.cached, s.cachedAt = n, time.Now()
	s.mu.Unlock()
	return n, nil
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
