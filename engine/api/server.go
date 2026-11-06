// WebSocket server for the frontend (web/). Every connection is a spectator of the shared
// table in table.go.
package api

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"time"

	"github.com/gorilla/websocket"
	"github.com/rizzwareengineer/no-LLMit/engine/client"
	"github.com/rizzwareengineer/no-LLMit/engine/game"
)

// WebSocket connections start as HTTP, then get "upgraded" to WebSocket protocol.
// The upgrader handles this handshake so we can push real-time game updates (vs polling).
// https://pkg.go.dev/github.com/gorilla/websocket#section-readme
var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

type Server struct {
	// The shared spectator table everyone watches.
	table *Table
}

func NewServer() *Server {
	return &Server{}
}

func (s *Server) Start(port int) error {
	stats := newStatsCache()
	s.table = NewTable(stats.Add)
	// The lineup can take up to a minute while the LLM service starts; /api/stats answers
	// 503 until then so it never reports a lineup the table will not play.
	go func() {
		s.table.seated = s.table.lineup()
		stats.seated = s.table.seated
		stats.tableID, stats.tableFrom = s.table.id, time.Now().UTC()
		go stats.run()
		s.table.Run()
	}()

	http.HandleFunc("/ws", s.handleWebSocket)
	http.HandleFunc("/health", s.handleHealth)
	http.HandleFunc("/api/usage", s.handleCORS(s.handleUsage))
	http.HandleFunc("/api/stats", s.handleCORS(stats.handle))

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

// handleUsage reports the shared table's call count and hours, plus the LLM service's
// provider and spend, for the frontend's usage widget.
func (s *Server) handleUsage(w http.ResponseWriter, r *http.Request) {
	out := map[string]interface{}{"table": s.table.Usage()}
	if llm, err := client.GetLLMUsage(); err != nil {
		log.Printf("Usage: %v", err)
	} else {
		out["llm"] = llm
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(out)
}

func (s *Server) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return
	}
	defer func() {
		s.table.Leave(conn)
		conn.Close()
	}()

	s.table.Join(conn)

	log.Printf("New WebSocket connection from %s", conn.RemoteAddr())

	conn.SetReadDeadline(time.Now().Add(60 * time.Second))
	conn.SetPongHandler(func(string) error {
		conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	for {
		_, message, err := conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("WebSocket error: %v", err)
			} else if websocket.IsCloseError(err, websocket.CloseNormalClosure, websocket.CloseGoingAway) {
				log.Printf("WebSocket closed normally: %v", err)
			} else {
				log.Printf("WebSocket closed: %v", err)
			}
			break
		}

		conn.SetReadDeadline(time.Now().Add(60 * time.Second))

		// Spectators can ask for the current state and nothing else.
		var msg ClientMessage
		switch {
		case json.Unmarshal(message, &msg) != nil:
			s.table.Reject(conn, "Invalid message format")
		case msg.Type == MsgGetState:
			s.table.Resend(conn)
		default:
			s.table.Reject(conn, "This table is spectate-only")
		}
	}
}

func convertWinners(winners []game.Winner) []WinnerPayload {
	var result []WinnerPayload
	for _, w := range winners {
		result = append(result, WinnerPayload{
			PlayerIdx:       w.PlayerIdx,
			Amount:          w.Amount,
			HandType:        w.HandType.String(),
			HandDesc:        w.HandDesc,
			EligiblePlayers: w.EligiblePlayers,
			PotNumber:       w.PotNumber,
		})
	}
	return result
}
