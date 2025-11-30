// Package game implements a No Limit Texas Hold'em poker engine.
// See individual file headers for organization.
//
// Basic usage:
//
//	gs := game.NewGame(game.GameConfig{
//	    PlayerNames:   []string{"Alice", "Bob", "Charlie"},
//	    StartingStack: 2000,
//	    Stakes:        game.Stakes{SmallBlind: 5, BigBlind: 10},
//	    Mode:          game.ModeSimulate,
//	})
//	gs.StartHand()
//	gs.ProcessAction(game.Action{Type: game.ActionCall, Amount: 10})
package game
