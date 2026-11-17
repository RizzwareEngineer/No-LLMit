// This file manages a standard 52-card deck. NewDeck creates and shuffles it, Deal pulls
// cards off the top, burn discards one (per poker rules before community cards), and
// Shuffle reshuffles all 52 for the next hand. Called by game.go during StartHand and
// street transitions.
package game

import (
	"math/rand"
	"os"
	"strconv"
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
		rng:   rand.New(rand.NewSource(deckSeed())),
	}
	d.initCards()
	d.Shuffle()
	return d
}

// deckSeed seeds a new deck from the clock. FIXTURE_SEED (test fixtures only: web/scripts/fixture; production
// never sets it) seeds it from that number instead, so a fixture deals the same cards every run.
func deckSeed() int64 {
	if v, err := strconv.ParseInt(os.Getenv("FIXTURE_SEED"), 10, 64); err == nil {
		return v
	}
	return time.Now().UnixNano()
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

func (d *Deck) burn() {
	d.index++
}
