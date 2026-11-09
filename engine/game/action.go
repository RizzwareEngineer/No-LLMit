// This file handles all betting logic. When a player needs to act, GetValidActions tells them
// what they can do (fold, check, call, raise, all-in). When they choose, ProcessAction validates
// and executes it. Called by api/table.go for each model's move.
package game

import "fmt"

type ValidAction struct {
	Type      ActionType `json:"type"`
	MinAmount int        `json:"minAmount,omitempty"` // For raise
	MaxAmount int        `json:"maxAmount,omitempty"` // For raise (player's stack)
}

func (gs *GameState) GetValidActions() []ValidAction {
	if gs.CurrentPlayerIdx < 0 || gs.CurrentPlayerIdx >= len(gs.Players) {
		return nil
	}

	player := &gs.Players[gs.CurrentPlayerIdx]
	if player.Status != PlayerActive {
		return nil
	}

	if player.Stack == 0 {
		return nil
	}

	var actions []ValidAction
	actions = append(actions, ValidAction{Type: ActionFold})

	amountToCall := gs.CurrentBet - player.CurrentBet

	if amountToCall == 0 {
		actions = append(actions, ValidAction{Type: ActionCheck})
	} else if amountToCall > 0 && amountToCall < player.Stack {
		actions = append(actions, ValidAction{Type: ActionCall, MinAmount: amountToCall})
	}
	// A raise needs an opponent who can respond. With everyone else in the hand all-in,
	// the actor can only call (all-in when covered) or fold.
	canRespond := false
	for i := range gs.Players {
		if p := &gs.Players[i]; i != gs.CurrentPlayerIdx && p.Status == PlayerActive && p.Stack > 0 {
			canRespond = true
		}
	}
	minRaiseTotal := gs.CurrentBet + gs.MinRaise
	if canRespond && player.Stack > amountToCall && !player.RaiseClosed {
		if player.Stack >= minRaiseTotal-player.CurrentBet {
			actions = append(actions, ValidAction{
				Type:      ActionRaise,
				MinAmount: minRaiseTotal,
				MaxAmount: player.Stack + player.CurrentBet, // All-in raise
			})
		}
	}

	if player.Stack > 0 && ((canRespond && !player.RaiseClosed) || player.Stack <= amountToCall) {
		actions = append(actions, ValidAction{
			Type:      ActionAllIn,
			MinAmount: player.Stack + player.CurrentBet,
			MaxAmount: player.Stack + player.CurrentBet,
		})
	}

	return actions
}

func (gs *GameState) ProcessAction(action Action) error {
	if gs.CurrentPlayerIdx != action.PlayerIdx {
		return fmt.Errorf("not player %d's turn, current player is %d", action.PlayerIdx, gs.CurrentPlayerIdx)
	}

	player := &gs.Players[gs.CurrentPlayerIdx]
	if player.Status != PlayerActive && player.Status != PlayerAllIn {
		return fmt.Errorf("player %d cannot act (status: %s)", action.PlayerIdx, player.Status)
	}

	var err error
	switch action.Type {
	case ActionFold:
		err = gs.processFold(player, action)
	case ActionCheck:
		err = gs.processCheck(player, action)
	case ActionCall:
		err = gs.processCall(player, action)
	case ActionRaise:
		err = gs.processRaise(player, action)
	case ActionAllIn:
		err = gs.processAllIn(player, action)
	default:
		return fmt.Errorf("unknown action type: %d", action.Type)
	}

	if err != nil {
		return err
	}

	// Record what actually happened (a short call or raise can become an all-in),
	// with the amount the engine applied rather than the one the caller sent.
	applied := player.LastAction
	amount := applied.Amount
	if applied.Type == ActionFold || applied.Type == ActionCheck {
		amount = 0
	}
	gs.RecordActionForLLMs(player.Name, applied.Type.String(), amount)

	return nil
}

// CheckAction reports whether ProcessAction would accept the action, without changing the game.
func (gs *GameState) CheckAction(action Action) error {
	trial := *gs
	trial.Players = append([]Player(nil), gs.Players...)
	trial.LLMActionsThisHand = nil
	return trial.ProcessAction(action)
}

func (gs *GameState) processFold(player *Player, action Action) error {
	player.Status = PlayerFolded
	player.LastAction = &action
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
	gs.advanceToNextPlayer()
	return nil
}

