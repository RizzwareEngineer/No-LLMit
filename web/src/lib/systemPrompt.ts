// The prompts every LLM receives, shown on the About page.
// Copies of llm/prompts.py: SYSTEM_PROMPT is its system_prompt and EXAMPLE_USER_PROMPT is a
// real render of its user prompt. llm/tests/test_prompts.py fails when they drift.

export const SYSTEM_PROMPT = `You are playing No-Limit Texas Hold'em, a 9-handed cash game.

RULES
- Amounts are chips, with big blinds (BB) in parentheses.
- Cards: rank 2-9, T, J, Q, K, A, then suit h, d, c, s.
- Seats are listed clockwise from the small blind.
- Pot includes this street's bets.
- "calls N" = chips added; "bets N", "raises to N", "all-in for N" = that player's street total.
- A raise must be at least the size of the last bet or raise.
- Short of a full call, CALL is all-in; you win from each opponent at most what you put in.
- You see only this hand: no earlier hands, opponent notes or earlier reasoning.
- An invalid reply comes back to you once with the reason; after a second, you check if free, else fold.

Reply in exactly three plain-text lines, no markdown:
ACTION: one legal action (FOLD, CHECK, CALL, BET, RAISE, ALL_IN)
AMOUNT: for BET or RAISE, your street total in chips, digits only; else 0
REASON: one or two sentences`;

export const EXAMPLE_USER_PROMPT = `Blinds 5/10 (1 BB = 10 chips).

Seats, current stacks:
Player 8 (SB): 1930 (193 BB)
Player 9 (BB): 1970 (197 BB)
Player 1 (UTG): 2057 (205.7 BB)
Player 2 (UTG+1): 2000 (200 BB)
Player 3 (MP): 2000 (200 BB)
Player 4 (MP+1): 2000 (200 BB)
Player 5 (HJ): 2000 (200 BB)
Player 6 (CO): 1990 (199 BB)
Player 7 (BTN): 1925 (192.5 BB)

Preflop: Player 8 (SB) posts small blind 5 (0.5 BB), Player 9 (BB) posts big blind 10 (1 BB), Player 1 (UTG) folds, Player 2 (UTG+1) folds, Player 3 (MP) folds, Player 4 (MP+1) folds, Player 5 (HJ) folds, Player 6 (CO) folds, Player 7 (BTN) raises to 30 (3 BB), Player 8 (SB) calls 25 (2.5 BB), Player 9 (BB) calls 20 (2 BB)
Flop [Ah 7d 2c], pot 90 (9 BB): Player 8 (SB) checks, Player 9 (BB) checks, Player 7 (BTN) bets 40 (4 BB), Player 8 (SB) folds

You are Player 9 (BB). Your hole cards: Ad Tc.
Pot: 130 (13 BB). To call: 40 (4 BB). Your stack: 1970 (197 BB).

Legal actions:
- FOLD
- CALL 40 (4 BB)
- RAISE 80 to 1970 (8 to 197 BB)
- ALL_IN`;

export const EXAMPLE_REPLY = `ACTION: CALL
AMOUNT: 0
REASON: Top pair with a decent kicker against a button bet; calling keeps worse aces and bluffs in.`;
