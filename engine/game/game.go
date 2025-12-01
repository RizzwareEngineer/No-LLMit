// This file is the heart of the poker engine. It holds the GameState struct which tracks
// everything: players, cards, pots, betting state. NewGame creates a table, StartHand deals
// cards and posts blinds, AdvanceStreet moves through flop/turn/river, and resolveShowdown
// determines winners. Called by api/game_handlers.go and api/llm_handlers.go.
package game

import (
	"fmt"
	"time"
)

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

type GameMode int

const (
	ModeSimulate GameMode = iota // All LLMs
	ModePlay                     // User plays one seat
	ModeTest                     // User controls all seats (for debugging)
)

func (gm GameMode) String() string {
	return []string{"simulate", "play", "test"}[gm]
}

type Stakes struct {
	SmallBlind int `json:"smallBlind"`
	BigBlind   int `json:"bigBlind"`
}

type GameConfig struct {
	PlayerNames   []string `json:"playerNames"`
	StartingStack int      `json:"startingStack"`
	Stakes        Stakes   `json:"stakes"`
	Mode          GameMode `json:"mode"`
	UserSeatIdx   int      `json:"userSeatIdx"` // Only relevant in ModePlay
}

type GameState struct {
	ID                 string            `json:"id"`
	Players            []Player          `json:"players"`
	CommunityCards     []Card            `json:"communityCards"`
	Pots               []Pot             `json:"pots"`
	Street             Street            `json:"street"`
	ButtonIdx          int               `json:"buttonIdx"`
	CurrentPlayerIdx   int               `json:"currentPlayerIdx"`
	CurrentBet         int               `json:"currentBet"`
	MinRaise           int               `json:"minRaise"`
	LastRaiseAmount    int               `json:"lastRaiseAmount"`
	Stakes             Stakes            `json:"stakes"`
	Mode               GameMode          `json:"mode"`
	UserSeatIdx        int               `json:"userSeatIdx"`
	HandNumber         int               `json:"handNumber"`
	Winners            []Winner          `json:"winners,omitempty"`
	GameStartTime      time.Time         `json:"gameStartTime"`
	deck               *Deck             `json:"-"`
	actionsThisRound   int               `json:"-"`
	LLMActionsThisHand []map[string]any  `json:"-"`
	LLMPreviousHands   []LLMPreviousHand `json:"-"`
}

type WinnerFinder func(players []Player, communityCards []Card, eligibleIndices []int) []int

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
		ID:                 generateGameID(),
		Players:            players,
		CommunityCards:     []Card{},
		Pots:               []Pot{},
		Street:             StreetPreflop,
		ButtonIdx:          0, // Will be rotated before first hand
		CurrentPlayerIdx:   -1,
		Stakes:             config.Stakes,
		Mode:               config.Mode,
		UserSeatIdx:        config.UserSeatIdx,
		HandNumber:         0,
		GameStartTime:      time.Now(), // Server timestamp for game start
		deck:               NewDeck(),
		LLMActionsThisHand: []map[string]any{},
		LLMPreviousHands:   []LLMPreviousHand{},
	}

	return gs
}

type ButtonCard struct {
	PlayerIdx  int    `json:"playerIdx"`
	PlayerName string `json:"playerName"`
	Card       string `json:"card"`
}

// DetermineButton deals one card to each player and returns them in order.
// Also sets ButtonIdx to the player with the highest card.
// Caller should display these one at a time with delays.
func (gs *GameState) DetermineButton() []ButtonCard {
	gs.deck.Reset()
	cards := make([]ButtonCard, len(gs.Players))

	highestIdx := 0
	var highestCard Card

	for i, p := range gs.Players {
		card := gs.deck.Deal(1)[0]
		cards[i] = ButtonCard{
			PlayerIdx:  i,
			PlayerName: p.Name,
			Card:       card.String(),
		}

		if i == 0 || card.CompareForButton(highestCard) > 0 {
			highestCard = card
			highestIdx = i
		}
	}

	gs.ButtonIdx = highestIdx
	gs.deck.Reset() // Reset deck for actual play

	return cards
}

// GetButtonWinner returns the index of the player who won the button
func (gs *GameState) GetButtonWinner() int {
	return gs.ButtonIdx
}

