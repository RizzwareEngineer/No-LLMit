// This file handles pot math. calculatePots figures out main pots and side pots (needed
// when players go all-in for different amounts). awardPots gives money to winners, handling
// split pots when hands tie. awardPotToLastPlayer handles the simple case when everyone
// else folded. Called by game.go at the end of each hand.
package game

import (
	"slices"
	"sort"
)

type Pot struct {
	Amount          int
	EligiblePlayers []int
}

type Winner struct {
	PlayerIdx       int
	Amount          int
	HandType        HandType
	HandDesc        string // e.g., "Full House, Kings over Aces"
	EligiblePlayers []int  // Players who were competing for this pot
	PotNumber       int
}

// calculatePots splits the chips into a main pot and side pots, one per contribution level
// of the players still in the hand.
func (gs *GameState) calculatePots() {
	put := make(map[int]int, len(gs.Players))
	var live []int
	for i, p := range gs.Players {
		put[i] = p.TotalBetThisHand
		if p.Status != PlayerFolded {
			live = append(live, i)
		}
	}
	gs.Pots = SplitPots(put, live)
}

// SplitPots splits the chips each seat put in into a main pot and side pots, one per
// contribution level of the live seats, each listing the live seats that can win it. A
// folded seat's chips count toward each level only up to what it put in. stats uses it
// too, so all-in EV splits the pots the way the table paid them.
func SplitPots(put map[int]int, live []int) []Pot {
	live = slices.Clone(live)
	sort.SliceStable(live, func(i, j int) bool { return put[live[i]] < put[live[j]] })
	pots := []Pot{}
	prev := 0
	for i, seat := range live {
		level := put[seat]
		if level == prev {
			continue
		}
		amount := 0
		for _, c := range put {
			amount += min(c, level) - min(c, prev)
		}
		pots = append(pots, Pot{Amount: amount, EligiblePlayers: slices.Clone(live[i:])})
		prev = level
	}
	// Folded chips above the highest level (not expected, but never lose chips) join the top pot.
	for _, c := range put {
		if c > prev && len(pots) > 0 {
			pots[len(pots)-1].Amount += c - prev
		}
	}
	return pots
}

func (gs *GameState) SimplifiedPotCalculation() int {
	total := 0
	for _, p := range gs.Players {
		total += p.TotalBetThisHand
	}
	return total
}

func (gs *GameState) collectBetsIntoPot() {
	for i := range gs.Players {
		gs.Players[i].CurrentBet = 0
	}
}

// awardPots pays out gs.Pots, which calculatePots has just set.
func (gs *GameState) awardPots(communityCards []Card, evaluateFunc func([]Player, []Card, []int) []int) []Winner {
	var winners []Winner
	amountWon := make(map[int]int)
	displayPotNumber := 0

	for _, pot := range gs.Pots {
		if len(pot.EligiblePlayers) == 0 {
			continue
		}

		if len(pot.EligiblePlayers) == 1 { // Uncalled bet - return it

			playerIdx := pot.EligiblePlayers[0]
			gs.Players[playerIdx].Stack += pot.Amount
			amountWon[playerIdx] += pot.Amount
			continue
		}

		displayPotNumber++
		potWinners := evaluateFunc(gs.Players, communityCards, pot.EligiblePlayers)
		if len(potWinners) == 0 {
			continue
		}
		// Seat order starting left of the button, so the odd chip goes to the first winner there.
		n := len(gs.Players)
		sort.Slice(potWinners, func(i, j int) bool {
			return (potWinners[i]-gs.ButtonIdx-1+n)%n < (potWinners[j]-gs.ButtonIdx-1+n)%n
		})

		splitAmount := pot.Amount / len(potWinners)
		remainder := pot.Amount % len(potWinners)
		eligible := make([]int, len(pot.EligiblePlayers))
		copy(eligible, pot.EligiblePlayers)

		for i, winnerIdx := range potWinners {
			amount := splitAmount
			if i == 0 { // Odd chip(s) to the first winner left of the button
				amount += remainder
			}

			gs.Players[winnerIdx].Stack += amount
			amountWon[winnerIdx] += amount

			winners = append(winners, Winner{
				PlayerIdx:       winnerIdx,
				Amount:          amount,
				EligiblePlayers: eligible,
				PotNumber:       displayPotNumber,
			})
		}
	}

	for playerIdx, won := range amountWon {
		contributed := gs.Players[playerIdx].TotalBetThisHand
		profit := won - contributed
		gs.Players[playerIdx].Winnings += profit
	}

	for i := range gs.Players {
		if _, won := amountWon[i]; !won && gs.Players[i].TotalBetThisHand > 0 {
			gs.Players[i].Winnings -= gs.Players[i].TotalBetThisHand
		}
	}

	return winners
}

func (gs *GameState) awardPotToLastPlayer() *Winner {
	lastPlayerIdx := -1
	for i, p := range gs.Players {
		if p.Status == PlayerActive || p.Status == PlayerAllIn {
			if lastPlayerIdx != -1 {
				return nil
			}
			lastPlayerIdx = i
		}
	}

	if lastPlayerIdx == -1 {
		return nil
	}

	totalPot := gs.SimplifiedPotCalculation()
	profit := totalPot - gs.Players[lastPlayerIdx].TotalBetThisHand

	gs.Players[lastPlayerIdx].Stack += totalPot
	gs.Players[lastPlayerIdx].Winnings += profit

	// Deduct contributions from losers (players who folded)
	for i := range gs.Players {
		if i != lastPlayerIdx && gs.Players[i].TotalBetThisHand > 0 {
			gs.Players[i].Winnings -= gs.Players[i].TotalBetThisHand
		}
	}

	return &Winner{
		PlayerIdx: lastPlayerIdx,
		Amount:    totalPot, // what the pot paid, as at showdown; Winnings carries the profit
		HandDesc:  "uncontested",
	}
}

func (gs *GameState) resetPotsForNewHand() {
	gs.Pots = []Pot{}
	for i := range gs.Players {
		gs.Players[i].TotalBetThisHand = 0
		gs.Players[i].CurrentBet = 0
	}
}
