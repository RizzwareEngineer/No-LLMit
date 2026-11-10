# No-LLMit engine: rules and correctness audit

This was a read-only review. No repo files were changed.
I wrote the tests in a scratch copy of the engine:
- `/private/tmp/claude-501/-Users-rizzwareengineer/9e855f1b-560f-48a1-9090-bd698d74fc31/scratchpad/audit/eng/game/audit_test.go`
- `/private/tmp/claude-501/-Users-rizzwareengineer/9e855f1b-560f-48a1-9090-bd698d74fc31/scratchpad/audit/eng/api/audit_test.go`

To run them: `cd .../scratchpad/audit/eng && go test ./game ./api -run Audit -v`.
The failing tests are the confirmed bugs.

## Confirmed

### 1. An LLM's ALL_IN is applied as a FOLD and recorded as status "ok" (bug, critical)
**Where:** `engine/api/messages.go:248` and `llm/parsing.py:39-41`.

**What happens:** `parse_response` turns every all-in spelling into `"ALL_IN"`, and the prompt also tells models to write `ALL_IN` (`game/prompt.go:68`, `llm/prompts.py:29`).
`ParseActionType` only accepts `"ALL-IN"`, `"all-in"` and `"allin"`, and anything else falls to `default: return game.ActionFold`.
A FOLD is always legal, so `ProcessAction` succeeds, `illegal` stays false, and the hand record saves `parsed=ALL_IN applied=FOLD status=ok`.

**Effect:**
- No model can ever shove.
- A model facing a bet of its whole stack or more can never call. `GetValidActions` leaves out CALL in that spot (`action.go:35`) and offers only ALL_IN, which then folds.
- The mock provider hits this too (`providers/mock.py:25`).
- The saved data hides it: these folds look like the model's own choice.

The parser makes it worse. `ACTION:\s*(\w+)` reads `ALL-IN` and `ALL IN` as `ALL`, which becomes an "unparseable" FOLD. Only `ALL_IN` or `ALLIN` survive parsing, and the engine then drops those.

**Test:** `TestAuditAllInSpelling` (`ParseActionType("ALL_IN") = FOLD`) and `TestAuditAllInReplyIsRecordedAsOkFold` (`parsed=ALL_IN applied=FOLD status=ok`).

**Smallest fix:**
- Add `"ALL_IN"` to the case at `messages.go:248`.
- In `parsing.py:12`, use `r"ACTION:\s*(ALL[\s_-]?IN|\w+)"`, then map that to `ALL_IN` with the existing `.replace("-", "_")` plus `.replace(" ", "_")`.
- Make `default:` in `ParseActionType` produce something the caller marks as illegal, not a silent FOLD.

### 2. A folded player's chips above a short all-in go into the main pot (bug, high)
**Where:** `engine/game/pot.go:32-44` and `pot.go:99-101`.

**What happens:** `CalculatePots` adds up every folded contribution as `totalFromFolded` and puts all of it into the first (lowest) pot.
A folded player who put in more than the short all-in amount should split their chips across levels: up to the all-in amount goes to the main pot, and the rest goes to the side pot(s).

**Example:** C is all-in for 50. A and B each put in 200, then B folds on the flop.
- Correct: the main pot is 150 (50 × 3), and the side pot is 300 for A.
- The engine makes a main pot of 300 (C eligible) and a side pot of 150.
- If C wins, C collects 150 chips it never covered.

This is common in multiway pots with one short stack. It also skews `Winnings`, the saved `pots`, and `net`.

**Test:** `TestAuditFoldedExcessGoesToSidePot` (pots: `[{300 [2 0]} {150 [0]}]`).

**Smallest fix:** keep folded contributions per player instead of one total.
For each level `(prev, cur]`, add `min(f, cur) - min(f, prev)` for each folded contribution `f`.
Then delete the `i == 0 && totalFromFolded` branch.

### 3. An all-in that is less than a full raise reopens raising (rule deviation, high)
**Where:** `engine/game/action.go:193-201` (`processAllIn`), `action.go:38-47` (`GetValidActions`), and `action.go:144-179` (`processRaise`).

**What happens:** whenever an all-in goes above the current bet, `resetActedExcept` runs, even when the raise is below `MinRaise`.
Players who already acted get to act again, which is correct because they must call the extra or fold.
But nothing stops them from re-raising, and `GetValidActions` offers RAISE.
Under the standard (TDA) rule, an incomplete raise does not reopen betting for players who already acted. They may only call or fold.

