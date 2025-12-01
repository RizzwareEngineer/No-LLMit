// This file defines Card, Suit, and Rank types. Cards use short notation like "Ah" for
// Ace of hearts, "Tc" for Ten of clubs. ParseCard converts strings back to Card structs.
// Used everywhere cards are handled: deck.go, game.go, hand.go.
package game

import "fmt"

type Suit int

const (
	Hearts Suit = iota
	Diamonds
	Clubs
	Spades
)

func (s Suit) String() string {
	return []string{"h", "d", "c", "s"}[s]
}

func (s Suit) Symbol() string {
	return []string{"♥", "♦", "♣", "♠"}[s]
}

type Rank int

const (
	Two   Rank = 2
	Three Rank = 3
	Four  Rank = 4
	Five  Rank = 5
	Six   Rank = 6
	Seven Rank = 7
	Eight Rank = 8
	Nine  Rank = 9
	Ten   Rank = 10
	Jack  Rank = 11
	Queen Rank = 12
	King  Rank = 13
	Ace   Rank = 14
)

func (r Rank) String() string {
	switch r {
	case Ten:
		return "T"
	case Jack:
		return "J"
	case Queen:
		return "Q"
	case King:
		return "K"
	case Ace:
		return "A"
	default:
		return fmt.Sprintf("%d", r)
	}
}

type Card struct {
	Rank Rank `json:"rank"`
	Suit Suit `json:"suit"`
}

func (c Card) String() string {
	return c.Rank.String() + c.Suit.String()
}

// SuitRank returns the rank of the suit for button determination.
// Spades(3) > Hearts(0) > Diamonds(1) > Clubs(2)
func (s Suit) SuitRank() int {
	ranks := map[Suit]int{Spades: 4, Hearts: 3, Diamonds: 2, Clubs: 1}
	return ranks[s]
}

// CompareForButton compares two cards for button determination.
// Higher card wins. For ties, suit is used (Spades > Hearts > Diamonds > Clubs).
// Returns 1 if c > other, -1 if c < other, 0 if equal.
func (c Card) CompareForButton(other Card) int {
	if c.Rank > other.Rank {
		return 1
	}
	if c.Rank < other.Rank {
		return -1
	}
	// Same rank, compare suits
	if c.Suit.SuitRank() > other.Suit.SuitRank() {
		return 1
	}
	if c.Suit.SuitRank() < other.Suit.SuitRank() {
		return -1
	}
	return 0
}

func ParseCard(s string) (Card, error) {
	if len(s) < 2 {
		return Card{}, fmt.Errorf("invalid card string: %s", s)
	}

	var rank Rank
	rankStr := s[:len(s)-1]
	switch rankStr {
	case "2":
		rank = Two
	case "3":
		rank = Three
	case "4":
		rank = Four
	case "5":
		rank = Five
	case "6":
		rank = Six
	case "7":
		rank = Seven
	case "8":
		rank = Eight
	case "9":
		rank = Nine
	case "T", "10":
		rank = Ten
	case "J":
		rank = Jack
	case "Q":
		rank = Queen
	case "K":
		rank = King
	case "A":
		rank = Ace
	default:
		return Card{}, fmt.Errorf("invalid rank: %s", rankStr)
	}

	var suit Suit
	suitStr := s[len(s)-1:]
	switch suitStr {
	case "h":
		suit = Hearts
	case "d":
		suit = Diamonds
	case "c":
		suit = Clubs
	case "s":
		suit = Spades
	default:
		return Card{}, fmt.Errorf("invalid suit: %s", suitStr)
	}

	return Card{Rank: rank, Suit: suit}, nil
}
