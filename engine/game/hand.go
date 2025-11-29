package game

import (
	"fmt"
	"sort"
)

// HandType represents the type of poker hand
type HandType int

const (
	HighCard HandType = iota
	OnePair
	TwoPair
	ThreeOfAKind
	Straight
	Flush
	FullHouse
	FourOfAKind
	StraightFlush
	RoyalFlush
)

func (ht HandType) String() string {
	return []string{
		"High Card",
		"One Pair",
		"Two Pair",
		"Three of a Kind",
		"Straight",
		"Flush",
		"Full House",
		"Four of a Kind",
		"Straight Flush",
		"Royal Flush",
	}[ht]
}

// HandResult represents the result of evaluating a player's hand
type HandResult struct {
	HandType  HandType `json:"handType"`
	HandRank  int      `json:"handRank"`  // Overall rank (higher is better)
	Kickers   []Rank   `json:"kickers"`   // Kickers for tie-breaking
	BestCards []Card   `json:"bestCards"` // The 5 cards that make the hand
	PlayerIdx int      `json:"playerIdx"`
}

// Debug flag - set to true to enable logging
var EvaluatorDebug = false

// Hand type base values - each hand type has a base that's higher than the max of the type below it
// This ensures any pair beats any high card, any two pair beats any pair, etc.
const (
	baseHighCard      = 0
	baseOnePair       = 100000000 // 10^8
	baseTwoPair       = 200000000 // 2 * 10^8
	baseThreeOfAKind  = 300000000 // 3 * 10^8
	baseStraight      = 400000000 // 4 * 10^8
	baseFlush         = 500000000 // 5 * 10^8
	baseFullHouse     = 600000000 // 6 * 10^8
	baseFourOfAKind   = 700000000 // 7 * 10^8
	baseStraightFlush = 800000000 // 8 * 10^8
	baseRoyalFlush    = 900000000 // 9 * 10^8
)

// EvaluateHand evaluates 7 cards (2 hole + 5 community) and returns the best 5-card hand
func EvaluateHand(cards []Card) HandResult {
	if len(cards) < 5 {
		return HandResult{}
	}

	// Generate all 5-card combinations from the cards
	var bestResult HandResult
	bestResult.HandRank = -1

	combinations := generateCombinations(cards, 5)
	for _, combo := range combinations {
		result := evaluate5Cards(combo)
		if result.HandRank > bestResult.HandRank {
			bestResult = result
		} else if result.HandRank == bestResult.HandRank {
			// Compare kickers
			if compareKickers(result.Kickers, bestResult.Kickers) > 0 {
				bestResult = result
			}
		}
	}

	return bestResult
}

// evaluate5Cards evaluates exactly 5 cards
func evaluate5Cards(cards []Card) HandResult {
	// Sort cards by rank (descending)
	sorted := make([]Card, len(cards))
	copy(sorted, cards)
	sort.Slice(sorted, func(i, j int) bool {
		return sorted[i].Rank > sorted[j].Rank
	})

	isFlush := checkFlush(sorted)
	isStraight, straightHigh := checkStraight(sorted)
	rankCounts := countRanks(sorted)

	result := HandResult{
		BestCards: sorted,
	}

	// Check for each hand type (highest to lowest)
	if isFlush && isStraight {
		if straightHigh == Ace {
			result.HandType = RoyalFlush
			result.HandRank = baseRoyalFlush + int(straightHigh)
		} else {
			result.HandType = StraightFlush
			result.HandRank = baseStraightFlush + int(straightHigh)
		}
		result.Kickers = []Rank{straightHigh}
		return result
	}

	// Four of a kind
	if quad := findNOfAKind(rankCounts, 4); quad != 0 {
		kicker := findHighestExcluding(sorted, quad)
		result.HandType = FourOfAKind
		result.HandRank = baseFourOfAKind + int(quad)*100 + int(kicker)
		result.Kickers = []Rank{quad, kicker}
		return result
	}

	// Full house
	trips := findNOfAKind(rankCounts, 3)
	pair := findNOfAKind(rankCounts, 2)
	if trips != 0 && pair != 0 {
		result.HandType = FullHouse
		result.HandRank = baseFullHouse + int(trips)*100 + int(pair)
		result.Kickers = []Rank{trips, pair}
		return result
	}

	// Flush
	if isFlush {
		result.HandType = Flush
		result.HandRank = baseFlush + rankScore(sorted)
		result.Kickers = getRanks(sorted)
		return result
	}

	// Straight
	if isStraight {
		result.HandType = Straight
		result.HandRank = baseStraight + int(straightHigh)
		result.Kickers = []Rank{straightHigh}
		return result
	}

	// Three of a kind
	if trips != 0 {
		kickers := findKickersExcluding(sorted, trips, 2)
		result.HandType = ThreeOfAKind
		result.HandRank = baseThreeOfAKind + int(trips)*10000 + kickerScore(kickers)
		result.Kickers = append([]Rank{trips}, kickers...)
		return result
	}

	// Two pair
	pairs := findAllPairs(rankCounts)
	if len(pairs) >= 2 {
		highPair := pairs[0]
		lowPair := pairs[1]
		kicker := findHighestExcludingMultiple(sorted, []Rank{highPair, lowPair})
		result.HandType = TwoPair
		result.HandRank = baseTwoPair + int(highPair)*10000 + int(lowPair)*100 + int(kicker)
		result.Kickers = []Rank{highPair, lowPair, kicker}
		return result
	}

	// One pair
	if pair != 0 {
		kickers := findKickersExcluding(sorted, pair, 3)
		result.HandType = OnePair
		result.HandRank = baseOnePair + int(pair)*1000000 + kickerScore(kickers)
		result.Kickers = append([]Rank{pair}, kickers...)
		return result
	}

	// High card
	result.HandType = HighCard
	result.HandRank = baseHighCard + rankScore(sorted)
	result.Kickers = getRanks(sorted)
	return result
}

