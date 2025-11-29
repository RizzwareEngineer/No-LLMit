package game

import "fmt"

// ValidAction represents an action the current player can take
type ValidAction struct {
	Type      ActionType `json:"type"`
	MinAmount int        `json:"minAmount,omitempty"` // For raise
	MaxAmount int        `json:"maxAmount,omitempty"` // For raise (player's stack)
}

// GetValidActions returns the valid actions for the current player
func (gs *GameState) GetValidActions() []ValidAction {
	if gs.CurrentPlayerIdx < 0 || gs.CurrentPlayerIdx >= len(gs.Players) {
		return nil
	}

	player := &gs.Players[gs.CurrentPlayerIdx]
	if player.Status != PlayerActive {
		return nil
	}

	// Player with no chips can't take any action
	if player.Stack == 0 {
		return nil
	}

	var actions []ValidAction

	// Can always fold (unless no bet to call)
	actions = append(actions, ValidAction{Type: ActionFold})

	amountToCall := gs.CurrentBet - player.CurrentBet

	if amountToCall == 0 {
		// Can check
		actions = append(actions, ValidAction{Type: ActionCheck})
	} else if amountToCall > 0 && amountToCall < player.Stack {
		// Can call
		actions = append(actions, ValidAction{Type: ActionCall, MinAmount: amountToCall})
	}

	// Can raise if we have more than the call amount
	minRaiseTotal := gs.CurrentBet + gs.MinRaise
	if player.Stack > amountToCall {
		if player.Stack >= minRaiseTotal-player.CurrentBet {
			actions = append(actions, ValidAction{
				Type:      ActionRaise,
				MinAmount: minRaiseTotal,
				MaxAmount: player.Stack + player.CurrentBet, // All-in raise
			})
		}
	}

	// Can always go all-in
	if player.Stack > 0 {
		actions = append(actions, ValidAction{
			Type:      ActionAllIn,
			MinAmount: player.Stack + player.CurrentBet,
			MaxAmount: player.Stack + player.CurrentBet,
		})
	}

	return actions
}

// ProcessAction processes a player's action and updates game state
func (gs *GameState) ProcessAction(action Action) error {
	if gs.CurrentPlayerIdx != action.PlayerIdx {
		return fmt.Errorf("not player %d's turn, current player is %d", action.PlayerIdx, gs.CurrentPlayerIdx)
	}

	player := &gs.Players[gs.CurrentPlayerIdx]
	if player.Status != PlayerActive && player.Status != PlayerAllIn {
		return fmt.Errorf("player %d cannot act (status: %s)", action.PlayerIdx, player.Status)
	}

	switch action.Type {
	case ActionFold:
		return gs.processFold(player, action)
	case ActionCheck:
		return gs.processCheck(player, action)
	case ActionCall:
		return gs.processCall(player, action)
	case ActionRaise:
		return gs.processRaise(player, action)
	case ActionAllIn:
		return gs.processAllIn(player, action)
	default:
		return fmt.Errorf("unknown action type: %d", action.Type)
	}
}

func (gs *GameState) processFold(player *Player, action Action) error {
	player.Status = PlayerFolded
	player.LastAction = &action
	gs.actionsThisRound++
	gs.advanceToNextPlayer()
	return nil
}

func (gs *GameState) processCheck(player *Player, action Action) error {
	amountToCall := gs.CurrentBet - player.CurrentBet
	if amountToCall > 0 {
		return fmt.Errorf("cannot check, must call %d", amountToCall)
	}

	player.HasActedThisRound = true
	player.LastAction = &action
	gs.actionsThisRound++
	gs.advanceToNextPlayer()
	return nil
}

