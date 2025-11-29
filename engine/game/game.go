package game

import (
	"fmt"
	"time"
)

// Street represents the current betting round
type Street int

const (
	StreetPreflop Street = iota
	StreetFlop
	StreetTurn
	StreetRiver
	StreetShowdown
	StreetComplete // Hand is done
)

func (s Street) String() string {
	return []string{"preflop", "flop", "turn", "river", "showdown", "complete"}[s]
}

// GameMode represents how the game is being played
type GameMode int

const (
	ModeSimulate GameMode = iota // All LLMs
	ModePlay                     // User plays one seat
	ModeTest                     // User controls all seats (for debugging)
)

func (gm GameMode) String() string {
	return []string{"simulate", "play", "test"}[gm]
}

// Stakes represents the blind structure
type Stakes struct {
	SmallBlind int `json:"smallBlind"`
	BigBlind   int `json:"bigBlind"`
}

// GameConfig holds configuration for a new game
type GameConfig struct {
	PlayerNames   []string `json:"playerNames"`
	StartingStack int      `json:"startingStack"`
	Stakes        Stakes   `json:"stakes"`
	Mode          GameMode `json:"mode"`
	UserSeatIdx   int      `json:"userSeatIdx"` // Only relevant in ModePlay
}

// GameState represents the complete state of a poker game
type GameState struct {
	ID               string    `json:"id"`
	Players          []Player  `json:"players"`
	CommunityCards   []Card    `json:"communityCards"`
	Pots             []Pot     `json:"pots"`
	Street           Street    `json:"street"`
	ButtonIdx        int       `json:"buttonIdx"`
	CurrentPlayerIdx int       `json:"currentPlayerIdx"`
	CurrentBet       int       `json:"currentBet"`      // Current bet to match
	MinRaise         int       `json:"minRaise"`        // Minimum raise amount
	LastRaiseAmount  int       `json:"lastRaiseAmount"` // Size of last raise
	Stakes           Stakes    `json:"stakes"`
	Mode             GameMode  `json:"mode"`
	UserSeatIdx      int       `json:"userSeatIdx"`
	HandNumber       int       `json:"handNumber"`
	Winners          []Winner  `json:"winners,omitempty"`
	GameStartTime    time.Time `json:"gameStartTime"` // When the game was created on server

	// Internal state (not sent to client)
	deck             *Deck `json:"-"`
	actionsThisRound int   `json:"-"`
}

// WinnerFinder is a function type for finding winners (used by AwardPots)
type WinnerFinder func(players []Player, communityCards []Card, eligibleIndices []int) []int

// NewGame creates a new poker game with the given configuration
func NewGame(config GameConfig) *GameState {
	players := make([]Player, len(config.PlayerNames))
	for i, name := range config.PlayerNames {
		players[i] = Player{
			ID:           fmt.Sprintf("%d", i+1),
			Name:         name,
			Stack:        config.StartingStack,
			HoleCards:    []Card{},
			Status:       PlayerActive,
			SeatPosition: i,
		}
	}

	gs := &GameState{
		ID:               generateGameID(),
		Players:          players,
		CommunityCards:   []Card{},
		Pots:             []Pot{},
		Street:           StreetPreflop,
		ButtonIdx:        0, // Will be rotated before first hand
		CurrentPlayerIdx: -1,
		Stakes:           config.Stakes,
		Mode:             config.Mode,
		UserSeatIdx:      config.UserSeatIdx,
		HandNumber:       0,
		GameStartTime:    time.Now(), // Server timestamp for game start
		deck:             NewDeck(),
	}

	return gs
}

// StartHand starts a new hand
func (gs *GameState) StartHand() error {
	// First, eliminate any players with 0 chips from previous hand
	gs.EliminateBrokePlayers()

	// Check we have enough active players
	activeCount := 0
	for _, p := range gs.Players {
		if p.Status != PlayerEliminated && p.Stack > 0 {
			activeCount++
		}
	}
	if activeCount < 2 {
		return fmt.Errorf("not enough players to start hand (need at least 2, have %d)", activeCount)
	}

	// Reset for new hand
	gs.HandNumber++
	gs.deck.Reset()
	gs.CommunityCards = []Card{}
	gs.Winners = nil
	gs.ResetPotsForNewHand()

	// Reset player states
	for i := range gs.Players {
		gs.Players[i].HoleCards = []Card{}
		gs.Players[i].LastAction = nil
		gs.Players[i].HasActedThisRound = false
		if gs.Players[i].Status != PlayerEliminated && gs.Players[i].Stack > 0 {
			gs.Players[i].Status = PlayerActive
		}
	}

	// Rotate button
	gs.rotateButton()

	// Post blinds
	if err := gs.postBlinds(); err != nil {
		return err
	}

	// Deal hole cards
	gs.dealHoleCards()

	// Set first to act (UTG preflop)
	gs.Street = StreetPreflop
	gs.CurrentPlayerIdx = gs.GetFirstToAct()

	return nil
}

