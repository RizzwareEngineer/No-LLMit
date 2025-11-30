// This file handles pot math. CalculatePots figures out main pots and side pots (needed
// when players go all-in for different amounts). AwardPots gives money to winners, handling
// split pots when hands tie. AwardPotToLastPlayer handles the simple case when everyone
// else folded. Called by game.go at the end of each hand.
package game

import "sort"

type Pot struct {
	Amount          int   `json:"amount"`
	EligiblePlayers []int `json:"eligiblePlayers"`
	ContributedBy   []int `json:"contributedBy"`
}

type Winner struct {
	PlayerIdx       int      `json:"playerIdx"`
	Amount          int      `json:"amount"`
	HandType        HandType `json:"handType"`
	HandDesc        string   `json:"handDesc"`        // e.g., "Full House, Kings over Aces"
	EligiblePlayers []int    `json:"eligiblePlayers"` // Players who were competing for this pot
	PotNumber       int      `json:"potNumber"`
}

func (gs *GameState) CalculatePots() {
	type contribution struct {
		playerIdx int
		amount    int
		isAllIn   bool
	}

	var activeContributions []contribution
	totalFromFolded := 0

	for i, p := range gs.Players {
		if p.TotalBetThisHand > 0 {
			if p.Status == PlayerFolded || p.Status == PlayerEliminated {
				totalFromFolded += p.TotalBetThisHand
			} else {
				activeContributions = append(activeContributions, contribution{
					playerIdx: i,
					amount:    p.TotalBetThisHand,
					isAllIn:   p.Status == PlayerAllIn,
				})
			}
		}
	}

	if len(activeContributions) == 0 {
		if totalFromFolded > 0 {
			var eligible []int
			for i, p := range gs.Players {
				if p.Status != PlayerFolded && p.Status != PlayerEliminated {
					eligible = append(eligible, i)
				}
			}
			gs.Pots = []Pot{{Amount: totalFromFolded, EligiblePlayers: eligible}}
		} else {
			gs.Pots = []Pot{}
		}
		return
	}

	sort.Slice(activeContributions, func(i, j int) bool {
		return activeContributions[i].amount < activeContributions[j].amount
	})

	needsSidePots := false
	for i := 0; i < len(activeContributions)-1; i++ {
		if activeContributions[i].isAllIn && activeContributions[i].amount < activeContributions[i+1].amount {
			needsSidePots = true
			break
		}
	}

	if !needsSidePots {
		totalPot := totalFromFolded
		var eligible []int
		for _, c := range activeContributions {
			totalPot += c.amount
			eligible = append(eligible, c.playerIdx)
		}
		gs.Pots = []Pot{{Amount: totalPot, EligiblePlayers: eligible}}
		return
	}

	var pots []Pot
	prevLevel := 0

	for i := 0; i < len(activeContributions); i++ {
		currentLevel := activeContributions[i].amount
		if currentLevel == prevLevel {
			continue
		}

		levelDiff := currentLevel - prevLevel
		playersAtThisLevel := len(activeContributions) - i
		potAmount := levelDiff * playersAtThisLevel

		if i == 0 && totalFromFolded > 0 {
			potAmount += totalFromFolded
		}

		var eligible []int
		for j := i; j < len(activeContributions); j++ {
			eligible = append(eligible, activeContributions[j].playerIdx)
		}

		if potAmount > 0 && len(eligible) > 0 {
			pots = append(pots, Pot{
				Amount:          potAmount,
				EligiblePlayers: eligible,
			})
		}

		prevLevel = currentLevel
	}

	gs.Pots = pots
}

func (gs *GameState) SimplifiedPotCalculation() int {
	total := 0
	for _, p := range gs.Players {
		total += p.TotalBetThisHand
	}
	return total
}

func (gs *GameState) GetTotalPot() int {
	if len(gs.Pots) == 0 {
		return gs.SimplifiedPotCalculation()
	}

	total := 0
	for _, pot := range gs.Pots {
		total += pot.Amount
	}
	return total
}

func (gs *GameState) CollectBetsIntoPot() {
	for i := range gs.Players {
		gs.Players[i].CurrentBet = 0
	}
}

func (gs *GameState) AwardPots(communityCards []Card, evaluateFunc func([]Player, []Card, []int) []int) []Winner {
	if len(gs.Pots) == 0 {
		gs.CalculatePots()
	}

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

		splitAmount := pot.Amount / len(potWinners)
		remainder := pot.Amount % len(potWinners)
		eligible := make([]int, len(pot.EligiblePlayers))
		copy(eligible, pot.EligiblePlayers)

		for i, winnerIdx := range potWinners {
			amount := splitAmount
			if i == 0 { // Remainder to first winner
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

func (gs *GameState) AwardPotToLastPlayer() *Winner {
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

	return &Winner{
		PlayerIdx: lastPlayerIdx,
		Amount:    profit,
		HandDesc:  "uncontested",
	}
}

func (gs *GameState) ResetPotsForNewHand() {
	gs.Pots = []Pot{}
	for i := range gs.Players {
		gs.Players[i].TotalBetThisHand = 0
		gs.Players[i].CurrentBet = 0
	}
}
