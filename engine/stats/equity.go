// All-in EV: when every player still in the hand is all-in before the river, each one's
// result is replaced by what they would win on average over every possible runout,
// given everyone's actual hole cards. Exact on the flop and turn, Monte Carlo preflop.
package stats

import (
	"math/rand"
	"runtime"
	"sort"
	"strconv"
	"sync"

	"github.com/rizzwareengineer/no-LLMit/engine/game"
	"github.com/rizzwareengineer/no-LLMit/engine/history"
)

const preflopSamples = 10000

type pot struct {
	amount   float64
	eligible []int // indexes into the players being evaluated
}

// aievCache keeps each hand's all-in EV nets, since a preflop all-in takes up to seconds
// with the shared evaluator and stats are recomputed after every hand.
var aievCache sync.Map // hand_id -> map[int]float64

var boardAt = map[string]int{"preflop": 0, "flop": 3, "turn": 4}

// needsEV reports whether the hand was all-in before the river: it reached showdown and
// the last decision came before the river, so the rest of the board was run out.
func needsEV(h history.HandRecord) bool {
	if len(h.Actions) == 0 || len(h.Result.Showdown) < 2 || len(h.Board) != 5 {
		return false
	}
	_, ok := boardAt[h.Actions[len(h.Actions)-1].Street]
	return ok
}

func actualNets(h history.HandRecord) map[int]float64 {
	out := make(map[int]float64, len(h.Seats))
	for _, s := range h.Seats {
		out[s.Seat] = float64(netOf(&h, s.Seat))
	}
	return out
}

// aievNet returns each seat's all-in-EV-adjusted net for the hand: its actual net,
// except in an all-in before the river, where it is expected winnings minus chips put in.
// ok is false when that all-in has not been computed yet (see WarmAIEV); the actual nets
// stand in for it.
func aievNet(h history.HandRecord) (nets map[int]float64, ok bool) {
	if !needsEV(h) {
		return actualNets(h), true
	}
	if v, ok := aievCache.Load(h.HandID); ok {
		return v.(map[int]float64), true
	}
	return actualNets(h), false
}

// WarmAIEV computes the all-in EV of up to limit hands that need it and are not cached yet
// (all of them when limit < 0), on half the cores so the table keeps running. It returns
// the indexes of the hands it computed and how many are still left.
func WarmAIEV(hands []history.HandRecord, limit int) (warmed []int, remaining int) {
	for i, h := range hands {
		if !needsEV(h) {
			continue
		}
		if _, ok := aievCache.Load(h.HandID); ok {
			continue
		}
		if limit >= 0 && len(warmed) >= limit {
			remaining++
			continue
		}
		warmed = append(warmed, i)
	}
	var wg sync.WaitGroup
	sem := make(chan struct{}, max(1, runtime.NumCPU()/2))
	for _, i := range warmed {
		wg.Add(1)
		sem <- struct{}{}
		go func(h history.HandRecord) {
			defer func() { <-sem; wg.Done() }()
			computeAIEV(h)
		}(hands[i])
	}
	wg.Wait()
	return warmed, remaining
}

// computeAIEV works out a hand's all-in EV nets and caches them.
func computeAIEV(h history.HandRecord) map[int]float64 {
	out := actualNets(h)
	defer aievCache.Store(h.HandID, out)
	if !needsEV(h) {
		return out
	}
	known := boardAt[h.Actions[len(h.Actions)-1].Street]

	contrib := contributions(h)
	inShowdown := map[int]bool{}
	for _, sd := range h.Result.Showdown {
		inShowdown[sd.Seat] = true
	}
	for seat, c := range contrib {
		if !inShowdown[seat] && float64(netOf(&h, seat)) != -c {
			return out // the actions do not add up to the result; keep the actual nets
		}
	}

	var holes [][]game.Card
	var seats []int
	for _, sd := range h.Result.Showdown {
		cards, err := parseCards(sd.HoleCards)
		if err != nil || len(cards) != 2 {
			return out
		}
		holes = append(holes, cards)
		seats = append(seats, sd.Seat)
	}
	board, err := parseCards(h.Board[:known])
	if err != nil {
		return out
	}

	won := expectedWinnings(holes, board, buildPots(contrib, seats))
	for i, seat := range seats {
		out[seat] = won[i] - contrib[seat]
	}
	return out
}

