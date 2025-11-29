package game

import "sort"

// Pot represents a pot (main or side)
type Pot struct {
	Amount          int   `json:"amount"`
	EligiblePlayers []int `json:"eligiblePlayers"` // Indices of players who can win this pot
	ContributedBy   []int `json:"contributedBy"`   // How much each player contributed
}

// Winner represents a winner of a pot
type Winner struct {
	PlayerIdx       int      `json:"playerIdx"`
	Amount          int      `json:"amount"`
	HandType        HandType `json:"handType"`
	HandDesc        string   `json:"handDesc"`        // e.g., "Full House, Kings over Aces"
	EligiblePlayers []int    `json:"eligiblePlayers"` // Players who were competing for this pot
	PotNumber       int      `json:"potNumber"`       // 1 = main pot, 2+ = side pots
}

// CalculatePots calculates the main pot and any side pots
// Side pots are only created when players go all-in for different amounts
func (gs *GameState) CalculatePots() {
	// Get all contributions from active (non-folded) players, sorted by amount
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
				// Folded players' money goes into pot but they can't win
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
		// Everyone folded except winner - just one pot
		if totalFromFolded > 0 {
			// Find any remaining player
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

	// Sort by contribution amount (ascending) to handle side pots
	sort.Slice(activeContributions, func(i, j int) bool {
		return activeContributions[i].amount < activeContributions[j].amount
	})

	// Check if we need side pots (only if someone is all-in for less than others)
	needsSidePots := false
	for i := 0; i < len(activeContributions)-1; i++ {
		if activeContributions[i].isAllIn && activeContributions[i].amount < activeContributions[i+1].amount {
			needsSidePots = true
			break
		}
	}

	if !needsSidePots {
		// Simple case: one main pot with all money
		totalPot := totalFromFolded
		var eligible []int
		for _, c := range activeContributions {
			totalPot += c.amount
			eligible = append(eligible, c.playerIdx)
		}
		gs.Pots = []Pot{{Amount: totalPot, EligiblePlayers: eligible}}
		return
	}

	// Complex case: need to calculate side pots
	var pots []Pot
	prevLevel := 0

	for i := 0; i < len(activeContributions); i++ {
		currentLevel := activeContributions[i].amount
		if currentLevel == prevLevel {
			continue
		}

		levelDiff := currentLevel - prevLevel

		// Calculate pot amount: (levelDiff * number of players at or above this level) + proportional folded money
		playersAtThisLevel := len(activeContributions) - i
		potAmount := levelDiff * playersAtThisLevel

		// Add proportional amount from folded players for first pot
		if i == 0 && totalFromFolded > 0 {
			potAmount += totalFromFolded
		}

		// All active players at or above this level are eligible
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

// SimplifiedPotCalculation - for simpler cases, just sum all bets into main pot
func (gs *GameState) SimplifiedPotCalculation() int {
	total := 0
	for _, p := range gs.Players {
		total += p.TotalBetThisHand
	}
	return total
}

// GetTotalPot returns the total amount in all pots
func (gs *GameState) GetTotalPot() int {
	// If pots haven't been calculated yet, sum up all bets
	if len(gs.Pots) == 0 {
		return gs.SimplifiedPotCalculation()
	}

	total := 0
	for _, pot := range gs.Pots {
		total += pot.Amount
	}
	return total
}

// CollectBetsIntoPot moves current round bets into the pot
// Called at the end of each betting round
func (gs *GameState) CollectBetsIntoPot() {
	// For now, we track TotalBetThisHand and calculate pots at showdown
	// This just resets the current round bets
	for i := range gs.Players {
		gs.Players[i].CurrentBet = 0
	}
}

// AwardPots awards pot(s) to winner(s)
// Returns a slice of Winner structs
func (gs *GameState) AwardPots(communityCards []Card, evaluateFunc func([]Player, []Card, []int) []int) []Winner {
	if len(gs.Pots) == 0 {
		gs.CalculatePots()
	}

	var winners []Winner

	// Track how much each player wins this hand (for profit calculation)
	amountWon := make(map[int]int)

	// Separate counter for displayed pot numbers (skips uncalled bet pots)
	displayPotNumber := 0

	for _, pot := range gs.Pots {
		if len(pot.EligiblePlayers) == 0 {
			continue
		}

		// If only one player is eligible, it's an uncalled bet - just return it
		if len(pot.EligiblePlayers) == 1 {
			playerIdx := pot.EligiblePlayers[0]
			gs.Players[playerIdx].Stack += pot.Amount
			amountWon[playerIdx] += pot.Amount
			// Don't add to winners list or increment display number - it's just returning their uncalled bet
			continue
		}

		// This is a contested pot - increment display number
		displayPotNumber++

		// Find winners for this pot
		potWinners := evaluateFunc(gs.Players, communityCards, pot.EligiblePlayers)
		if len(potWinners) == 0 {
			continue
		}

		// Split the pot among winners
		splitAmount := pot.Amount / len(potWinners)
		remainder := pot.Amount % len(potWinners)

		// Copy eligible players to avoid nil issues
		eligible := make([]int, len(pot.EligiblePlayers))
		copy(eligible, pot.EligiblePlayers)

		for i, winnerIdx := range potWinners {
			amount := splitAmount
			// Give remainder to first winner (closest to button)
			if i == 0 {
				amount += remainder
			}

			gs.Players[winnerIdx].Stack += amount
			amountWon[winnerIdx] += amount

			winners = append(winners, Winner{
				PlayerIdx:       winnerIdx,
				Amount:          amount,
				EligiblePlayers: eligible,
				PotNumber:       displayPotNumber, // Use display counter, not array index
			})
		}
	}

	// Calculate and record actual PROFIT for each player (won - contributed)
	for playerIdx, won := range amountWon {
		contributed := gs.Players[playerIdx].TotalBetThisHand
		profit := won - contributed
		gs.Players[playerIdx].Winnings += profit
	}

	// Also record losses for players who didn't win anything
	for i := range gs.Players {
		if _, won := amountWon[i]; !won && gs.Players[i].TotalBetThisHand > 0 {
			// This player contributed but won nothing - record the loss
			gs.Players[i].Winnings -= gs.Players[i].TotalBetThisHand
		}
	}

	return winners
}

// AwardPotToLastPlayer awards the pot to the last remaining player (everyone else folded)
func (gs *GameState) AwardPotToLastPlayer() *Winner {
	// Find the last active player
	lastPlayerIdx := -1
	for i, p := range gs.Players {
		if p.Status == PlayerActive || p.Status == PlayerAllIn {
			if lastPlayerIdx != -1 {
				// More than one player remaining, shouldn't use this method
				return nil
			}
			lastPlayerIdx = i
		}
	}

	if lastPlayerIdx == -1 {
		return nil
	}

	totalPot := gs.SimplifiedPotCalculation()
	playerContribution := gs.Players[lastPlayerIdx].TotalBetThisHand
	profit := totalPot - playerContribution // Actual profit (pot minus what they put in)

	gs.Players[lastPlayerIdx].Stack += totalPot
	gs.Players[lastPlayerIdx].Winnings += profit // Only count PROFIT, not total pot

	return &Winner{
		PlayerIdx: lastPlayerIdx,
		Amount:    profit, // Show profit, not total pot
		HandDesc:  "uncontested",
	}
}

// ResetPotsForNewHand clears pot state for a new hand
func (gs *GameState) ResetPotsForNewHand() {
	gs.Pots = []Pot{}
	for i := range gs.Players {
		gs.Players[i].TotalBetThisHand = 0
		gs.Players[i].CurrentBet = 0
	}
}