func (gs *GameState) processRaise(player *Player, action Action) error {
	// action.Amount is the TOTAL bet amount
	raiseToAmount := action.Amount
	raiseAmount := raiseToAmount - gs.CurrentBet
	totalNeeded := raiseToAmount - player.CurrentBet

	if player.RaiseClosed {
		return fmt.Errorf("an all-in for less than a full raise does not reopen raising; call or fold")
	}

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
	gs.MinRaise = raiseAmount
	gs.CurrentBet = raiseToAmount
	gs.reopenRaising()
	gs.resetActedExcept(action.PlayerIdx)
	gs.advanceToNextPlayer()
	return nil
}

func (gs *GameState) processAllIn(player *Player, action Action) error {
	allInAmount := player.Stack
	totalBet := player.CurrentBet + allInAmount
	if player.RaiseClosed && totalBet > gs.CurrentBet {
		return fmt.Errorf("an all-in for less than a full raise does not reopen raising; call or fold")
	}

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
			gs.reopenRaising()
		} else {
			// Incomplete raise: players who already acted may only call or fold (TDA).
			for i := range gs.Players {
				p := &gs.Players[i]
				if i != action.PlayerIdx && p.Status == PlayerActive && p.HasActedThisRound {
					p.RaiseClosed = true
				}
			}
		}
		gs.CurrentBet = totalBet
		gs.resetActedExcept(action.PlayerIdx)
	}

	gs.advanceToNextPlayer()
	return nil
}

// reopenRaising lets everyone raise again after a full raise.
func (gs *GameState) reopenRaising() {
	for i := range gs.Players {
		gs.Players[i].RaiseClosed = false
	}
}

func (gs *GameState) resetActedExcept(playerIdx int) {
	for i := range gs.Players {
		if i != playerIdx && gs.Players[i].Status == PlayerActive {
			gs.Players[i].HasActedThisRound = false
		}
	}
}

func (gs *GameState) advanceToNextPlayer() {
	if gs.IsBettingRoundComplete() {
		gs.CurrentPlayerIdx = -1
		return
	}

	startIdx := gs.CurrentPlayerIdx
	for {
		gs.CurrentPlayerIdx = (gs.CurrentPlayerIdx + 1) % len(gs.Players)
		player := &gs.Players[gs.CurrentPlayerIdx]

		if player.Status == PlayerActive && !player.HasActedThisRound {
			return
		}
		if player.Status == PlayerActive && player.CurrentBet < gs.CurrentBet {
			return
		}

		if gs.CurrentPlayerIdx == startIdx {
			gs.CurrentPlayerIdx = -1
			return
		}
	}
}

func (gs *GameState) IsBettingRoundComplete() bool {
	playersToAct := 0
	playersInHand := 0

	for i := range gs.Players {
		player := &gs.Players[i]
		if player.Status == PlayerActive || player.Status == PlayerAllIn {
			playersInHand++
		}
		if player.Status == PlayerActive && (!player.HasActedThisRound || player.CurrentBet < gs.CurrentBet) {
			playersToAct++
		}
	}

	return playersInHand <= 1 || playersToAct == 0
}

func (gs *GameState) CountActivePlayers() int {
	count := 0
	for _, p := range gs.Players {
		if p.Status == PlayerActive || p.Status == PlayerAllIn {
			count++
		}
	}
	return count
}

func (gs *GameState) CountActiveNonAllInPlayers() int {
	count := 0
	for _, p := range gs.Players {
		if p.Status == PlayerActive {
			count++
		}
	}
	return count
}

func (gs *GameState) ResetBettingRound() {
	for i := range gs.Players {
		gs.Players[i].CurrentBet = 0
		gs.Players[i].HasActedThisRound = false
		gs.Players[i].RaiseClosed = false
	}
	gs.CurrentBet = 0
	gs.MinRaise = gs.Stakes.BigBlind
}

func (gs *GameState) GetFirstToAct() int {
	if gs.Street == StreetPreflop {
		// Preflop: UTG (left of BB) acts first
		sbIdx := gs.getNextActivePlayer(gs.ButtonIdx)
		bbIdx := gs.getNextActivePlayer(sbIdx)
		utgIdx := gs.getNextActivePlayer(bbIdx)

		for i := 0; i < len(gs.Players); i++ {
			idx := (utgIdx + i) % len(gs.Players)
			if gs.Players[idx].Status == PlayerActive {
				return idx
			}
			if idx == bbIdx {
				if gs.Players[bbIdx].Status == PlayerActive {
					return bbIdx
				}
				break
			}
		}
		return -1
	}

	// Postflop: first active player left of button acts first
	startIdx := (gs.ButtonIdx + 1) % len(gs.Players)
	for i := 0; i < len(gs.Players); i++ {
		idx := (startIdx + i) % len(gs.Players)
		if gs.Players[idx].Status == PlayerActive {
			return idx
		}
	}

	return -1
}
