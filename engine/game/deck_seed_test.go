package game

import "testing"

// FIXTURE_SEED makes two decks deal the same cards; without it each deck is seeded from the clock.
func TestFixtureSeedDealsTheSameCards(t *testing.T) {
	t.Setenv("FIXTURE_SEED", "42")
	a, b := NewDeck().Deal(52), NewDeck().Deal(52)
	for i := range a {
		if a[i] != b[i] {
			t.Fatalf("card %d differs with the same seed: %v vs %v", i, a[i], b[i])
		}
	}
	t.Setenv("FIXTURE_SEED", "")
	c, d := NewDeck().Deal(52), NewDeck().Deal(52)
	same := true
	for i := range c {
		same = same && c[i] == d[i]
	}
	if same {
		t.Fatal("two unseeded decks dealt the same 52 cards")
	}
}
