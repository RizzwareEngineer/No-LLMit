# No-LLMit audit, 2026-11-03

Four read-only audits ran in parallel: poker-rules correctness ([rules-correctness.md](rules-correctness.md)),
readability and dead code ([simplification.md](simplification.md)), UX/UI ([ux-ui.md](ux-ui.md)) and
features/research validity ([features.md](features.md)). Nothing in the repo was changed by the audits.

## State of production, checked during the audit

- Supabase had paused itself (free tier, inactivity). Restored during the audit. It holds **128 hands from Oct 9–11 only**; every hand since was dropped by the engine after its 5 retries and is gone.
- Of the 2,563 saved decisions, **115 were `ALL_IN` replies that the engine applied as folds** and saved as `status: ok` (bug 1 below). 271 decisions (10.6%) are non-ok (unparseable / illegal / errors).
- `/api/usage` returns `spend: null` on prod, so the usage widget shows $0.00 next to a bar that counts calls.
- Table hours work (closed at audit time), 104 calls today.

## What was audited

Rules: blinds and short stacks, heads-up, button rotation, min-raise, short all-ins, short calls, side pots, run-outs, round completion, showdown and hand evaluation, odd chips, LLM action pipeline (amounts, illegal moves, ALL_IN), hand record correctness, locking.
Code: dead flows (private games, play/test mode), write-only state, duplicated types and helpers, dependencies, packaging, docs drift.
UX: first-10-seconds comprehension, tweet unfurl, mobile/laptop overflow, closed/error/connecting states, leaderboard, usage widget, contrast and type size, screen readers, motion, copy, About page.
Features: which poker and LLM stats the record supports, sessions vs one long game, multiple tables, memory variants, dataset export, Twitter-facing features, research validity (seating, names in prompt, error handling, lineup).

Not audited: a real browser render at any width, `next build`, Dockerfiles, Railway logs (connector was disconnected), `go test -race`.

## Priority list (value per effort)

### Tier 0 — fix now, each under an hour

1. **ALL_IN is applied as FOLD.** `engine/api/messages.go:248` accepts only `"ALL-IN"`; the prompt and `llm/parsing.py` emit `"ALL_IN"`. No model has ever been able to shove or call an all-in. One line plus widening the parser regex; make the `default:` branch an illegal action, not a silent fold. Back-flag the 115 stored decisions.
2. **Hands are being lost.** Supabase pauses after 7 days idle and the engine drops a hand after 5 failed saves. Add a keep-alive (nightly query or the usage endpoint touching the DB) or move off the free tier, and make the store spill to disk instead of dropping.
3. **Illegal/unparseable reply → fold even when a check is free** (`table.go:550`). Fall back to CHECK when legal, else FOLD; optionally clamp raise amounts and record the coercion in `status`.
4. **Parser invents a reason** ("Decision based on hand strength and position.") when the model gives none. Store empty.
5. **Spend lookup returns null on prod**; hide the Spend row when null and label the bar "Calls today".

### Tier 1 — before the tweet, small, mostly one-liners with big validity/first-impression payoff

6. **Reset every stack to 2,000 at the start of each hand** and label hands with a `session_id` (ET date) and `season` (lineup + prompt versions). Makes hands comparable; removes deploy-driven resets.
7. **Anonymize model names in the prompt** ("Player 3 (BTN)"); keep real names on the site. Shuffle seat order per orbit or per day.
8. **Schema 2 for the record:** reasoning text and reasoning tokens, `finish_reason`, upstream provider/generation id, explicit `temperature`, user-prompt template version, fill `seats[].model` from the lineup at hand start.
9. **Side-pot bug** (folded player's excess over a short all-in goes to the main pot) and **short all-in reopens raising**. Money bugs; failing tests already written in the scratch copy.
10. **UX critical batch:** `items-center` → `items-center-safe` (stops the unreachable left overflow), Open Graph/Twitter card tags + preview image, replace the 12px "SOTA" tagline with one dark explanatory line, drop the two disabled "coming soon" buttons, send the closed notice as its own message rendered on the felt with the reopen time in the visitor's zone and cleared on reopen, stop the leaderboard being draggable, show "Can't reach the server" after retries are exhausted.

### Tier 2 — medium, build order

11. **Delete dead code** (~1,700 lines, 21%): private-game flow, play/test mode, `LLMPreviousHands` (unbounded leak), `usage.py`, dead packaging and deps. Patches that compile and pass tests are in the simplification report's scratch dir. Do this before building stats on top.
12. **Stats pipeline + persisted leaderboard:** bb/100 ± CI, all-in-EV adjusted, VPIP/PFR/3-bet/AF/c-bet/WTSD/W$SD, fold-when-check-free, error rate, latency, cost. All computable from the record; exclude non-ok decisions.
13. **Shareable hand replay** (`/hand/<id>`) with every model's reasoning. Each hand becomes a tweet.
14. **Nightly export** to Hugging Face (Parquet + JSONL) and prune old `decision_prompts` from Postgres; PokerStars-format hand histories second.
15. **Accessibility and mobile:** contrast floor at `rgba(55,53,47,.65)`, 11px minimum, `role="presentation"` on the layout table, card `aria-label`s, one `aria-live` line for actions, reduced-motion, stacked phone layout, leaderboard above the usage widget.
16. **Per-model pages, hand/blunder of the day, reasoning sanity checks** (hallucinated cards, claimed hands, reason/action contradiction).

### Tier 3 — decide later

17. **Offline re-query harness** on stored prompts (HUD-memory probe, self-consistency, cross-model same-spot). A few dollars per run, no engine change; do this before any second live table.
18. **Headless capped research table** (pace ≈ 0, no spectator gate): ~10x hands/day for ~$10 per 10k hands. Needs the multi-table config (TableConfig, table map, model id per request).
19. **Flagship showcase sessions** (weekly, time-boxed): the Twitter draw; 10–100x per hand.
20. **Replace models with >5% error rate** after a week of data, or publish a separate "format reliability" leaderboard.

### Skip

Four identical tables (just parallelism, 4x cost), duplicate rotated-seat tables (9x), "last N hands" memory, heads-up blind fix (unreachable on the 9-seat table; note it).
