// Orchestrates LLM turns: runs the shot clock, calls client/llm.go to get decisions,
// and sends updates to the frontend. Called by game_handlers.go after human actions.
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
		// Wait if paused (don't exit - we'll continue when resumed)
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

		validActions := s.buildLLMValidActions(gs)

		payload := gs.GetLLMPromptPayload(playerName, validActions)
		if payload == nil {
			log.Printf("Failed to build LLM payload for %s", playerName)
			s.sendError(conn, "Failed to build LLM payload")
			return
		}

		// Call LLM API and run shot clock concurrently
		type apiResult struct {
			decision *client.LLMDecisionResponse
			err      error
		}
		apiChan := make(chan apiResult, 1)

		go func() {
			decision, err := client.GetLLMDecision(playerName, payload)
			apiChan <- apiResult{decision, err}
		}()

		// Run shot clock from 30 down to 0, waiting for minimum 15 seconds
		var decision *client.LLMDecisionResponse
		apiReady := false
		startTime := time.Now()

		for secondsLeft := ShotClockSeconds; secondsLeft >= 0; secondsLeft-- {
			// Check if paused
			for s.isPaused(gs.ID) {
				time.Sleep(100 * time.Millisecond)
			}

			// Send shot clock update
			s.send(conn, ServerMessage{
				Type: MsgShotClock,
				Payload: ShotClockPayload{
					PlayerIdx:   playerIdx,
					PlayerName:  playerName,
					SecondsLeft: secondsLeft,
				},
			})

			// TODO: refactor this later
			if !apiReady {
				select {
				case result := <-apiChan:
					if result.err != nil {
						log.Printf("❌ LLM ERROR for %s: %v", playerName, result.err)
						decision = &client.LLMDecisionResponse{
							Action: "FOLD",
							Amount: 0,
							Reason: "LLM service error, auto-fold",
						}
					} else {
						decision = result.decision
					}
					apiReady = true
					apiDuration := time.Since(startTime)

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

					// Send reasoning immediately to frontend (action still hidden)
					s.send(conn, ServerMessage{
						Type: MsgLLMThinking,
						Payload: LLMThinkingPayload{
							PlayerIdx:  playerIdx,
							PlayerName: playerName,
							Reason:     decision.Reason,
						},
					})
				default:
					// API not ready yet
				}
			}

			// If API is ready AND we've waited at least MinActionDelay, we can proceed
			elapsed := time.Since(startTime)
			if apiReady && elapsed >= time.Duration(MinActionDelay)*time.Second {
				log.Printf("⏰ Delay complete, revealing action...")
				break
			}

			// If clock hits 0 and API still not ready, wait for it
			if secondsLeft == 0 && !apiReady {
				log.Printf("Shot clock expired, waiting for API...")
				result := <-apiChan
				if result.err != nil {
					decision = &client.LLMDecisionResponse{
						Action: "FOLD",
						Amount: 0,
						Reason: "LLM timeout, auto-fold",
					}
				} else {
					decision = result.decision
				}
				break
			}

			time.Sleep(1 * time.Second)
		}

		// Clear shot clock
		s.send(conn, ServerMessage{
			Type: MsgShotClock,
			Payload: ShotClockPayload{
				PlayerIdx:   playerIdx,
				PlayerName:  playerName,
				SecondsLeft: -1, // Signal to clear
			},
		})

		// Now show the action
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

		s.sendGameState(conn, gs)

		// Check if pause was requested - activate it now (after action completed)
		if s.activatePendingPause(gs.ID) {
			log.Printf("Game %s paused (pending pause activated)", gs.ID)
			s.send(conn, ServerMessage{Type: MsgPaused})
			// Don't return - we'll wait in the pause loop at the top of the next iteration
		}

		time.Sleep(500 * time.Millisecond)
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
