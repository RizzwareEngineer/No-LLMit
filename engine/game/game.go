// This file is the heart of the poker engine. It holds the GameState struct which tracks
// everything: players, cards, pots, betting state. NewGame creates a table, StartHand deals
// cards and posts blinds, AdvanceStreet moves through flop/turn/river, and resolveShowdown
// determines winners. Driven by api/table.go.
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

type Stakes struct {
	SmallBlind int `json:"smallBlind"`
	BigBlind   int `json:"bigBlind"`
}

type GameConfig struct {
	PlayerNames   []string `json:"playerNames"`
	StartingStack int      `json:"startingStack"`
	Stakes        Stakes   `json:"stakes"`
}

type GameState struct {
	ID                 string      `json:"id"`
	Players            []Player    `json:"players"`
	CommunityCards     []Card      `json:"communityCards"`
	Pots               []Pot       `json:"pots"`
	Street             Street      `json:"street"`
	ButtonIdx          int         `json:"buttonIdx"`
	CurrentPlayerIdx   int         `json:"currentPlayerIdx"`
	CurrentBet         int         `json:"currentBet"`
	MinRaise           int         `json:"minRaise"`
	Stakes             Stakes      `json:"stakes"`
	HandNumber         int         `json:"handNumber"`
	Winners            []Winner    `json:"winners,omitempty"`
	GameStartTime      time.Time   `json:"gameStartTime"`
	deck               *Deck       `json:"-"`
	LLMActionsThisHand []LLMAction `json:"-"`
}

