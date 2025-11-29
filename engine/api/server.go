package api

import (
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"sync"

	"github.com/gorilla/websocket"
	"github.com/rizzwareengineer/no-LLMit/engine/game"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		// Allow all origins for development
		return true
	},
}

// Server represents the WebSocket game server
type Server struct {
	games   map[string]*game.GameState
	clients map[*websocket.Conn]string // conn -> gameID
	mu      sync.RWMutex
}

// NewServer creates a new game server
func NewServer() *Server {
	return &Server{
		games:   make(map[string]*game.GameState),
		clients: make(map[*websocket.Conn]string),
	}
}

// Start starts the HTTP server
func (s *Server) Start(port int) error {
	http.HandleFunc("/ws", s.handleWebSocket)
	http.HandleFunc("/health", s.handleHealth)

	// Enable CORS for REST endpoints
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
	defer conn.Close()

	log.Printf("New WebSocket connection from %s", conn.RemoteAddr())

	// Main message loop
	for {
		_, message, err := conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseAbnormalClosure) {
				log.Printf("WebSocket error: %v", err)
			}
			break
		}

		s.handleMessage(conn, message)
	}

	// Cleanup on disconnect
	s.mu.Lock()
	delete(s.clients, conn)
	s.mu.Unlock()
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
	default:
		s.sendError(conn, fmt.Sprintf("Unknown message type: %s", msg.Type))
	}
}

// parsePayload converts interface{} payload to a typed struct
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

func (s *Server) handleNewGame(conn *websocket.Conn, payload interface{}) {
	ngp, err := parsePayload[NewGamePayload](payload)
	if err != nil {
		s.sendError(conn, "Invalid new game payload")
		return
	}

	// Validate
	if len(ngp.PlayerNames) < 2 || len(ngp.PlayerNames) > 9 {
		s.sendError(conn, "Player count must be between 2 and 9")
		return
	}

	if ngp.StartingStack <= 0 {
		ngp.StartingStack = 2000
	}
	if ngp.SmallBlind <= 0 {
		ngp.SmallBlind = 5
	}
	if ngp.BigBlind <= 0 {
		ngp.BigBlind = 10
	}

	// Create game
	config := game.GameConfig{
		PlayerNames:   ngp.PlayerNames,
		StartingStack: ngp.StartingStack,
		Stakes: game.Stakes{
			SmallBlind: ngp.SmallBlind,
			BigBlind:   ngp.BigBlind,
		},
		Mode:        ParseGameMode(ngp.Mode),
		UserSeatIdx: ngp.UserSeatIdx,
	}

	gs := game.NewGame(config)

	s.mu.Lock()
	s.games[gs.ID] = gs
	s.clients[conn] = gs.ID
	s.mu.Unlock()

	log.Printf("Created new game: %s with %d players in %s mode", gs.ID, len(gs.Players), gs.Mode.String())

	// Send initial state
	s.sendGameState(conn, gs)
}

func (s *Server) handleStartHand(conn *websocket.Conn) {
	gs := s.getGameForConn(conn)
	if gs == nil {
		s.sendError(conn, "No game found. Create a game first.")
		return
	}

	if err := gs.StartHand(); err != nil {
		s.sendError(conn, err.Error())
		return
	}

	log.Printf("Started hand #%d", gs.HandNumber)

	// Send hand start notification
	s.send(conn, ServerMessage{
		Type: MsgHandStart,
		Payload: map[string]interface{}{
			"handNumber": gs.HandNumber,
		},
	})

	// Send updated game state
	s.sendGameState(conn, gs)

	// Send action required if waiting for player
	s.sendActionRequiredIfNeeded(conn, gs)
}

func (s *Server) handleAction(conn *websocket.Conn, payload interface{}) {
	gs := s.getGameForConn(conn)
	if gs == nil {
		s.sendError(conn, "No game found")
		return
	}

	ap, err := parsePayload[ActionPayload](payload)
	if err != nil {
		s.sendError(conn, "Invalid action payload")
		return
	}

	// Create action
	action := game.Action{
		Type:      ParseActionType(ap.Action),
		Amount:    ap.Amount,
		PlayerIdx: ap.PlayerIdx,
	}

	// Process action
	if err := gs.ProcessAction(action); err != nil {
		s.sendError(conn, err.Error())
		return
	}

	log.Printf("Player %d: %s %d", ap.PlayerIdx, ap.Action, ap.Amount)

	// Check if betting round is complete
	if gs.NeedToAdvanceStreet() {
		if err := gs.AdvanceStreet(); err != nil {
			s.sendError(conn, err.Error())
			return
		}

		// Send street change notification
		s.send(conn, ServerMessage{
			Type: MsgStreetChange,
			Payload: map[string]interface{}{
				"street": gs.Street.String(),
			},
		})
	}

	// Check if hand is complete
	if gs.IsHandComplete() {
		gs.EliminateBrokePlayers()

		s.send(conn, ServerMessage{
			Type: MsgHandComplete,
			Payload: HandCompletePayload{
				Winners:    convertWinners(gs.Winners),
				HandNumber: gs.HandNumber,
			},
		})
	}

	// Send updated state
	s.sendGameState(conn, gs)

	// Send action required if still waiting
	if !gs.IsHandComplete() {
		s.sendActionRequiredIfNeeded(conn, gs)
	}
}

func (s *Server) handleGetState(conn *websocket.Conn) {
	gs := s.getGameForConn(conn)
	if gs == nil {
		s.sendError(conn, "No game found")
		return
	}

	s.sendGameState(conn, gs)
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
