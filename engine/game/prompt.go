// Builds the text prompt an LLM sees when it is their turn: the current hand from the
// start (seats, every action on every street, the board) followed by that player's own
// cards and legal actions. Nothing from previous hands is included. Called by
// api/llm_handlers.go.
package game

import (
	"fmt"
	"strings"
)

func (gs *GameState) GetLLMPrompt(playerName string, validActions []LLMValidAction) string {
	playerIdx := -1
	for i, p := range gs.Players {
		if p.Name == playerName {
			playerIdx = i
			break
		}
	}
	if playerIdx < 0 {
		return ""
	}
	you := gs.Players[playerIdx]

	var b strings.Builder

	seated := gs.llmSeatOrder()
	fmt.Fprintf(&b, "Hand #%d. No Limit Texas Hold'em cash game, blinds %d/%d, %d players.\n\n",
		gs.HandNumber, gs.Stakes.SmallBlind, gs.Stakes.BigBlind, len(seated))

	b.WriteString("Seats (stack at start of hand):\n")
	for _, i := range seated {
		p := gs.Players[i]
		fmt.Fprintf(&b, "%s: %s (%d)\n", gs.getPositionName(i), p.Name, p.Stack+p.TotalBetThisHand)
	}
	b.WriteString("\n")

	b.WriteString(gs.llmActionLines())
	b.WriteString("\n")

	fmt.Fprintf(&b, "You are %s, in the %s. Your hole cards: %s.\n",
		you.Name, gs.getPositionName(playerIdx), strings.Join(gs.GetLLMHoleCards(playerIdx), " "))
	fmt.Fprintf(&b, "Pot: %d. To call: %d. Your stack: %d.\n",
		gs.SimplifiedPotCalculation(), max(gs.CurrentBet-you.CurrentBet, 0), you.Stack)

	var others []string
	for _, i := range seated {
		p := gs.Players[i]
		if i == playerIdx {
			continue
		}
		if p.Status == PlayerActive {
			others = append(others, fmt.Sprintf("%s (%s, %d behind)", p.Name, gs.getPositionName(i), p.Stack))
		} else if p.Status == PlayerAllIn {
			others = append(others, fmt.Sprintf("%s (%s, all-in)", p.Name, gs.getPositionName(i)))
		}
	}
	fmt.Fprintf(&b, "Still in the hand: %s.\n\n", strings.Join(others, ", "))

	b.WriteString("Legal actions:\n")
	for _, va := range validActions {
		switch va.Type {
		case "CALL":
			fmt.Fprintf(&b, "- CALL %d\n", va.Amount)
		case "BET", "RAISE":
			fmt.Fprintf(&b, "- %s: AMOUNT is your total bet this street, between %d and %d\n", va.Type, va.Min, va.Max)
		case "ALL-IN":
			fmt.Fprintf(&b, "- ALL_IN (%d total this street)\n", va.Amount)
		default:
			fmt.Fprintf(&b, "- %s\n", va.Type)
		}
	}

	return b.String()
}

// llmSeatOrder returns the indices of players dealt into this hand, small blind first
// and button last.
func (gs *GameState) llmSeatOrder() []int {
	var order []int
	for i := 1; i <= len(gs.Players); i++ {
		idx := (gs.ButtonIdx + i) % len(gs.Players)
		if len(gs.Players[idx].HoleCards) > 0 {
			order = append(order, idx)
		}
	}
	return order
}

// llmActionLines writes one line per street, from preflop up to the current street.
func (gs *GameState) llmActionLines() string {
	streets := []Street{StreetPreflop, StreetFlop, StreetTurn, StreetRiver}
	boardSize := map[Street]int{StreetFlop: 3, StreetTurn: 4, StreetRiver: 5}

	var b strings.Builder
	pot := 0
	next := 0
	for _, street := range streets {
		if street > gs.Street {
			break
		}

		title := strings.ToUpper(street.String()[:1]) + street.String()[1:]
		if n := boardSize[street]; n > 0 && len(gs.CommunityCards) >= n {
			cards := gs.GetLLMCommunityCards()[:n]
			fmt.Fprintf(&b, "%s [%s] (pot %d): ", title, strings.Join(cards, " "), pot)
		} else {
			fmt.Fprintf(&b, "%s: ", title)
		}

		var parts []string
		streetBet := 0
		blindsPosted := 0
		for next < len(gs.LLMActionsThisHand) && gs.LLMActionsThisHand[next].Street == street.String() {
			a := gs.LLMActionsThisHand[next]
			switch a.Action {
			case "post":
				blind := "small blind"
				if blindsPosted > 0 {
					blind = "big blind"
				}
				blindsPosted++
				parts = append(parts, fmt.Sprintf("%s posts %s %d", a.Player, blind, a.Amount))
			case "FOLD":
				parts = append(parts, a.Player+" folds")
			case "CHECK":
				parts = append(parts, a.Player+" checks")
			case "CALL":
				parts = append(parts, fmt.Sprintf("%s calls %d", a.Player, a.Amount))
			case "RAISE":
				if streetBet == 0 {
					parts = append(parts, fmt.Sprintf("%s bets %d", a.Player, a.Amount))
				} else {
					parts = append(parts, fmt.Sprintf("%s raises to %d", a.Player, a.Amount))
				}
			case "ALL-IN":
				parts = append(parts, fmt.Sprintf("%s goes all-in for %d", a.Player, a.Amount))
			}
			if a.Action != "CALL" {
				streetBet = max(streetBet, a.Amount)
			}
			pot = a.Pot
			next++
		}

		if len(parts) == 0 {
			b.WriteString("no action yet")
		} else {
			b.WriteString(strings.Join(parts, ", "))
		}
		b.WriteString("\n")
	}
	return b.String()
}
