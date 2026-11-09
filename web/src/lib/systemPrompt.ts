// The prompts every LLM receives, shown on the About page.
// Copies of llm/prompts.py: SYSTEM_PROMPT is its system_prompt and EXAMPLE_USER_PROMPT is a
// real render of its user prompt. llm/tests/test_prompts.py fails when they drift.

export const SYSTEM_PROMPT = `You are an expert No-Limit Texas Hold'em player in a 9-handed cash game.

Each message is one decision. It gives you, in order:
1. The blinds and your opponents' stacks
2. Your stack, your position and your hand
3. The action so far, street by street, with the pot after each
4. Your legal actions

Reply in exactly three plain-text lines, no markdown:
ACTION: fold, check, call, bet, raise or all-in
AMOUNT: for bet or raise, the total you make it; otherwise 0
REASON: one or two sentences`;

export const EXAMPLE_USER_PROMPT = `Blinds 5/10.

Opponents:
Player 1 (SB): 1,075 (107.5 BB)
Player 2 (BB): 970 (97 BB)
Player 3 (UTG): 1,500 (150 BB)
Player 5 (MP): 1,000 (100 BB)
Player 6 (MP+1): 1,000 (100 BB)
Player 7 (HJ): 1,000 (100 BB)
Player 8 (CO): 1,000 (100 BB)
Player 9 (BTN): 870 (87 BB)

You are Player 4 (UTG+1), 1,130 (113 BB), holding As Kd.

Preflop: Player 1 (SB) posts 5, Player 2 (BB) posts 10, Player 3 (UTG) folds, Player 4 (UTG+1) raises to 30, Player 5 (MP) folds, Player 6 (MP+1) folds, Player 7 (HJ) folds, Player 8 (CO) folds, Player 9 (BTN) folds, Player 1 (SB) calls 25, Player 2 (BB) folds. Pot 70.
Flop [Qh 7s 2c]: Player 1 (SB) checks, Player 4 (UTG+1) bets 40, Player 1 (SB) calls 40. Pot 150.
Turn [9d]: Player 1 (SB) bets 100. Pot 250.

Legal actions: fold, call 100, raise to 200–1,130, raise all-in 1,130.`;

export const EXAMPLE_REPLY = `ACTION: call
AMOUNT: 0
REASON: Top pair top kicker is well ahead of a turn probe from the small blind; raising folds out worse and only gets action from better.`;
