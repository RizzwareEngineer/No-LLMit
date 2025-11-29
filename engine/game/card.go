package game

import (
	"encoding/json"
	"fmt"
)

// Suit represents a card suit
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

// Rank represents a card rank (2-14, where 14 is Ace)
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

// Card represents a playing card
type Card struct {
	Rank Rank `json:"rank"`
	Suit Suit `json:"suit"`
}

// String returns the card in format like "Ah", "Kd", "Tc"
func (c Card) String() string {
	return c.Rank.String() + c.Suit.String()
}

// MarshalJSON implements custom JSON marshaling for Card
func (c Card) MarshalJSON() ([]byte, error) {
	return json.Marshal(c.String())
}

// UnmarshalJSON implements custom JSON unmarshaling for Card
func (c *Card) UnmarshalJSON(data []byte) error {
	var s string
	if err := json.Unmarshal(data, &s); err != nil {
		return err
	}
	card, err := ParseCard(s)
	if err != nil {
		return err
	}
	*c = card
	return nil
}

// ParseCard parses a string like "Ah" into a Card
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