func (gs *GameState) processCall(player *Player, action Action) error {
	amountToCall := gs.CurrentBet - player.CurrentBet
	if amountToCall <= 0 {
		return fmt.Errorf("nothing to call, use check")
	}

	// If call amount is more than stack, it's an all-in call
	if amountToCall >= player.Stack {
		return gs.processAllIn(player, Action{Type: ActionAllIn, PlayerIdx: action.PlayerIdx})
	}

	player.Stack -= amountToCall
	player.CurrentBet = gs.CurrentBet
	player.TotalBetThisHand += amountToCall
	player.HasActedThisRound = true
	player.LastAction = &Action{Type: ActionCall, Amount: amountToCall, PlayerIdx: action.PlayerIdx}
	gs.actionsThisRound++
	gs.advanceToNextPlayer()
	return nil
}

func (gs *GameState) processRaise(player *Player, action Action) error {
	// action.Amount is the TOTAL bet amount
	raiseToAmount := action.Amount
	raiseAmount := raiseToAmount - gs.CurrentBet
	totalNeeded := raiseToAmount - player.CurrentBet

	// Validate minimum raise
	if raiseAmount < gs.MinRaise && totalNeeded < player.Stack {
		return fmt.Errorf("raise must be at least %d (minimum raise), you raised %d", gs.MinRaise, raiseAmount)
	}

	// Check if player has enough chips
	if totalNeeded > player.Stack {
		return fmt.Errorf("not enough chips: need %d, have %d", totalNeeded, player.Stack)
	}

	// If raise amount equals stack, it's an all-in
	if totalNeeded == player.Stack {
		return gs.processAllIn(player, Action{Type: ActionAllIn, PlayerIdx: action.PlayerIdx, Amount: player.Stack + player.CurrentBet})
	}

	player.Stack -= totalNeeded
	player.CurrentBet = raiseToAmount
	player.TotalBetThisHand += totalNeeded
	player.HasActedThisRound = true
	player.LastAction = &Action{Type: ActionRaise, Amount: raiseToAmount, PlayerIdx: action.PlayerIdx}

	// Update game state
	gs.LastRaiseAmount = raiseAmount
	gs.MinRaise = raiseAmount
	gs.CurrentBet = raiseToAmount
	gs.actionsThisRound++

	// Reset other players' acted status (they need to respond to raise)
	for i := range gs.Players {
		if i != action.PlayerIdx && gs.Players[i].Status == PlayerActive {
			gs.Players[i].HasActedThisRound = false
		}
	}

	gs.advanceToNextPlayer()
	return nil
}

func (gs *GameState) processAllIn(player *Player, action Action) error {
	allInAmount := player.Stack
	totalBet := player.CurrentBet + allInAmount

	player.Stack = 0
	player.CurrentBet = totalBet
	player.TotalBetThisHand += allInAmount
	player.Status = PlayerAllIn
	player.HasActedThisRound = true
	player.LastAction = &Action{Type: ActionAllIn, Amount: totalBet, PlayerIdx: action.PlayerIdx}

	// If this is a raise (totalBet > CurrentBet), update betting
	if totalBet > gs.CurrentBet {
		raiseAmount := totalBet - gs.CurrentBet
		if raiseAmount >= gs.MinRaise {
			gs.MinRaise = raiseAmount
			gs.LastRaiseAmount = raiseAmount
		}
		gs.CurrentBet = totalBet

		// Reset other players' acted status
		for i := range gs.Players {
			if i != action.PlayerIdx && gs.Players[i].Status == PlayerActive {
				gs.Players[i].HasActedThisRound = false
			}
		}
	}

	gs.actionsThisRound++
	gs.advanceToNextPlayer()
	return nil
}

// advanceToNextPlayer moves to the next active player
func (gs *GameState) advanceToNextPlayer() {
	// Check if betting round is complete
	if gs.IsBettingRoundComplete() {
		gs.CurrentPlayerIdx = -1 // No current player
		return
	}

	// Find next active player who hasn't matched the bet
	startIdx := gs.CurrentPlayerIdx
	for {
		gs.CurrentPlayerIdx = (gs.CurrentPlayerIdx + 1) % len(gs.Players)
		player := &gs.Players[gs.CurrentPlayerIdx]

		// Skip folded, all-in, and eliminated players
		if player.Status == PlayerActive && !player.HasActedThisRound {
			return
		}
		if player.Status == PlayerActive && player.CurrentBet < gs.CurrentBet {
			return
		}

		// Prevent infinite loop
		if gs.CurrentPlayerIdx == startIdx {
			gs.CurrentPlayerIdx = -1
			return
		}
	}
}

