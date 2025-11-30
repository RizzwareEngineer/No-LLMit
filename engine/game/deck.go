// This file manages a standard 52-card deck. NewDeck creates and shuffles it, Deal pulls
// cards off the top, Burn discards one (per poker rules before community cards), and Reset
// reshuffles for the next hand. Called by game.go during StartHand and street transitions.
package game

import (
	"math/rand"
	"time"
)

type Deck struct {
	cards []Card
	index int // Current position in deck
	rng   *rand.Rand
}

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

func (d *Deck) initCards() {
	i := 0
	for suit := Hearts; suit <= Spades; suit++ {
		for rank := Two; rank <= Ace; rank++ {
			d.cards[i] = Card{Rank: rank, Suit: suit}
			i++
		}
	}
}

func (d *Deck) Shuffle() {
	for i := len(d.cards) - 1; i > 0; i-- {
		j := d.rng.Intn(i + 1)
		d.cards[i], d.cards[j] = d.cards[j], d.cards[i]
	}
	d.index = 0
}

func (d *Deck) Deal(n int) []Card {
	if d.index+n > len(d.cards) {
		return nil
	}

	cards := make([]Card, n)
	copy(cards, d.cards[d.index:d.index+n])
	d.index += n
	return cards
}

func (d *Deck) Burn() {
	d.index++
}

func (d *Deck) Reset() {
	d.Shuffle()
}