func NewGame(config GameConfig) *GameState {
	players := make([]Player, len(config.PlayerNames))
	for i, name := range config.PlayerNames {
		players[i] = Player{
			ID:        fmt.Sprintf("%d", i+1),
			Name:      name,
			Stack:     config.StartingStack,
			HoleCards: []Card{},
			Status:    PlayerActive,
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
		HandNumber:         0,
		GameStartTime:      time.Now(), // Server timestamp for game start
		deck:               NewDeck(),
		LLMActionsThisHand: []LLMAction{},
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
	gs.deck.Shuffle()
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

		if i == 0 || card.compareForButton(highestCard) > 0 {
			highestCard = card
			highestIdx = i
		}
	}

	gs.ButtonIdx = highestIdx
	gs.deck.Shuffle() // Reset deck for actual play

	return cards
}

// StartHand deals the next hand. Every seat needs chips (RebuyBrokePlayers).
func (gs *GameState) StartHand() error {
	activeCount := 0
	for _, p := range gs.Players {
		if p.Stack > 0 {
			activeCount++
		}
	}
	if activeCount < 2 {
		return fmt.Errorf("not enough players to start hand (need at least 2, have %d)", activeCount)
	}

	gs.HandNumber++
	gs.deck.Shuffle()
	gs.CommunityCards = []Card{}
	gs.Winners = nil
	gs.resetPotsForNewHand()

	for i := range gs.Players {
		gs.Players[i].HoleCards = []Card{}
		gs.Players[i].LastAction = nil
		gs.Players[i].HasActedThisRound = false
		gs.Players[i].RaiseClosed = false
		if gs.Players[i].Stack > 0 {
			gs.Players[i].Status = PlayerActive
		}
	}

	// Only rotate button after the first hand (first hand uses button from DetermineButton)
	if gs.HandNumber > 1 {
		gs.rotateButton()
	}
	gs.Street = StreetPreflop
	gs.postBlinds()
	gs.dealHoleCards()

	gs.CurrentPlayerIdx = gs.getFirstToAct()
	if gs.isBettingRoundComplete() {
		gs.CurrentPlayerIdx = -1 // heads-up with a blind posted all-in: nothing to decide, the board runs out
	}

	return nil
}

func (gs *GameState) rotateButton() {
	for i := 1; i <= len(gs.Players); i++ {
		idx := (gs.ButtonIdx + i) % len(gs.Players)
		if gs.Players[idx].Stack > 0 {
			gs.ButtonIdx = idx
			return
		}
	}
}

func (gs *GameState) postBlinds() {
	sbIdx, bbIdx := gs.blindSeats()

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

	gs.recordActionForLLMs(sbIdx, "post", sbAmount)
	gs.recordActionForLLMs(bbIdx, "post", bbAmount)
}

// blindSeats returns the small and big blind: left of the button, except heads-up, where the button posts the small blind.
func (gs *GameState) blindSeats() (sb, bb int) {
	sb = gs.getNextActivePlayer(gs.ButtonIdx)
	if gs.getNextActivePlayer(sb) == gs.ButtonIdx {
		sb = gs.ButtonIdx
	}
	return sb, gs.getNextActivePlayer(sb)
}

func (gs *GameState) getNextActivePlayer(fromIdx int) int {
	for i := 1; i <= len(gs.Players); i++ {
		idx := (fromIdx + i) % len(gs.Players)
		if gs.Players[idx].Stack > 0 {
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

	// One card at a time around the table, twice.
	for round := 0; round < 2; round++ {
		for i := 0; i < len(gs.Players); i++ {
			idx := (startIdx + i) % len(gs.Players)
			gs.Players[idx].HoleCards = append(gs.Players[idx].HoleCards, gs.deck.Deal(1)[0])
		}
	}
}

func (gs *GameState) AdvanceStreet() error {
	gs.collectBetsIntoPot()

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
		gs.dealOne()
	case StreetTurn:
		gs.Street = StreetRiver
		gs.dealOne()
	case StreetRiver:
		gs.Street = StreetShowdown
		return gs.resolveShowdown()
	case StreetShowdown:
		gs.Street = StreetComplete
		return nil
	}

	gs.resetBettingRound()
	gs.CurrentPlayerIdx = gs.getFirstToAct()

	return nil
}

func (gs *GameState) dealFlop() {
	gs.deck.burn()
	gs.CommunityCards = append(gs.CommunityCards, gs.deck.Deal(3)...)
}

// dealOne burns a card and deals the turn or river.
func (gs *GameState) dealOne() {
	gs.deck.burn()
	gs.CommunityCards = append(gs.CommunityCards, gs.deck.Deal(1)[0])
}

func (gs *GameState) runOutBoard() error {
	for len(gs.CommunityCards) < 5 {
		gs.dealOne()
	}
	gs.Street = StreetShowdown
	return gs.resolveShowdown()
}

func (gs *GameState) finishHandOnePlayerRemains() error {
	winner := gs.awardPotToLastPlayer()
	if winner != nil {
		gs.Winners = []Winner{*winner}
	}
	gs.Street = StreetComplete
	gs.LLMActionsThisHand = []LLMAction{}
	return nil
}

func (gs *GameState) resolveShowdown() error {
	gs.calculatePots()
	gs.Winners = gs.awardPots(gs.CommunityCards, findWinners)

	for i := range gs.Winners {
		playerIdx := gs.Winners[i].PlayerIdx
		allCards := append([]Card{}, gs.Players[playerIdx].HoleCards...)
		allCards = append(allCards, gs.CommunityCards...)
		result := EvaluateHand(allCards)
		gs.Winners[i].HandType = result.HandType
		gs.Winners[i].HandDesc = getHandDescription(result)
	}

	gs.Street = StreetComplete
	gs.LLMActionsThisHand = []LLMAction{}
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
	return gs.isBettingRoundComplete()
}

// RebuyBrokePlayers tops any player with no chips back up to the given stack so a cash
// game never runs out of players. Winnings are untouched, so the loss stays on record.
// It returns the indices of the players who rebought.
func (gs *GameState) RebuyBrokePlayers(stack int) []int {
	var rebought []int
	for i := range gs.Players {
		if gs.Players[i].Stack == 0 {
			gs.Players[i].Stack = stack
			gs.Players[i].Status = PlayerActive
			rebought = append(rebought, i)
		}
	}
	return rebought
}

// DeckOrder returns this hand's full shuffled deck, in the order cards are dealt.
func (gs *GameState) DeckOrder() []string {
	return CardStrings(gs.deck.cards)
}

func (gs *GameState) recordActionForLLMs(seat int, action string, amount int) {
	gs.LLMActionsThisHand = append(gs.LLMActionsThisHand, LLMAction{
		Seat:   seat,
		Action: action,
		Amount: amount,
		Street: gs.Street,
		Pot:    gs.SimplifiedPotCalculation(),
	})
}

// middlePositions names the seats between the big blind and the button, by how many there
// are; the seat before the button is always the cutoff.
var middlePositions = [][]string{
	1: {"CO"},
	2: {"UTG", "CO"},
	3: {"UTG", "MP", "CO"},
	4: {"UTG", "MP", "HJ", "CO"},
	5: {"UTG", "UTG+1", "MP", "HJ", "CO"},
	6: {"UTG", "UTG+1", "MP", "MP+1", "HJ", "CO"},
}

// PositionName names a seat's position this hand (BTN, SB, BB, UTG, ...): the one name the
// models are told, the stream shows and saved hands keep.
func (gs *GameState) PositionName(playerIdx int) string {
	numPlayers := len(gs.Players)
	distFromButton := (playerIdx - gs.ButtonIdx + numPlayers) % numPlayers

	switch {
	case distFromButton == 0:
		return "BTN"
	case numPlayers == 2:
		return "BB" // heads-up the button posts the small blind (blindSeats)
	case distFromButton == 1:
		return "SB"
	case distFromButton == 2:
		return "BB"
	case numPlayers-3 >= len(middlePositions):
		return "MP" // more than 9 seats: no table seats that many
	}
	return middlePositions[numPlayers-3][distFromButton-3]
}

func generateGameID() string {
	return fmt.Sprintf("game_%d", time.Now().UnixNano())
}