// CompareHands compares two hand results, returns 1 if a wins, -1 if b wins, 0 if tie
func CompareHands(a, b HandResult) int {
	if a.HandRank > b.HandRank {
		return 1
	}
	if a.HandRank < b.HandRank {
		return -1
	}
	return compareKickers(a.Kickers, b.Kickers)
}

// FindWinners determines the winner(s) among active players
func FindWinners(players []Player, communityCards []Card, eligibleIndices []int) []int {
	if len(eligibleIndices) == 0 {
		return nil
	}

	if EvaluatorDebug {
		fmt.Println("\n========== SHOWDOWN DEBUG ==========")
		fmt.Printf("Community cards: ")
		for _, c := range communityCards {
			fmt.Printf("%s ", c.String())
		}
		fmt.Println()
		fmt.Printf("Eligible players: %v\n", eligibleIndices)
	}

	type playerHand struct {
		idx    int
		result HandResult
	}

	var hands []playerHand
	for _, idx := range eligibleIndices {
		if players[idx].Status == PlayerFolded || players[idx].Status == PlayerEliminated {
			if EvaluatorDebug {
				fmt.Printf("Player %d (%s) - SKIPPED (status: %s)\n", idx, players[idx].Name, players[idx].Status)
			}
			continue
		}
		allCards := append([]Card{}, players[idx].HoleCards...)
		allCards = append(allCards, communityCards...)

		if EvaluatorDebug {
			fmt.Printf("\nPlayer %d (%s):\n", idx, players[idx].Name)
			fmt.Printf("  Hole cards: ")
			for _, c := range players[idx].HoleCards {
				fmt.Printf("%s ", c.String())
			}
			fmt.Println()
			fmt.Printf("  All 7 cards: ")
			for _, c := range allCards {
				fmt.Printf("%s ", c.String())
			}
			fmt.Println()
		}

		result := EvaluateHand(allCards)
		result.PlayerIdx = idx

		if EvaluatorDebug {
			fmt.Printf("  Hand: %s (rank: %d)\n", result.HandType.String(), result.HandRank)
			fmt.Printf("  Kickers: %v\n", result.Kickers)
		}

		hands = append(hands, playerHand{idx: idx, result: result})
	}

	if len(hands) == 0 {
		return nil
	}

	// Find the best hand(s)
	sort.Slice(hands, func(i, j int) bool {
		return CompareHands(hands[i].result, hands[j].result) > 0
	})

	if EvaluatorDebug {
		fmt.Println("\nRanked hands:")
		for i, h := range hands {
			fmt.Printf("  %d. Player %d (%s): %s (rank: %d)\n", i+1, h.idx, players[h.idx].Name, h.result.HandType.String(), h.result.HandRank)
		}
	}

	// Get all players with the best hand (for split pots)
	winners := []int{hands[0].idx}
	for i := 1; i < len(hands); i++ {
		if CompareHands(hands[i].result, hands[0].result) == 0 {
			winners = append(winners, hands[i].idx)
		} else {
			break
		}
	}

	if EvaluatorDebug {
		fmt.Printf("\nWinners: %v\n", winners)
		fmt.Println("=====================================\n")
	}

	return winners
}

// GetHandDescription returns a human-readable description of a hand
func GetHandDescription(result HandResult) string {
	switch result.HandType {
	case RoyalFlush:
		return "Royal Flush"
	case StraightFlush:
		return "Straight Flush, " + result.Kickers[0].String() + " high"
	case FourOfAKind:
		return "Four of a Kind, " + rankName(result.Kickers[0]) + "s"
	case FullHouse:
		return "Full House, " + rankName(result.Kickers[0]) + "s full of " + rankName(result.Kickers[1]) + "s"
	case Flush:
		return "Flush, " + result.Kickers[0].String() + " high"
	case Straight:
		return "Straight, " + result.Kickers[0].String() + " high"
	case ThreeOfAKind:
		return "Three of a Kind, " + rankName(result.Kickers[0]) + "s"
	case TwoPair:
		return "Two Pair, " + rankName(result.Kickers[0]) + "s and " + rankName(result.Kickers[1]) + "s"
	case OnePair:
		return "Pair of " + rankName(result.Kickers[0]) + "s"
	default:
		if len(result.Kickers) > 0 {
			return result.Kickers[0].String() + " high"
		}
		return "Unknown"
	}
}