func (gs *GameState) StartHand() error {
	gs.EliminateBrokePlayers()

	activeCount := 0
	for _, p := range gs.Players {
		if p.Status != PlayerEliminated && p.Stack > 0 {
			activeCount++
		}
	}
	if activeCount < 2 {
		return fmt.Errorf("not enough players to start hand (need at least 2, have %d)", activeCount)
	}

	gs.HandNumber++
	gs.deck.Reset()
	gs.CommunityCards = []Card{}
	gs.Winners = nil
	gs.ResetPotsForNewHand()

	for i := range gs.Players {
		gs.Players[i].HoleCards = []Card{}
		gs.Players[i].LastAction = nil
		gs.Players[i].HasActedThisRound = false
		if gs.Players[i].Status != PlayerEliminated && gs.Players[i].Stack > 0 {
			gs.Players[i].Status = PlayerActive
		}
	}

	// Only rotate button after the first hand (first hand uses button from DetermineButton)
	if gs.HandNumber > 1 {
		gs.rotateButton()
	}
	if err := gs.postBlinds(); err != nil {
		return err
	}
	gs.dealHoleCards()

	gs.Street = StreetPreflop
	gs.CurrentPlayerIdx = gs.GetFirstToAct()

	return nil
}

func (gs *GameState) rotateButton() {
	for i := 1; i <= len(gs.Players); i++ {
		idx := (gs.ButtonIdx + i) % len(gs.Players)
		if gs.Players[idx].Status != PlayerEliminated && gs.Players[idx].Stack > 0 {
			gs.ButtonIdx = idx
			return
		}
	}
}

func (gs *GameState) postBlinds() error {
	sbIdx := gs.getNextActivePlayer(gs.ButtonIdx) // SB is left of button
	bbIdx := gs.getNextActivePlayer(sbIdx)        // BB is left of SB

	sbPlayer := &gs.Players[sbIdx]
	sbAmount := min(gs.Stakes.SmallBlind, sbPlayer.Stack)
	sbPlayer.Stack -= sbAmount
	sbPlayer.CurrentBet = sbAmount
	sbPlayer.TotalBetThisHand = sbAmount
	if sbPlayer.Stack == 0 {
		sbPlayer.Status = PlayerAllIn
	}

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

	gs.RecordActionForLLMs(sbPlayer.Name, "post", sbAmount)
	gs.RecordActionForLLMs(bbPlayer.Name, "post", bbAmount)

	return nil
}

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

func (gs *GameState) dealHoleCards() {
	startIdx := (gs.ButtonIdx + 1) % len(gs.Players) // Start left of button

	for i := 0; i < len(gs.Players); i++ {
		idx := (startIdx + i) % len(gs.Players)
		if gs.Players[idx].Status != PlayerEliminated {
			gs.Players[idx].HoleCards = append(gs.Players[idx].HoleCards, gs.deck.Deal(1)[0])
		}
	}
	for i := 0; i < len(gs.Players); i++ {
		idx := (startIdx + i) % len(gs.Players)
		if gs.Players[idx].Status != PlayerEliminated {
			gs.Players[idx].HoleCards = append(gs.Players[idx].HoleCards, gs.deck.Deal(1)[0])
		}
	}
}