**Example:** A raises to 100, B calls, and C goes all-in to 150, a raise of only 50. A is then offered RAISE (min 240), and the engine accepts A's re-raise to 400.

**Test:** `TestAuditShortAllInDoesNotReopen`.

**Smallest fix:**
- Add a per-player `RaiseClosed bool`.
- In `processAllIn`, when `raiseAmount < MinRaise`, set `RaiseClosed = HasActedThisRound` for each active player before resetting them.
- Clear it on any full raise and in `ResetBettingRound`.
- When `RaiseClosed` is set, leave RAISE out of `GetValidActions` and offer ALL-IN only if stack ≤ amount to call. Reject the raise in `processRaise` and `processAllIn` too.

Separate edge case: several short all-ins that add up to a full raise should reopen betting. The engine never tracks that.

### 4. Heads-up, the button posts the big blind and has position on every street (rule deviation, medium)
**Where:** `engine/game/game.go:205-207` (`postBlinds`) and `action.go:301-321` (`GetFirstToAct`).

**What happens:** the small blind is always the next seat after the button.
Heads-up, that makes the non-button the small blind and the button the big blind.
The non-button then acts first preflop and also first postflop, so the button has position on every street and has the BB option.
The correct rule: the button posts the SB and acts first preflop, and the BB acts first postflop.
`getPositionName` (`game.go:479-481`) labels seats the same wrong way: the non-button shows as "SB".

**Practical reach:** the shared 9-seat table rebuys every broke player, so it never goes heads-up. This affects private and 2-player games, and any future table size of 2.

**Test:** `TestAuditHeadsUpBlinds` (`button=0 posts 10, firstToAct=1`).

**Smallest fix:**
- In `postBlinds` and in the preflop branch of `GetFirstToAct`, when exactly 2 players are dealt in, set `sbIdx = ButtonIdx`.
- In `getPositionName`, map heads-up distance 1 to "BB".

### 5. An illegal LLM action always becomes a FOLD, even when checking is free (rule deviation / risk, medium)
**Where:** `engine/api/table.go:550-554` and `api/llm_handlers.go:131-136`.

**What happens:** any `ProcessAction` error is replaced with a fold. Errors come from:
- a raise below the minimum, often because the model sent the raise increment instead of the total
- a raise above its stack
- CALL when there is nothing to call
- the parser turning `AMOUNT: 1,200` into 1, or `$120` into 0

So a big blind who could check gives up its hand.

**Test:** `TestAuditIllegalRaiseFoldsWhenCheckFree`: the BB was limped to and sent `RAISE 15`, and the record shows `applied=FOLD status=illegal`.

**Smallest fix:** in the fallback, apply CHECK if it is legal, otherwise FOLD.
Optionally clamp RAISE amounts into `[min, max]`, with amounts over max becoming ALL-IN, and keep `status=illegal` in the record.

Amounts are consistent end to end:
- The prompt, the system prompt, the parser and `processRaise` all treat a raise amount as the total bet this street.
- CALL's displayed amount is the amount added, and the engine ignores the amount for CALL and ALL-IN.
- BET is mapped to RAISE in Python (`parsing.py:42`), and the record re-derives BET correctly (`record.go:218`).

### 6. Spectators see the model's chosen action, not what the engine applied (risk, medium)
**Where:** `engine/api/table.go:533-541`.

**What happens:** `MsgLLMAction` is broadcast with `decision.Action` and `decision.Amount` before `ProcessAction` runs. If the engine then folds the player (issues 1 and 5), the screen shows "All-In" or "Raise 15" for about 5 to 10 seconds, followed by a fold.

**Smallest fix:** run `ProcessAction` before the broadcast, and send `Players[idx].LastAction`. Or check the action against `GetValidActions` first and send the corrected action.

### 7. The odd chip in a split pot goes to whichever winner the sort puts first (rule deviation, low)
**Where:** `engine/game/pot.go:180-184` and `hand.go:251`.

**What happens:** the remainder goes to `potWinners[0]`, whose order comes from an unstable `sort.Slice` over tied hands.
The rule is that the odd chip goes to the first winner left of the button.

**Smallest fix:** after `FindWinners`, sort `potWinners` by `(idx - ButtonIdx - 1 + n) % n`.

### 8. `Winner.Amount` means profit when everyone folds and gross pot share at showdown (risk, low)
**Where:** `engine/game/pot.go:241-245` versus `pot.go:189-194`.