// IsBettingRoundComplete checks if the betting round is complete
func (gs *GameState) IsBettingRoundComplete() bool {
	activePlayers := 0
	playersToAct := 0
	playersInHand := 0 // Active + AllIn (not folded)

	for i := range gs.Players {
		player := &gs.Players[i]
		if player.Status == PlayerActive || player.Status == PlayerAllIn {
			playersInHand++
		}
		if player.Status == PlayerActive {
			activePlayers++
			// Player needs to act if they haven't acted or haven't matched the bet
			if !player.HasActedThisRound || player.CurrentBet < gs.CurrentBet {
				playersToAct++
			}
		}
	}

	// If only one player remains in the hand (everyone else folded), betting is complete
	// This handles the case where everyone folds - last player wins without acting
	if playersInHand <= 1 {
		return true
	}

	// If any active player still needs to act (call, fold, or hasn't acted), betting continues
	if playersToAct > 0 {
		return false
	}

	// Betting is complete if:
	// 1. All active players have acted and matched the current bet
	// 2. No active players remain who need to act (everyone is all-in or matched)
	return true
}

// CountActivePlayers returns the number of players still in the hand
func (gs *GameState) CountActivePlayers() int {
	count := 0
	for _, p := range gs.Players {
		if p.Status == PlayerActive || p.Status == PlayerAllIn {
			count++
		}
	}
	return count
}

// CountActiveNonAllInPlayers returns players who can still bet
func (gs *GameState) CountActiveNonAllInPlayers() int {
	count := 0
	for _, p := range gs.Players {
		if p.Status == PlayerActive {
			count++
		}
	}
	return count
}

// ResetBettingRound resets state for a new betting round
func (gs *GameState) ResetBettingRound() {
	for i := range gs.Players {
		gs.Players[i].CurrentBet = 0
		gs.Players[i].HasActedThisRound = false
	}
	gs.CurrentBet = 0
	gs.MinRaise = gs.Stakes.BigBlind
	gs.LastRaiseAmount = gs.Stakes.BigBlind
	gs.actionsThisRound = 0
}

// GetFirstToAct returns the index of the first player to act for the current street
func (gs *GameState) GetFirstToAct() int {
	if gs.Street == StreetPreflop {
		// Preflop: action starts left of big blind (UTG)
		// First find the SB (first active player after button)
		sbIdx := gs.getNextActivePlayer(gs.ButtonIdx)
		// Then find BB (first active player after SB)
		bbIdx := gs.getNextActivePlayer(sbIdx)
		// UTG is the first active player after BB
		utgIdx := gs.getNextActivePlayer(bbIdx)

		// Make sure UTG can actually act (is Active, not AllIn)
		for i := 0; i < len(gs.Players); i++ {
			idx := (utgIdx + i) % len(gs.Players)
			if gs.Players[idx].Status == PlayerActive {
				return idx
			}
			// Wrapped around back to BB, so BB acts (everyone else is all-in or folded)
			if idx == bbIdx {
				if gs.Players[bbIdx].Status == PlayerActive {
					return bbIdx
				}
				break
			}
		}
		return -1
	}

	// Postflop: action starts left of button
	startIdx := (gs.ButtonIdx + 1) % len(gs.Players)

	// Find first active player from that position
	for i := 0; i < len(gs.Players); i++ {
		idx := (startIdx + i) % len(gs.Players)
		if gs.Players[idx].Status == PlayerActive {
			return idx
		}
	}

	return -1
}

