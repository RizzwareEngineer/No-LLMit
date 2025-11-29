// Package game implements a No Limit Texas Hold'em poker engine.
//
// The core types are GameState, Player, and Card. GameState holds the complete
// state of a poker game including players, community cards, pots, and betting state.
//
// # Basic Usage
//
//	config := game.GameConfig{
//	    PlayerNames:   []string{"Alice", "Bob", "Charlie"},
//	    StartingStack: 2000,
//	    Stakes:        game.Stakes{SmallBlind: 5, BigBlind: 10},
//	    Mode:          game.ModeSimulate,
//	}
//	gs := game.NewGame(config)
//	gs.StartHand()
//
//	// Process player actions
//	action := game.Action{Type: game.ActionCall, Amount: 10}
//	gs.ProcessAction(action)
//
// # Package Organization
//
//   - card.go: Card, Suit, Rank types
//   - deck.go: Deck operations (shuffle, deal)
//   - player.go: Player and Action types
//   - hand.go: Hand evaluation and comparison
//   - action.go: Betting round logic
//   - pot.go: Pot calculation and awarding
//   - game.go: GameState and main game flow
package game