// Helper functions

func rankName(r Rank) string {
	switch r {
	case Ace:
		return "Ace"
	case King:
		return "King"
	case Queen:
		return "Queen"
	case Jack:
		return "Jack"
	case Ten:
		return "Ten"
	default:
		return r.String()
	}
}

func rankScore(cards []Card) int {
	score := 0
	for i, c := range cards {
		score += int(c.Rank) * pow(15, 4-i)
	}
	return score
}

func kickerScore(kickers []Rank) int {
	score := 0
	for i, k := range kickers {
		score += int(k) * pow(15, len(kickers)-1-i)
	}
	return score
}

func checkFlush(cards []Card) bool {
	suit := cards[0].Suit
	for _, c := range cards[1:] {
		if c.Suit != suit {
			return false
		}
	}
	return true
}

func checkStraight(cards []Card) (bool, Rank) {
	ranks := getRanks(cards)
	sort.Slice(ranks, func(i, j int) bool {
		return ranks[i] > ranks[j]
	})

	// Remove duplicates
	unique := []Rank{ranks[0]}
	for i := 1; i < len(ranks); i++ {
		if ranks[i] != ranks[i-1] {
			unique = append(unique, ranks[i])
		}
	}

	if len(unique) < 5 {
		return false, 0
	}

	// Check for regular straight
	for i := 0; i <= len(unique)-5; i++ {
		if unique[i]-unique[i+4] == 4 {
			return true, unique[i]
		}
	}

	// Check for wheel (A-2-3-4-5)
	if unique[0] == Ace && unique[len(unique)-1] == Two {
		has2, has3, has4, has5 := false, false, false, false
		for _, r := range unique {
			switch r {
			case Two:
				has2 = true
			case Three:
				has3 = true
			case Four:
				has4 = true
			case Five:
				has5 = true
			}
		}
		if has2 && has3 && has4 && has5 {
			return true, Five // 5-high straight
		}
	}

	return false, 0
}

func countRanks(cards []Card) map[Rank]int {
	counts := make(map[Rank]int)
	for _, c := range cards {
		counts[c.Rank]++
	}
	return counts
}

func findNOfAKind(counts map[Rank]int, n int) Rank {
	var best Rank
	for rank, count := range counts {
		if count == n && rank > best {
			best = rank
		}
	}
	return best
}

func findAllPairs(counts map[Rank]int) []Rank {
	var pairs []Rank
	for rank, count := range counts {
		if count == 2 {
			pairs = append(pairs, rank)
		}
	}
	sort.Slice(pairs, func(i, j int) bool {
		return pairs[i] > pairs[j]
	})
	return pairs
}

func findHighestExcluding(cards []Card, exclude Rank) Rank {
	for _, c := range cards {
		if c.Rank != exclude {
			return c.Rank
		}
	}
	return 0
}

func findHighestExcludingMultiple(cards []Card, exclude []Rank) Rank {
	excludeMap := make(map[Rank]bool)
	for _, r := range exclude {
		excludeMap[r] = true
	}
	for _, c := range cards {
		if !excludeMap[c.Rank] {
			return c.Rank
		}
	}
	return 0
}

func findKickersExcluding(cards []Card, exclude Rank, n int) []Rank {
	var kickers []Rank
	for _, c := range cards {
		if c.Rank != exclude && len(kickers) < n {
			found := false
			for _, k := range kickers {
				if k == c.Rank {
					found = true
					break
				}
			}
			if !found {
				kickers = append(kickers, c.Rank)
			}
		}
	}
	return kickers
}

func getRanks(cards []Card) []Rank {
	ranks := make([]Rank, len(cards))
	for i, c := range cards {
		ranks[i] = c.Rank
	}
	return ranks
}

func pow(base, exp int) int {
	result := 1
	for i := 0; i < exp; i++ {
		result *= base
	}
	return result
}

func generateCombinations(cards []Card, n int) [][]Card {
	var result [][]Card
	var helper func(start int, combo []Card)

	helper = func(start int, combo []Card) {
		if len(combo) == n {
			cpy := make([]Card, n)
			copy(cpy, combo)
			result = append(result, cpy)
			return
		}
		for i := start; i < len(cards); i++ {
			helper(i+1, append(combo, cards[i]))
		}
	}

	helper(0, []Card{})
	return result
}

func compareKickers(a, b []Rank) int {
	for i := 0; i < len(a) && i < len(b); i++ {
		if a[i] > b[i] {
			return 1
		}
		if a[i] < b[i] {
			return -1
		}
	}
	return 0
}