// contributions is the chips each seat put in over the hand, from the blinds and the
// applied actions (a call adds its amount; a bet, raise or all-in sets the street total).
// result.pots cannot be used: a pot only one player is eligible for is not recorded.
func contributions(h history.HandRecord) map[int]float64 {
	total, street := make(map[int]float64, len(h.Seats)), make(map[int]float64, len(h.Seats))
	for _, b := range h.Blinds {
		street[b.Seat] = float64(b.Amount)
	}
	cur := "preflop"
	for _, a := range h.Actions {
		if a.Street != cur {
			for seat, c := range street {
				total[seat] += c
			}
			clear(street)
			cur = a.Street
		}
		switch a.Applied.Type {
		case "CALL":
			street[a.Seat] += float64(a.Applied.Amount)
		case "BET", "RAISE", "ALL_IN":
			street[a.Seat] = float64(a.Applied.Amount)
		}
	}
	for seat, c := range street {
		total[seat] += c
	}
	return total
}

// buildPots splits the chips into a main pot and side pots by contribution level. Only the
// showdown seats are eligible; folded chips count toward each level up to what they put in.
func buildPots(contrib map[int]float64, showdown []int) []pot {
	levels := []float64{}
	for _, s := range showdown {
		levels = append(levels, contrib[s])
	}
	sort.Float64s(levels)
	var pots []pot
	prev := 0.0
	for _, level := range levels {
		if level == prev {
			continue
		}
		p := pot{}
		for _, c := range contrib {
			p.amount += min(c, level) - min(c, prev)
		}
		for i, s := range showdown {
			if contrib[s] >= level {
				p.eligible = append(p.eligible, i)
			}
		}
		pots = append(pots, p)
		prev = level
	}
	return pots
}

// equity is each player's share of a single pot over all runouts.
func equity(holes [][]game.Card, board []game.Card) []float64 {
	all := make([]int, len(holes))
	for i := range all {
		all[i] = i
	}
	return expectedWinnings(holes, board, []pot{{amount: 1, eligible: all}})
}

// expectedWinnings averages what each player wins from the pots over the runouts: every
// runout when one or two cards are to come, preflopSamples seeded random ones preflop.
func expectedWinnings(holes [][]game.Card, board []game.Card, pots []pot) []float64 {
	used := map[game.Card]bool{}
	for _, c := range board {
		used[c] = true
	}
	for _, h := range holes {
		for _, c := range h {
			used[c] = true
		}
	}
	var deck []game.Card
	for s := game.Hearts; s <= game.Spades; s++ {
		for r := game.Two; r <= game.Ace; r++ {
			if c := (game.Card{Rank: r, Suit: s}); !used[c] {
				deck = append(deck, c)
			}
		}
	}

	won := make([]float64, len(holes))
	runs := 0
	score := func(full []game.Card) {
		runs++
		results := make([]game.HandResult, len(holes))
		for i, h := range holes {
			results[i] = game.EvaluateHand(append(append([]game.Card{}, h...), full...))
		}
		for _, p := range pots {
			var best []int
			for _, i := range p.eligible {
				if len(best) == 0 {
					best = []int{i}
				} else if c := game.CompareHands(results[i], results[best[0]]); c > 0 {
					best = []int{i}
				} else if c == 0 {
					best = append(best, i)
				}
			}
			for _, i := range best {
				won[i] += p.amount / float64(len(best))
			}
		}
	}

	need := 5 - len(board)
	switch need {
	case 0:
		score(board)
	case 1:
		for _, c := range deck {
			score(append(append([]game.Card{}, board...), c))
		}
	case 2:
		for i := range deck {
			for j := i + 1; j < len(deck); j++ {
				score(append(append([]game.Card{}, board...), deck[i], deck[j]))
			}
		}
	default:
		rng := rand.New(rand.NewSource(1))
		for n := 0; n < preflopSamples; n++ {
			for k := 0; k < need; k++ { // partial Fisher-Yates: deck[:need] is the sample
				j := k + rng.Intn(len(deck)-k)
				deck[k], deck[j] = deck[j], deck[k]
			}
			score(append(append([]game.Card{}, board...), deck[:need]...))
		}
	}
	for i := range won {
		won[i] /= float64(runs)
	}
	return won
}

func parseCards(ss []string) ([]game.Card, error) {
	out := make([]game.Card, 0, len(ss))
	for _, s := range ss {
		c, err := game.ParseCard(s)
		if err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, nil
}

func netOf(h *history.HandRecord, seat int) int { // a pointer: stats calls it per pair of seats
	return h.Result.Net[strconv.Itoa(seat)]
}