// rotateButton moves the button to the next active player
func (gs *GameState) rotateButton() {
	for i := 1; i <= len(gs.Players); i++ {
		idx := (gs.ButtonIdx + i) % len(gs.Players)
		if gs.Players[idx].Status != PlayerEliminated && gs.Players[idx].Stack > 0 {
			gs.ButtonIdx = idx
			return
		}
	}
}

// postBlinds posts small and big blinds
func (gs *GameState) postBlinds() error {
	// Small blind is left of button
	sbIdx := gs.getNextActivePlayer(gs.ButtonIdx)
	// Big blind is left of small blind
	bbIdx := gs.getNextActivePlayer(sbIdx)

	// Post small blind
	sbPlayer := &gs.Players[sbIdx]
	sbAmount := min(gs.Stakes.SmallBlind, sbPlayer.Stack)
	sbPlayer.Stack -= sbAmount
	sbPlayer.CurrentBet = sbAmount
	sbPlayer.TotalBetThisHand = sbAmount
	if sbPlayer.Stack == 0 {
		sbPlayer.Status = PlayerAllIn
	}

	// Post big blind
	bbPlayer := &gs.Players[bbIdx]
	bbAmount := min(gs.Stakes.BigBlind, bbPlayer.Stack)
	bbPlayer.Stack -= bbAmount
	bbPlayer.CurrentBet = bbAmount
	bbPlayer.TotalBetThisHand = bbAmount
	if bbPlayer.Stack == 0 {
		bbPlayer.Status = PlayerAllIn
	}

	gs.CurrentBet = gs.Stakes.BigBlind
	gs.MinRaise = gs.Stakes.BigBlind
	gs.LastRaiseAmount = gs.Stakes.BigBlind

	return nil
}

// getNextActivePlayer gets the next player who can act (not eliminated, has chips)
func (gs *GameState) getNextActivePlayer(fromIdx int) int {
	for i := 1; i <= len(gs.Players); i++ {
		idx := (fromIdx + i) % len(gs.Players)
		if gs.Players[idx].Status != PlayerEliminated && gs.Players[idx].Stack > 0 {
			return idx
		}
		// Also include all-in players for blind posting purposes
		if gs.Players[idx].Status == PlayerAllIn {
			return idx
		}
	}
	return -1
}

// dealHoleCards deals 2 cards to each active player
func (gs *GameState) dealHoleCards() {
	// Deal cards starting left of button
	startIdx := (gs.ButtonIdx + 1) % len(gs.Players)

	// First card to each player
	for i := 0; i < len(gs.Players); i++ {
		idx := (startIdx + i) % len(gs.Players)
		if gs.Players[idx].Status != PlayerEliminated {
			gs.Players[idx].HoleCards = append(gs.Players[idx].HoleCards, gs.deck.Deal(1)[0])
		}
	}

	// Second card to each player
	for i := 0; i < len(gs.Players); i++ {
		idx := (startIdx + i) % len(gs.Players)
		if gs.Players[idx].Status != PlayerEliminated {
			gs.Players[idx].HoleCards = append(gs.Players[idx].HoleCards, gs.deck.Deal(1)[0])
		}
	}
}

// AdvanceStreet moves to the next street (flop, turn, river, showdown)
func (gs *GameState) AdvanceStreet() error {
	// Collect bets from this round
	gs.CollectBetsIntoPot()

	// Check if only one player remains
	if gs.CountActivePlayers() == 1 {
		return gs.finishHandOnePlayerRemains()
	}

	// Check if all remaining players are all-in
	if gs.CountActiveNonAllInPlayers() <= 1 {
		// Run out remaining cards and go to showdown
		return gs.runOutBoard()
	}

	switch gs.Street {
	case StreetPreflop:
		gs.Street = StreetFlop
		gs.dealFlop()
	case StreetFlop:
		gs.Street = StreetTurn
		gs.dealTurn()
	case StreetTurn:
		gs.Street = StreetRiver
		gs.dealRiver()
	case StreetRiver:
		gs.Street = StreetShowdown
		return gs.resolveShowdown()
	case StreetShowdown:
		gs.Street = StreetComplete
		return nil
	}

	// Reset for new betting round
	gs.ResetBettingRound()
	gs.CurrentPlayerIdx = gs.GetFirstToAct()

	return nil
}

