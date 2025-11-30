// Handles game actions from the frontend: new_game, start_hand, action, pause, resume.
// Called by server.go when it receives these message types.
package api

import (
	"log"

	"github.com/gorilla/websocket"
	"github.com/rizzwareengineer/no-LLMit/engine/game"
)

func (s *Server) handleNewGame(conn *websocket.Conn, payload interface{}) {
	ngp, err := parsePayload[NewGamePayload](payload)
	if err != nil {
		s.sendError(conn, "Invalid new game payload")
		return
	}

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

	s.send(conn, ServerMessage{
		Type: MsgHandStart,
		Payload: map[string]interface{}{
			"handNumber": gs.HandNumber,
		},
	})

	s.sendGameState(conn, gs)

	go s.handleLLMTurns(conn, gs)
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

	action := game.Action{
		Type:      ParseActionType(ap.Action),
		Amount:    ap.Amount,
		PlayerIdx: ap.PlayerIdx,
	}

	if err := gs.ProcessAction(action); err != nil {
		s.sendError(conn, err.Error())
		return
	}

	log.Printf("Player %d: %s %d", ap.PlayerIdx, ap.Action, ap.Amount)

	if gs.NeedToAdvanceStreet() {
		if err := gs.AdvanceStreet(); err != nil {
			s.sendError(conn, err.Error())
			return
		}

		s.send(conn, ServerMessage{
			Type: MsgStreetChange,
			Payload: map[string]interface{}{
				"street": gs.Street.String(),
			},
		})
	}

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

	s.sendGameState(conn, gs)

	if !gs.IsHandComplete() {
		go s.handleLLMTurns(conn, gs)
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

func (s *Server) handlePause(conn *websocket.Conn) {
	gs := s.getGameForConn(conn)
	if gs == nil {
		s.sendError(conn, "No game found")
		return
	}

	// Set pending pause - will take effect after current action completes
	s.mu.Lock()
	s.pendingPause[gs.ID] = true
	s.mu.Unlock()

	log.Printf("Game %s pause requested (will pause after current action)", gs.ID)
	// Don't send MsgPaused yet - it will be sent when pause actually activates
}

func (s *Server) handleResume(conn *websocket.Conn) {
	gs := s.getGameForConn(conn)
	if gs == nil {
		s.sendError(conn, "No game found")
		return
	}

	s.mu.Lock()
	s.paused[gs.ID] = false
	s.pendingPause[gs.ID] = false // Clear any pending pause too
	s.mu.Unlock()

	log.Printf("Game %s resumed", gs.ID)
	s.send(conn, ServerMessage{Type: MsgResumed})

	// Don't start a new goroutine here - the existing one waiting in the
	// pause loop (llm_handlers.go line 24-26) will continue automatically
}