func (gs *GameState) AdvanceStreet() error {
	gs.CollectBetsIntoPot()

	if gs.CountActivePlayers() == 1 {
		return gs.finishHandOnePlayerRemains()
	}
	if gs.CountActiveNonAllInPlayers() <= 1 {
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

	gs.ResetBettingRound()
	gs.CurrentPlayerIdx = gs.GetFirstToAct()

	return nil
}

func (gs *GameState) dealFlop() {
	gs.deck.Burn()
	gs.CommunityCards = append(gs.CommunityCards, gs.deck.Deal(3)...)
}

func (gs *GameState) dealTurn() {
	gs.deck.Burn()
	gs.CommunityCards = append(gs.CommunityCards, gs.deck.Deal(1)[0])
}

func (gs *GameState) dealRiver() {
	gs.deck.Burn()
	gs.CommunityCards = append(gs.CommunityCards, gs.deck.Deal(1)[0])
}

func (gs *GameState) runOutBoard() error {
	for len(gs.CommunityCards) < 5 {
		gs.deck.Burn()
		gs.CommunityCards = append(gs.CommunityCards, gs.deck.Deal(1)[0])
	}
	gs.Street = StreetShowdown
	return gs.resolveShowdown()
}

func (gs *GameState) finishHandOnePlayerRemains() error {
	winner := gs.AwardPotToLastPlayer()
	if winner != nil {
		gs.Winners = []Winner{*winner}
	}
	gs.Street = StreetComplete
	gs.ArchiveHandForLLMs()
	return nil
}

func (gs *GameState) resolveShowdown() error {
	gs.CalculatePots()
	gs.Winners = gs.AwardPots(gs.CommunityCards, FindWinners)

	for i := range gs.Winners {
		playerIdx := gs.Winners[i].PlayerIdx
		allCards := append([]Card{}, gs.Players[playerIdx].HoleCards...)
		allCards = append(allCards, gs.CommunityCards...)
		result := EvaluateHand(allCards)
		gs.Winners[i].HandType = result.HandType
		gs.Winners[i].HandDesc = GetHandDescription(result)
	}

	gs.Street = StreetComplete
	gs.ArchiveHandForLLMs()
	return nil
}

func (gs *GameState) IsHandComplete() bool {
	return gs.Street == StreetComplete
}

func (gs *GameState) IsWaitingForAction() bool {
	return gs.CurrentPlayerIdx >= 0 && gs.CurrentPlayerIdx < len(gs.Players)
}

func (gs *GameState) NeedToAdvanceStreet() bool {
	if gs.IsHandComplete() {
		return false
	}
	return gs.IsBettingRoundComplete()
}

func (gs *GameState) GetCurrentPlayer() *Player {
	if gs.CurrentPlayerIdx < 0 || gs.CurrentPlayerIdx >= len(gs.Players) {
		return nil
	}
	return &gs.Players[gs.CurrentPlayerIdx]
}

func (gs *GameState) EliminateBrokePlayers() {
	for i := range gs.Players {
		if gs.Players[i].Stack == 0 && gs.Players[i].Status != PlayerEliminated {
			gs.Players[i].Status = PlayerEliminated
		}
	}
}

func (gs *GameState) RecordActionForLLMs(playerName, action string, amount int) {
	a := map[string]any{"player": playerName, "action": action}
	if amount > 0 {
		a["amount"] = amount
	}
	gs.LLMActionsThisHand = append(gs.LLMActionsThisHand, a)
}

func (gs *GameState) ArchiveHandForLLMs() {
	showdown := []map[string]any{}
	if gs.Street == StreetShowdown || gs.Street == StreetComplete {
		for i, p := range gs.Players {
			if p.Status == PlayerActive || p.Status == PlayerAllIn {
				showdown = append(showdown, map[string]any{
					"player": p.Name,
					"cards":  gs.GetLLMHoleCards(i),
				})
			}
		}
	}

	winners := make([]map[string]any, len(gs.Winners))
	for i, w := range gs.Winners {
		winners[i] = map[string]any{
			"player": gs.Players[w.PlayerIdx].Name,
			"amount": w.Amount,
		}
	}

	hand := LLMPreviousHand{
		Players:        gs.GetLLMPlayers(),
		CommunityCards: gs.GetLLMCommunityCards(),
		Actions:        gs.LLMActionsThisHand,
		Showdown:       showdown,
		Winners:        winners,
	}
	gs.LLMPreviousHands = append(gs.LLMPreviousHands, hand)
	gs.LLMActionsThisHand = []map[string]any{}
}

func (gs *GameState) GetLLMPlayers() []LLMPlayer {
	players := make([]LLMPlayer, len(gs.Players))
	for i, p := range gs.Players {
		players[i] = LLMPlayer{
			Name:     p.Name,
			Seat:     p.SeatPosition,
			Stack:    p.Stack,
			Position: gs.getPositionName(i),
		}
	}
	return players
}

func (gs *GameState) getPositionName(playerIdx int) string {
	numPlayers := len(gs.Players)
	distFromButton := (playerIdx - gs.ButtonIdx + numPlayers) % numPlayers

	switch distFromButton {
	case 0:
		return "BTN"
	case 1:
		return "SB"
	case 2:
		return "BB"
	case 3:
		return "UTG"
	case 4:
		if numPlayers <= 6 {
			return "MP"
		}
		return "UTG+1"
	case 5:
		if numPlayers <= 6 {
			return "CO"
		}
		return "MP"
	case 6:
		return "MP+1"
	case 7:
		return "HJ"
	case 8:
		return "CO"
	default:
		return "MP"
	}
}

func (gs *GameState) GetLLMCommunityCards() []string {
	cards := make([]string, len(gs.CommunityCards))
	for i, c := range gs.CommunityCards {
		cards[i] = c.String()
	}
	return cards
}

func (gs *GameState) GetLLMHoleCards(playerIdx int) []string {
	cards := make([]string, len(gs.Players[playerIdx].HoleCards))
	for i, c := range gs.Players[playerIdx].HoleCards {
		cards[i] = c.String()
	}
	return cards
}

func (gs *GameState) GetLLMPromptPayload(playerName string, validActions []LLMValidAction) *LLMPromptPayload {
	playerIdx := -1
	for i, p := range gs.Players {
		if p.Name == playerName {
			playerIdx = i
			break
		}
	}
	if playerIdx < 0 {
		return nil
	}

	return &LLMPromptPayload{
		YourName:        playerName,
		YourCards:       gs.GetLLMHoleCards(playerIdx),
		Players:         gs.GetLLMPlayers(),
		CommunityCards:  gs.GetLLMCommunityCards(),
		Pot:             gs.GetTotalPot(),
		ActionsThisHand: gs.LLMActionsThisHand,
		PreviousHands:   gs.LLMPreviousHands,
		ValidActions:    validActions,
	}
}

func generateGameID() string {
	return fmt.Sprintf("game_%d", time.Now().UnixNano())
}
