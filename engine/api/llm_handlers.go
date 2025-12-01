// Orchestrates LLM turns: calls client/llm.go to get decisions and sends results
// immediately to frontend. Frontend handles all display timing.
// Called by game_handlers.go after human actions.
package api

import (
	"fmt"
	"log"
	"time"

	"github.com/gorilla/websocket"
	"github.com/rizzwareengineer/no-LLMit/engine/client"
	"github.com/rizzwareengineer/no-LLMit/engine/game"
)

func (s *Server) handleLLMTurns(conn *websocket.Conn, gs *game.GameState) {
	if err := client.CheckLLMServiceHealth(); err != nil {
		log.Printf("!!! LLM service not available: %v", err)
		s.sendError(conn, "LLM service not available. Please start the Python service (cd llm && python app.py)")
		return
	}

	for !gs.IsHandComplete() && gs.IsWaitingForAction() {
		// Wait if paused
		for s.isPaused(gs.ID) {
			time.Sleep(100 * time.Millisecond)
		}

		// In play mode, stop if it's the human's turn
		if gs.Mode == game.ModePlay && gs.CurrentPlayerIdx == gs.UserSeatIdx {
			s.sendActionRequiredIfNeeded(conn, gs)
			return
		}

		// In test mode, human controls all players
		if gs.Mode == game.ModeTest {
			s.sendActionRequiredIfNeeded(conn, gs)
			return
		}

		player := gs.GetCurrentPlayer()
		if player == nil {
			return
		}

		playerIdx := gs.CurrentPlayerIdx
		playerName := player.Name

		log.Printf("")
		log.Printf("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
		log.Printf("🎯 Requesting decision from: %s", playerName)

		// Notify frontend that this player is now deciding
		s.send(conn, ServerMessage{
			Type: MsgLLMThinking,
			Payload: LLMThinkingPayload{
				PlayerIdx:  playerIdx,
				PlayerName: playerName,
				// No reason yet - frontend will show "Thinking..."
			},
		})

		validActions := s.buildLLMValidActions(gs)
		payload := gs.GetLLMPromptPayload(playerName, validActions)
		if payload == nil {
			log.Printf("Failed to build LLM payload for %s", playerName)
			s.sendError(conn, "Failed to build LLM payload")
			return
		}

		// Call LLM API (blocking - compute as fast as possible)
		startTime := time.Now()
		modeStr := gs.Mode.String()
		decision, err := client.GetLLMDecision(playerName, payload, modeStr)
		apiDuration := time.Since(startTime)

		if err != nil {
			log.Printf("❌ LLM ERROR for %s: %v", playerName, err)
			decision = &client.LLMDecisionResponse{
				Action: "FOLD",
				Amount: 0,
				Reason: "LLM service error, auto-fold",
			}
		}

		actionEmoji := map[string]string{
			"FOLD": "🚫", "CHECK": "✋", "CALL": "📞",
			"RAISE": "📈", "BET": "💰", "ALL_IN": "🔥",
		}[decision.Action]
		if actionEmoji == "" {
			actionEmoji = "❓"
		}

		log.Printf("%s %s: %s", actionEmoji, playerName, decision.Action)
		if decision.Amount > 0 {
			log.Printf("   Amount: ¤%d", decision.Amount)
		}
		log.Printf("   Reason: %s", decision.Reason)
		log.Printf("   ⏱️  %dms", apiDuration.Milliseconds())
		log.Printf("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")

		// Send complete decision to frontend (action + reasoning together)
		// Frontend will handle timing for display
		s.send(conn, ServerMessage{
			Type: MsgLLMAction,
			Payload: LLMActionPayload{
				PlayerIdx:  playerIdx,
				PlayerName: playerName,
				Action:     decision.Action,
				Amount:     decision.Amount,
				Reason:     decision.Reason,
			},
		})

		// Process action immediately (compute ahead)
		action := game.Action{
			Type:      ParseActionType(decision.Action),
			Amount:    decision.Amount,
			PlayerIdx: playerIdx,
		}

		if err := gs.ProcessAction(action); err != nil {
			log.Printf("Error processing LLM action: %v", err)
			action.Type = game.ActionFold
			action.Amount = 0
			gs.ProcessAction(action)
		}

		if gs.NeedToAdvanceStreet() {
			if err := gs.AdvanceStreet(); err != nil {
				log.Printf("Error advancing street: %v", err)
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

		// Send updated game state
		s.sendGameState(conn, gs)

		// Check if pause was requested
		if s.activatePendingPause(gs.ID) {
			log.Printf("Game %s paused (pending pause activated)", gs.ID)
			s.send(conn, ServerMessage{Type: MsgPaused})
		}

		// No delay here - continue to next player immediately
		// Frontend handles all display timing
	}
}

// buildLLMValidActions converts game valid actions to LLM-friendly format
func (s *Server) buildLLMValidActions(gs *game.GameState) []game.LLMValidAction {
	validActions := gs.GetValidActions()
	var llmActions []game.LLMValidAction

	for _, va := range validActions {
		actionType := va.Type.String()

		if va.Type == game.ActionRaise {
			if gs.CurrentBet == 0 {
				actionType = "BET"
			} else {
				actionType = "RAISE"
			}
		}

		llmAction := game.LLMValidAction{
			Type: actionType,
		}
		if va.Type == game.ActionCall {
			llmAction.Amount = va.MinAmount
			llmAction.Description = fmt.Sprintf("match the current bet of %d", va.MinAmount)
		} else if va.Type == game.ActionRaise {
			llmAction.Min = va.MinAmount
			llmAction.Max = va.MaxAmount
			llmAction.Description = fmt.Sprintf("choose ANY amount between %d and %d", va.MinAmount, va.MaxAmount)
		} else if va.Type == game.ActionAllIn {
			llmAction.Amount = va.MaxAmount
			llmAction.Description = fmt.Sprintf("put all %d chips in", va.MaxAmount)
		} else if va.Type == game.ActionFold {
			llmAction.Description = "give up your hand"
		} else if va.Type == game.ActionCheck {
			llmAction.Description = "pass without betting"
		}
		llmActions = append(llmActions, llmAction)
	}

	return llmActions
}
