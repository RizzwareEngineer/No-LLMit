// WebSocket server that receives messages from the frontend (web/).
// Routes messages to game_handlers.go (human actions) or llm_handlers.go (LLM turns).
package api

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"
	"time"

	"github.com/gorilla/websocket"
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
	games        map[string]*game.GameState
	clients      map[*websocket.Conn]string // conn -> gameID
	paused       map[string]bool            // gameID -> isPaused
	pendingPause map[string]bool            // gameID -> pause requested (takes effect after current action)
	mu           sync.RWMutex
}

func NewServer() *Server {
	return &Server{
		games:        make(map[string]*game.GameState),
		clients:      make(map[*websocket.Conn]string),
		paused:       make(map[string]bool),
		pendingPause: make(map[string]bool),
	}
}

func (s *Server) Start(port int) error {
	http.HandleFunc("/ws", s.handleWebSocket)
	http.HandleFunc("/health", s.handleHealth)
	http.HandleFunc("/api/games", s.handleCORS(s.handleListGames))

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

func (s *Server) handleListGames(w http.ResponseWriter, r *http.Request) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	var games []map[string]interface{}
	for id, gs := range s.games {
		games = append(games, map[string]interface{}{
			"id":         id,
			"handNumber": gs.HandNumber,
			"players":    len(gs.Players),
			"street":     gs.Street.String(),
		})
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(games)
}

func (s *Server) handleWebSocket(w http.ResponseWriter, r *http.Request) {
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("WebSocket upgrade error: %v", err)
		return
	}
	defer func() {
		s.mu.Lock()
		delete(s.clients, conn)
		s.mu.Unlock()
		conn.Close()
	}()

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
		s.handleMessage(conn, message)
	}
}

func (s *Server) handleMessage(conn *websocket.Conn, message []byte) {
	var msg ClientMessage
	if err := json.Unmarshal(message, &msg); err != nil {
		s.sendError(conn, "Invalid message format")
		return
	}

	log.Printf("Received message type: %s", msg.Type)

	switch msg.Type {
	case MsgNewGame:
		s.handleNewGame(conn, msg.Payload)
	case MsgStartHand:
		s.handleStartHand(conn)
	case MsgAction:
		s.handleAction(conn, msg.Payload)
	case MsgGetState:
		s.handleGetState(conn)
	case MsgPause:
		s.handlePause(conn)
	case MsgResume:
		s.handleResume(conn)
	default:
		s.sendError(conn, fmt.Sprintf("Unknown message type: %s", msg.Type))
	}
}

func parsePayload[T any](payload interface{}) (*T, error) {
	data, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	var result T
	if err := json.Unmarshal(data, &result); err != nil {
		return nil, err
	}
	return &result, nil
}

func (s *Server) isPaused(gameID string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.paused[gameID]
}

func (s *Server) isPendingPause(gameID string) bool {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return s.pendingPause[gameID]
}

func (s *Server) activatePendingPause(gameID string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.pendingPause[gameID] {
		s.paused[gameID] = true
		s.pendingPause[gameID] = false
		return true
	}
	return false
}

func (s *Server) getGameForConn(conn *websocket.Conn) *game.GameState {
	s.mu.RLock()
	gameID := s.clients[conn]
	gs := s.games[gameID]
	s.mu.RUnlock()
	return gs
}

func (s *Server) sendGameState(conn *websocket.Conn, gs *game.GameState) {
	showAllCards := gs.Mode == game.ModeTest
	payload := ConvertGameState(gs, showAllCards)

	s.send(conn, ServerMessage{
		Type:    MsgGameState,
		Payload: payload,
	})
}

func (s *Server) sendActionRequiredIfNeeded(conn *websocket.Conn, gs *game.GameState) {
	if !gs.IsWaitingForAction() {
		return
	}

	player := gs.GetCurrentPlayer()
	if player == nil {
		return
	}

	validActions := gs.GetValidActions()
	var vaPayloads []ValidActionPayload
	for _, va := range validActions {
		vaPayloads = append(vaPayloads, ValidActionPayload{
			Type:      va.Type.String(),
			MinAmount: va.MinAmount,
			MaxAmount: va.MaxAmount,
		})
	}

	s.send(conn, ServerMessage{
		Type: MsgActionReq,
		Payload: ActionRequiredPayload{
			PlayerIdx:    gs.CurrentPlayerIdx,
			PlayerName:   player.Name,
			ValidActions: vaPayloads,
		},
	})
}

func (s *Server) sendError(conn *websocket.Conn, message string) {
	log.Printf("Error: %s", message)
	s.send(conn, ServerMessage{
		Type:    MsgError,
		Payload: ErrorPayload{Message: message},
	})
}

func (s *Server) send(conn *websocket.Conn, msg ServerMessage) {
	data, err := json.Marshal(msg)
	if err != nil {
		log.Printf("Error marshaling message: %v", err)
		return
	}

	conn.SetWriteDeadline(time.Now().Add(10 * time.Second))
	if err := conn.WriteMessage(websocket.TextMessage, data); err != nil {
		log.Printf("Error sending message: %v", err)
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