**What happens:** the hand-complete broadcast and `ArchiveHandForLLMs` report these two different quantities under the same field.
`record.go:248-252` already works around it.

**Smallest fix:** set `Amount: totalPot` in `AwardPotToLastPlayer` and remove the add-back in `record.go`.

## Suspected and lower-risk items

### 9. Data race in private-game mode (risk, dev only)
**Where:** `api/game_handlers.go:141,199` and `api/llm_handlers.go:23-170`.

With `PRIVATE_GAMES=1`, `handleAction` (the websocket read goroutine) and the `handleLLMTurns` goroutine change the same `*GameState` without a lock.
`start_hand` can also start a second LLM loop while one is still running, and `handleListGames` reads `gs` fields under `s.mu`, which does not guard them.
The shared table (`table.go`) is correctly locked. All mutation happens on the `Run` goroutine under `t.mu`, and spectators only read under `t.mu`.

**Fix:** add a per-game mutex, or refuse `start_hand` and `action` while a loop is running.

### 10. `LLMPreviousHands` grows forever and is never read (risk, low)
**Where:** `game/game.go:455`.

The table runs forever, so this slice is an unbounded memory leak.
It also stores an uncontested winner's hole cards as "showdown" (`game.go:429`, because Street is already Complete).

**Fix:** delete `ArchiveHandForLLMs` and `LLMPreviousHands`. The prompt intentionally uses no history.

### 11. A run-out burns before every card (deviation, cosmetic)
**Where:** `game/game.go:318-321`.

A run-out from preflop burns 5 cards instead of 3, so the saved `Deck` order does not match the standard burn and deal positions for anyone checking it.

**Fix:** deal the flop, turn and river through `dealFlop`, `dealTurn` and `dealRiver`.

### 12. Uncalled bets returned at showdown are missing from the record's `pots` (risk, low)
**Where:** `pot.go:161-166` and `record.go:246`.

A single-eligible pot goes back to the player's stack with no `Winner` entry, so `result.pots` does not add up to the chips put in.
`net` is still correct because it comes from stacks.

### 13. `ProcessAction` lets an all-in player act (risk, unreachable today)
**Where:** `action.go:66`.

It accepts status `PlayerAllIn`, so a fold would forfeit that player's claim on the pot.
Today `advanceToNextPlayer` and `GetFirstToAct` only ever stop on active players.

**Fix:** require `PlayerActive`.

### 14. Seat names count empty seats (deviation, private mode only)
**Where:** `game.go:472-504`.

`getPositionName` counts raw seat distance, including eliminated seats, so labels are wrong after eliminations.
This only matters without rebuys.

## Checked and found correct

- **Blind posting with short stacks.** A short SB or BB goes all-in for what it has, and the amount to call stays the full BB (TDA). Tested in `TestAuditBlindShortStack`.
- **Button rotation.** It skips broke or eliminated seats. On the table, rebuys run before `StartHand`, so rebought players rotate normally.
- **Min-raise.** Preflop the minimum is a raise to 20. A full raise sets the new minimum increment. A short all-in opening bet keeps the minimum at BB above the current bet.
- **Short call.** A call bigger than the stack becomes an all-in for the remaining stack, with no reopening. Tested in `TestAuditShortCallBecomesAllIn`.
- **Run-out.** When at most one player can still act, the board runs to 5 cards, the hand resolves, and chip totals are conserved (same test).
- **Betting-round completion.** The BB gets its option preflop. A check-around ends the street. A full raise reopens action for everyone else. The SB acts first postflop with 3 or more players. Tested in `TestAuditBBOptionAndCheckAround`.
- **Side pots with no folded excess.** Levels, eligibility, and uncalled-bet return work.
- **Hand evaluation.** All of these passed in `TestAuditEvaluator`:
  - a wheel loses to a 6-high straight
  - a 5-high straight flush loses to a 6-high straight flush
  - a flush beats a straight
  - AAA KKK 2 is aces full of kings
  - with three pairs, the best kicker is used
  - pair and quads kickers are compared
  - when the board plays, the pot is split
- **Showdown.** Every remaining player's cards are recorded and shown, which is reasonable for a spectator app. Ties split the pot.
- **Amount conventions.** RAISE and BET amounts are the total for the street, and CALL amounts are the amount added. The prompt, parser, engine and record all agree.
- **Table locking.** `table.go` is consistent: `Join`, `Leave`, `Resend`, `Usage` and every game mutation run under `t.mu`, and slow spectators are dropped without blocking.
