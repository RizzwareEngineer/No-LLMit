// HTTP server for the frontend (web/): the live stream (stream.go) of the shared table in
// table.go, plus stats, usage and the waitlist.
package api

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"strconv"
	"sync"
	"time"

	"github.com/rizzwareengineer/no-LLMit/engine/client"
)

type Server struct {
	// The shared spectator table everyone watches.
	table *Table

	usageMu  sync.Mutex
	usageAt  time.Time       // when the last fetch started
	usageLLM json.RawMessage // nil when the last fetch failed
}

func (s *Server) Start(port int) error {
	h := newHub()
	stats := newStatsCache()
	stats.hub = h
	s.table = NewTable(h, stats.Add)
	// The lineup waits for the LLM service to start; until then /api/stats answers 503 and
	// /stream sends no tables, so neither reports a lineup the table will not play.
	go func() {
		s.table.seated = s.table.lineup()
		stats.seated = s.table.seated
		go stats.run()
		s.table.Run()
	}()

	http.HandleFunc("/stream", s.handleCORS(h.handleStream))
	http.HandleFunc("/health", s.handleHealth)
	http.HandleFunc("/api/usage", s.handleCORS(s.handleUsage))
	http.HandleFunc("/api/stats", s.handleCORS(stats.handle))
	http.HandleFunc("/api/stats/timeline", s.handleCORS(stats.handleTimeline))
	http.HandleFunc("/api/waitlist", s.handleCORS(waitlistHandler(newWaitlist())))
	s.devRoutes(http.DefaultServeMux)

	addr := fmt.Sprintf(":%d", port)
	log.Printf("Starting server on %s", addr)
	// No ReadTimeout or WriteTimeout: they would cut every stream. Streams set their own write deadlines.
	srv := &http.Server{Addr: addr, ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 120 * time.Second}
	return srv.ListenAndServe()
}

func (s *Server) handleCORS(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Content-Type")

		if r.Method == "OPTIONS" {
			w.WriteHeader(http.StatusOK)
			return
		}

		next(w, r)
	}
}

func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

// handleUsage reports the shared table's call count, hours and open streams, plus the LLM
// service's provider and spend, for the frontend's usage widget.
func (s *Server) handleUsage(w http.ResponseWriter, r *http.Request) {
	out := map[string]interface{}{"table": s.table.Usage()}
	if llm := s.llmUsage(); llm != nil {
		out["llm"] = llm
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(out)
}

var getLLMUsage = client.GetLLMUsage // a test swaps in a slow fetch

// llmUsage asks the LLM service at most once a minute, whether the last call worked or not:
// every open page asks, and the service also answers the table's turns. The request that
// starts a fetch waits for it; the others get the last answer without waiting. The fetch
// times out well inside the minute, so only one runs at a time.
func (s *Server) llmUsage() json.RawMessage {
	s.usageMu.Lock()
	last, stale := s.usageLLM, time.Since(s.usageAt) >= time.Minute
	if stale {
		s.usageAt = time.Now()
	}
	s.usageMu.Unlock()
	if !stale {
		return last
	}
	llm, err := getLLMUsage()
	if err != nil {
		log.Printf("Usage: %v", err)
	}
	s.usageMu.Lock()
	s.usageLLM = llm
	s.usageMu.Unlock()
	return llm
}

// devRoutes adds the owner's local tools, only with DEV_CONTROLS=1: production never sets it, so there
// the routes do not exist (404).
func (s *Server) devRoutes(mux *http.ServeMux) {
	if os.Getenv("DEV_CONTROLS") != "1" {
		return
	}
	log.Printf("DEV_CONTROLS=1: /dev/pace is open")
	mux.HandleFunc("/dev/pace", s.handleCORS(s.handlePace))
}

// handlePace reads (GET) or sets (POST ?pace=0.5, or a form body) the table's pace, 0.1 to 2;
// the next pause uses it.
func (s *Server) handlePace(w http.ResponseWriter, r *http.Request) {
	// Only a page served from this machine: with CORS open, any site the owner visits could
	// otherwise post a form here.
	if o := r.Header.Get("Origin"); o != "" && !isLocalOrigin(o) {
		http.Error(w, "forbidden", http.StatusForbidden)
		return
	}
	switch r.Method {
	case http.MethodGet:
	case http.MethodPost:
		p, err := strconv.ParseFloat(r.FormValue("pace"), 64)
		if err != nil || !(p >= 0.1 && p <= 2) {
			http.Error(w, "pace must be a number from 0.1 to 2", http.StatusBadRequest)
			return
		}
		s.table.setPace(p)
		log.Printf("Pace set to %g", p)
	default:
		http.Error(w, "GET or POST", http.StatusMethodNotAllowed)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(map[string]float64{"pace": s.table.Pace()})
}