// dealFlop deals the flop (3 community cards)
func (gs *GameState) dealFlop() {
	gs.deck.Burn()
	gs.CommunityCards = append(gs.CommunityCards, gs.deck.Deal(3)...)
}

// dealTurn deals the turn (1 community card)
func (gs *GameState) dealTurn() {
	gs.deck.Burn()
	gs.CommunityCards = append(gs.CommunityCards, gs.deck.Deal(1)[0])
}

// dealRiver deals the river (1 community card)
func (gs *GameState) dealRiver() {
	gs.deck.Burn()
	gs.CommunityCards = append(gs.CommunityCards, gs.deck.Deal(1)[0])
}

// runOutBoard deals remaining community cards when all players are all-in
func (gs *GameState) runOutBoard() error {
	for len(gs.CommunityCards) < 5 {
		gs.deck.Burn()
		gs.CommunityCards = append(gs.CommunityCards, gs.deck.Deal(1)[0])
	}
	gs.Street = StreetShowdown
	return gs.resolveShowdown()
}

// finishHandOnePlayerRemains ends the hand when only one player is left
func (gs *GameState) finishHandOnePlayerRemains() error {
	winner := gs.AwardPotToLastPlayer()
	if winner != nil {
		gs.Winners = []Winner{*winner}
	}
	gs.Street = StreetComplete
	return nil
}

// resolveShowdown determines winners and awards pots
func (gs *GameState) resolveShowdown() error {
	gs.CalculatePots()

	// Evaluate hands and award pots
	gs.Winners = gs.AwardPots(gs.CommunityCards, FindWinners)

	// Add hand descriptions to winners
	for i := range gs.Winners {
		playerIdx := gs.Winners[i].PlayerIdx
		allCards := append([]Card{}, gs.Players[playerIdx].HoleCards...)
		allCards = append(allCards, gs.CommunityCards...)
		result := EvaluateHand(allCards)
		gs.Winners[i].HandType = result.HandType
		gs.Winners[i].HandDesc = GetHandDescription(result)
	}

	gs.Street = StreetComplete
	return nil
}

// IsHandComplete checks if the current hand is finished
func (gs *GameState) IsHandComplete() bool {
	return gs.Street == StreetComplete
}

// IsWaitingForAction checks if we're waiting for a player action
func (gs *GameState) IsWaitingForAction() bool {
	return gs.CurrentPlayerIdx >= 0 && gs.CurrentPlayerIdx < len(gs.Players)
}

// NeedToAdvanceStreet checks if current betting round is done
func (gs *GameState) NeedToAdvanceStreet() bool {
	if gs.IsHandComplete() {
		return false
	}
	return gs.IsBettingRoundComplete()
}

// GetCurrentPlayer returns the current player who needs to act
func (gs *GameState) GetCurrentPlayer() *Player {
	if gs.CurrentPlayerIdx < 0 || gs.CurrentPlayerIdx >= len(gs.Players) {
		return nil
	}
	return &gs.Players[gs.CurrentPlayerIdx]
}

// EliminateBrokePlayers marks players with 0 chips as eliminated
func (gs *GameState) EliminateBrokePlayers() {
	for i := range gs.Players {
		if gs.Players[i].Stack == 0 && gs.Players[i].Status != PlayerEliminated {
			gs.Players[i].Status = PlayerEliminated
		}
	}
}

// GetGameSummary returns a summary suitable for display
func (gs *GameState) GetGameSummary() map[string]interface{} {
	return map[string]interface{}{
		"handNumber":     gs.HandNumber,
		"street":         gs.Street.String(),
		"pot":            gs.GetTotalPot(),
		"communityCards": gs.CommunityCards,
		"currentPlayer":  gs.CurrentPlayerIdx,
		"currentBet":     gs.CurrentBet,
		"playersInHand":  gs.CountActivePlayers(),
	}
}

// Helper functions

func generateGameID() string {
	return fmt.Sprintf("game_%d", time.Now().UnixNano())
}

