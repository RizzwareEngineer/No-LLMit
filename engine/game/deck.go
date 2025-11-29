package game

import (
	"math/rand"
	"time"
)

// Deck represents a deck of 52 playing cards
type Deck struct {
	cards []Card
	index int // Current position in deck
	rng   *rand.Rand
}

// NewDeck creates a new shuffled deck
func NewDeck() *Deck {
	d := &Deck{
		cards: make([]Card, 52),
		index: 0,
		rng:   rand.New(rand.NewSource(time.Now().UnixNano())),
	}
	d.initCards()
	d.Shuffle()
	return d
}

// NewDeckWithSeed creates a deck with a specific random seed (for testing)
func NewDeckWithSeed(seed int64) *Deck {
	d := &Deck{
		cards: make([]Card, 52),
		index: 0,
		rng:   rand.New(rand.NewSource(seed)),
	}
	d.initCards()
	d.Shuffle()
	return d
}

// initCards populates the deck with all 52 cards
func (d *Deck) initCards() {
	i := 0
	for suit := Hearts; suit <= Spades; suit++ {
		for rank := Two; rank <= Ace; rank++ {
			d.cards[i] = Card{Rank: rank, Suit: suit}
			i++
		}
	}
}

// Shuffle shuffles the deck using Fisher-Yates algorithm
func (d *Deck) Shuffle() {
	for i := len(d.cards) - 1; i > 0; i-- {
		j := d.rng.Intn(i + 1)
		d.cards[i], d.cards[j] = d.cards[j], d.cards[i]
	}
	d.index = 0
}

// Deal deals n cards from the deck
func (d *Deck) Deal(n int) []Card {
	if d.index+n > len(d.cards) {
		// Not enough cards - should never happen in proper game flow
		return nil
	}

	cards := make([]Card, n)
	copy(cards, d.cards[d.index:d.index+n])
	d.index += n
	return cards
}

// Burn discards the top card (standard poker practice)
func (d *Deck) Burn() {
	d.index++
}

// CardsRemaining returns how many cards are left in the deck
func (d *Deck) CardsRemaining() int {
	return len(d.cards) - d.index
}

// Reset reshuffles the deck for a new hand
func (d *Deck) Reset() {
	d.Shuffle()
}
