// HTTP server for the frontend (web/): the live stream (stream.go) of the shared table in
// table.go, plus stats, usage and the waitlist.
package api

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
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
		stats.tableID, stats.tableFrom = s.table.id, time.Now().UTC()
		go stats.run()
		s.table.Run()
	}()

	http.HandleFunc("/stream", s.handleCORS(h.handleStream))
	http.HandleFunc("/health", s.handleHealth)
	http.HandleFunc("/api/usage", s.handleCORS(s.handleUsage))
	http.HandleFunc("/api/stats", s.handleCORS(stats.handle))
	http.HandleFunc("/api/stats/timeline", s.handleCORS(stats.handleTimeline))
	http.HandleFunc("/api/waitlist", s.handleCORS(waitlistHandler(newWaitlist())))

	addr := fmt.Sprintf(":%d", port)
	log.Printf("Starting server on %s", addr)
	return http.ListenAndServe(addr, nil)
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
