# No-LLMit feature audit: stats, sessions, tables, memory, dataset

Read-only audit of `/Users/rizzwareengineer/No-LLMit` at `1cd0b9d`.
Files read: `docs/hand-history.md`, `docs/hand-record-example.json`, `supabase/migrations/20261009000000_create_hand_history.sql`, `engine/api/{table,record,server}.go`, `engine/game/prompt.go`, `engine/game/game.go` (rebuy), `llm/{app,parsing,prompts,registry}.py`, `llm/providers/openrouter.py`, `web/src/app/page.tsx`, `web/src/app/about/page.tsx`, `README.md`.

## Facts that drive the recommendations

- Data rate is small: ~12 hands/hour, ~150 hands/day, and hands are dealt whenever the table is open, watched or not. Realistic ceiling is ~4,500 hands/month, at ~$0.001/hand that is ~$4.5/month, so the $10 budget is not the binding constraint today. Display pacing is.
- Sample size reality: a 9-max win rate has a standard deviation on the order of 100+ bb/100 (LLMs likely higher). At 4,500 hands the standard error per model is roughly ±20-25 bb/100. Extreme leakers (calling stations losing 100+ bb/100) will separate within a month; mid-pack rankings will not. VPIP/PFR stabilize in a few hundred hands, 3-bet and c-bet in ~1-2k, win rate in tens of thousands.
- Stacks are never reset. `RebuyBrokePlayers` only tops up a player at exactly 0 chips, so winners grow without bound (a 1,000bb stack plays a different game) and a player with 3 chips keeps playing short. Every engine restart also creates a new random `tbl_xxxxxx`, resets stacks to 2000 and restarts `hand_number`, so "sessions" already exist, but they are set by deploys, not by design.
- The prompt names opponents by model ("GPT-OSS 20B: ... (2000)", "You are Llama 3.1 8B"). Models may carry priors about named models.
- `prompt_version` hashes only the system prompt in `llm/prompts.py`. The per-decision user prompt is built in Go (`engine/game/prompt.go`); changing its wording does not change `prompt_version`.
- The record already stores the full deck order and every seat's hole cards (folded hands too), which makes all-in EV, perfect-information decision EV, and duplicate replays possible later. This is the best design decision in the record.
- `config.memory: "none"` already exists, so variants were anticipated.

## 1. Stats: can they be computed from the record?

Rule for all playing-style stats: count only actions with `status == "ok"` (forced folds are engine fallbacks, not choices). The docs already say this.

### Results

| Stat | Computable? | Notes |
|---|---|---|
| Net chips, bb/100 | Yes | `result.net` / `config.big_blind`, per seat, sum over hands. Rebuys don't distort it because net is per hand. |
| Win rate by position | Yes | `seats[].position`. |
| All-in EV adjusted (luck-adjusted) | Yes | All hole cards + `board` + `deck` + action sequence give the moment all remaining players are all-in and the exact equity. Needs an equity calculator offline (e.g. a Go/Python evaluator), not new fields. |
| Perfect-information decision EV ("Sklansky dollars") | Yes | Because every opponent's hole cards are stored, you can score each call/fold against actual equity. Strong research metric, unique to this setup. |
| Confidence intervals | Yes | Per-hand net is the sample; show ± on every win rate (bootstrap or SE). |

### Preflop

| Stat | Computable? | Notes |
|---|---|---|
| VPIP, PFR, by position | Yes | Preflop `applied` + `seats[].position`. Blinds are in `blinds`; a BB check is not VPIP. |
| 3-bet, fold to 3-bet, 4-bet | Yes | Count raises in order within the preflop street. |
| Limp rate, open-size distribution (in bb) | Yes | `applied.amount` / BB. Open sizing is a very visible LLM tell. |
| Steal / fold-to-steal | Yes | CO/BTN/SB first-in raises. |

### Postflop

| Stat | Computable? | Notes |
|---|---|---|
| AF / AFq | Yes | Bets+raises vs calls per street. |
| C-bet, fold to c-bet | Yes | Preflop last aggressor = first `BET` on flop. |
| WTSD, W$SD | Yes | `result.showdown` lists who reached showdown; `result.pots[].winner_seat` and `net` give who won. |
| Bet sizing as % pot | Yes | `applied.amount` vs `pot_before` (note: amount is street total, subtract prior street commitment). |
| Fold when check was free | Yes | `legal_actions` contains CHECK and `applied` is FOLD with status ok. The prompt offers FOLD alongside CHECK, so this is a real, measurable LLM blunder. |

### LLM-specific

| Stat | Computable? | Missing field |
|---|---|---|
| Unparseable / illegal / timeout / api_error rate | Yes | `status`. |
| Latency (p50/p95) | Yes | `latency_ms` (includes OpenRouter queueing). |
| Cost per decision / per hand / per model | Yes | `cost_usd` from OpenRouter usage. Null on errors. |
| Reply length | Yes | `tokens_out`, or `raw_reply` length in `decision_prompts`. |
| Reasoning tokens / chain of thought | **No** | OpenRouter returns `message.reasoning` and `usage.completion_tokens_details.reasoning_tokens`; `openrouter.py` keeps only `content`. Store both. |
| Truncation | **No** | `finish_reason` not stored. With `max_tokens: 1024`, a thinking model that runs out returns empty content and is logged as `api_error`, indistinguishable from an outage. |
| Upstream provider / quantization | **No** | OpenRouter routes the same model ID to different hosts with different quantizations. Store `body["provider"]` and the generation `id`, or pin a provider. |
| Sampling params | **No** | No `temperature` is sent, so each host's default applies. Set it explicitly and record it in `config`. |
| Reasoning quality | Partly | Programmatic checks are cheap: reason mentions cards not in hand/board (hallucinated cards), claims a made hand it doesn't have ("I have a flush"), reason/action contradiction. An LLM judge is possible offline but costs money. **Bug for this:** `parsing.py` inserts "Decision based on hand strength and position." when the model gives no REASON, so fabricated text lands in `parsed.reason`. Store an empty reason (or a flag) instead. |

### Other record gaps (small)

- `seats[].model` is only filled when that seat acts with a successful reply. A BB that gets a walk, or a seat whose only call errored, has no model. Fill it from the lineup at hand start.
- `config` should also carry: user-prompt template version (or engine git SHA), lineup ID, temperature, max_tokens, stack policy, session ID. Without the template version, prompt-wording changes silently pool.
- Per-action timestamp is missing (only latency). Low value; skip.
- `legal_actions` stores "ALL-IN" while `applied` uses "ALL_IN"; and repeats description strings on every action. Cosmetic; normalize when exporting.

## 2. One long game vs sessions

**Recommendation: reset every stack to 200bb (2000) at the start of every hand, and label hands with a `session_id` (ET date) and a `season` (lineup + prompt versions).**

Reasoning: this is the standard for bot/AI poker evaluation (the Annual Computer Poker Competition used reset stacks). It makes every hand an independent sample at the same effective depth, so bb/100, VPIP and sizing are comparable across hands, days and models. Today stack depth drifts without bound, and that changes correct strategy (deep stacks reward implied odds, short stacks force shove/fold), so a model's stats partly reflect how much it happened to win earlier. It also removes the uncontrolled restarts-on-deploy problem: a deploy no longer changes the game.

Spectators keep the drama through a running "bankroll" (cumulative net today / this season) instead of stack size. The prompt then always shows 2000 stacks, which also removes stack size as an unexplained variable in decisions.

Alternatives: daily reset at open (keeps one day of deep-stack drift, still non-comparable within a day); every N hands (arbitrary). Both are weaker than per-hand reset and no simpler to build. Implementation is one line in `playHand` (set every stack to `tableStartingStack` instead of `RebuyBrokePlayers`) plus a `stack_policy` field in `config`.

## 3. Multiple concurrent tables

| Option | Value | Cost | Verdict |
|---|---|---|---|
| Same lineup on 4 tables | Same as playing 4x more hands; no new question answered. | 4x | No. If you want more hands, run one headless table faster (see below); identical tables are just parallelism. |
| Duplicate tables (same decks, rotated seats) | Canonical variance reduction: card luck cancels. Deck order is already recorded. | Nx (9x for full rotation) | Not yet. Too costly at this budget; all-in EV adjustment gets much of the benefit for free. |
| Cheap lineup vs flagship lineup | Huge Twitter appeal ("GPT-5 vs Claude vs Gemini at the table"). Flagship models also follow the format, so fewer forced folds. | Order of 10-100x per call (frontier pricing, plus reasoning tokens). $10 buys a few hundred flagship hands. | Yes, as scheduled "showcase" sessions (e.g. one hour a week, or donation-funded), not 12h/day. |
| Same lineup, prompt/memory variant | The only option that is an experiment. | 1x extra | Yes, after stats exist, but run it offline first (section 4). |

**Engine changes needed** (currently one `Table` per process, global `tablePlayers`, one `/ws`):
- A `TableConfig` struct: id (stable, not random), lineup `[]{seat name, model ID}`, prompt variant, memory mode, stack policy, pace, hours, headless flag, daily call cap. `NewTable(cfg)`.
- `Server` holds `map[string]*Table`; `/ws?table=<id>` and `/api/usage?table=<id>`.
- LLM service `/decide` must receive the model ID and prompt variant in the request. Today `registry.py` maps display name to model, and the system prompt is a module global, so two tables with the same seat name but different models or prompts can't coexist.
- Per-table budget accounting (the daily cap is per `Table` already; add a shared global cap so the sum stays under budget).
- Frontend table switcher.
- A headless research table: `TABLE_PACE` near zero (it already accepts e.g. 0.01) runs at LLM latency, roughly 10x more hands/day. That is the cheapest way to get statistically useful samples, capped by hands/day to stay on budget. At ~$0.001/hand, 10k extra hands/month is ~$10.

Effort: M. Most of it is plumbing config through; the game engine itself doesn't change.

## 4. Memory variants

Worth testing, but not first as a live second table.

- **Opponent-stats HUD in the prompt** (per opponent: hands seen, VPIP, PFR, AF, 3-bet): this is what poker players mean by memory, adds ~150 tokens (~10-20% input cost), and has a clear hypothesis: do models exploit loose/passive opponents (e.g. fold more vs high AF, value-bet thinner vs calling stations)? Recommended variant.
- **Last N hands as text**: grows the prompt by ~300 tokens per hand, mostly noise to 8-12B models, and much harder to analyze. Skip.
- **Best first step: an offline paired probe.** Every decision's exact prompt is already stored. Take a few hundred stored decision points, re-ask each model with and without a HUD block appended, and compare the decisions pairwise. Paired comparisons need far fewer samples than comparing win rates of two live tables (where ~20 bb/100 noise per model per month swamps any memory effect), cost a few dollars once, and need no engine changes. The same harness gives self-consistency (ask the same prompt 5 times) and cross-model comparison on identical spots, which are good research results on their own.
- If the probe shows models actually react to the HUD, then run it as a live second table with the same lineup and measure behavioral stats (VPIP/AF vs opponent type), which converge much faster than win rate.
- Do not mix memory and no-memory seats at one table; the opponents interact, so the effect is confounded.

## 5. Hand recording and the public dataset

**Sufficiency:** sufficient for every poker stat in section 1. Missing for LLM research: reasoning text, reasoning tokens, `finish_reason`, upstream provider/generation ID, sampling params, user-prompt template version, session/stack-policy labels. Add these before launch so the published dataset starts clean (bump `schema` to 2).

**Storage:** the example hand is ~14 KB compact JSON plus ~20 KB of prompts for 18 decisions (mock replies are short; real ones are longer, reasoning models much longer). Call it 35-50 KB/hand before Postgres TOAST compression, ~5-7 MB/day at 150 hands/day. Supabase free tier (500 MB) fills in roughly 3-6 months depending on compression; a headless table fills it in weeks. Mitigations, in order: export closed days to object storage / Hugging Face and prune old `decision_prompts` from Postgres; drop the repeated `description` strings from `legal_actions`; keep prompts separate as now (correct). Do not drop stored prompts in favor of regeneration; exact prompts are what make offline re-query experiments valid.

**Export format:**
- **Hugging Face dataset** (primary): daily Parquet files, three flat tables `hands`, `seats`, `actions` (one row per decision, with prompt and raw reply columns), plus the raw JSONL docs. A dataset card with the schema, lineup per season, and the "exclude non-ok status" rule. HF is where the ML Twitter audience looks and hosting is free.
- **PokerStars-style text hand histories** (secondary, high value for poker players): lets them import into PokerTracker / Hold'em Manager / Hand2Note and get every HUD stat with zero work from you. Also consider the academic PHH format for researchers.
- Generated by a nightly job (GitHub Action or Railway cron) reading Supabase with the service key. Tables currently have RLS with no policies, so the public site can't read them; either add a read-only view/policy for the web app or serve stats from a precomputed JSON.

## 6. What a Twitter visitor wants

Ranked by value per effort:
1. **Leaderboard with stats** (bb/100 ± CI, all-in-EV bb/100, VPIP/PFR/3-bet/AF/WTSD, error rate, cost per hand) per season. This is the shareable artifact. Today's `WinningsPanel` is in-memory and resets on deploy.
2. **Shareable hand links + hand replay** (`/hand/<hand_id>`): street-by-street replay with every model's reasoning. Each hand becomes a tweet ("Llama folded the nuts on the river, reasoning: ..."). Needs a read path to `hands`.
3. **Per-model pages**: stats, position chart, worst blunders, most common reasoning phrases, cost.
4. **Hand of the day / blunder of the day**: biggest pot, biggest perfect-info EV loss, fold-when-check-free. Computed by the nightly job; doubles as automated tweet content.
5. **Reasoning search** (full-text over `parsed.reason`): fun, Postgres `tsvector` makes it cheap. Lower priority.
6. **Dataset download link** on the About page (the About/README already promise "Open source datasets").

Also: the About page and README advertise "Train an LLM to play like you" and "LLM Council"; for a research-focused launch, either cut or clearly label as future so the tool reads as credible.

## 7. Rule/format choices worth revisiting

- **Fixed seating order: change.** The button rotates, so every model gets every position, but the clockwise order never changes, so a given model always has position on the same neighbor. Reshuffle seat order once per orbit (every 9 hands keeps position counts balanced) or at least daily. Seats are already recorded per hand, so no schema change.
- **Model names in the prompt: anonymize.** Show "Player 3 (BTN)" to the models, keep real names on the site. Removes priors about named models and the self-identity cue. Cheap and a clear validity win.
- **Lineup: upgrade the weakest.** If 8B models (Llama 3.1 8B, Cohere R7B, Phi-4) produce high unparseable/illegal rates, their results measure format-following, not poker. Measure error rates for a week; replace any model over ~5% errors with a mid-tier model of similar cost, or report "poker stats" and "format reliability" as separate leaderboards. The Twitter audience will judge the project by whether recognizable models are present.
- **Errors as folds: change to check-if-free, else fold, after one retry.** Folding when a check is free is a fallback the model never chose and it bleeds chips that get attributed to the model. Retrying once with the error message ("RAISE 5000 exceeds max 1876") is the norm in LLM game benchmarks and costs tokens only on errors. Also clamp clearly-intended amounts (raise above max becomes ALL_IN) and record the coercion in `status`. Keep `status` so purists can exclude.
- **Prompt wording:** "You are an expert ... player" is a persona prime that likely shifts aggression; fine but fixed, so document it as part of the season. The user prompt lists FOLD next to CHECK, which is correct (it's a legal action) and gives the "fold when free" metric. Version the user-prompt template (see section 1).
- **Shot clock (25s provider / 30s engine):** fine for non-reasoning models. If reasoning models join, either raise it for them or record `timeout` and exclude, but raise `max_tokens` too or they truncate silently.
- **Only playing while watched:** fine for cost, but it means data volume depends on traffic. A capped headless table decouples research data from audience.

## Summary table

| Feature | Value | Effort | Cost impact | Recommendation |
|---|---|---|---|---|
| Reset stacks to 200bb every hand + session/season labels | High | S | None | Do before launch |
| Anonymize model names in the prompt | High | S | None | Do before launch |
| Shuffle seat order per orbit/day | Med | S | None | Do before launch |
| Record reasoning text, reasoning tokens, finish_reason, upstream provider, temperature, template version (schema 2) | High | S | None | Do before launch |
| Stop fabricating a default reason in `parsing.py` | High | S | None | Do before launch |
| Fill `seats[].model` from lineup at hand start | Low | S | None | Do with schema 2 |
| Error handling: retry once, then check-if-free else fold; clamp amounts | High | S-M | +tokens on errors only | Do before launch |
| Poker stats pipeline (VPIP/PFR/3-bet/AF/c-bet/WTSD/W$SD, all-in EV, ± CIs) | High | M | None (offline) | Build first after launch prep |
| Leaderboard + per-model pages | High | M | None | Build with stats pipeline |
| Hand replay + shareable hand links | High | M | None | Build for launch |
| Hand/blunder of the day | Med | S (after stats) | None | Add; feeds tweets |
| Public dataset: nightly Parquet + JSONL to Hugging Face | High | M | Free hosting | Build; also relieves Supabase storage |
| PokerStars-format hand history export | Med | M | None | Add after HF export |
| Reasoning checks (hallucinated cards/made hands, reason-action contradiction) | Med | M | None | Add after stats |
| Offline re-query harness (memory/HUD probe, self-consistency, cross-model same-spot) | High | M | ~$1-5 per run | Do before any second live table |
| Headless capped research table (pace ~0) | Med-High | M (needs multi-table) | ~$10 per extra 10k hands | Add once budget allows |
| Multi-table engine (TableConfig, table map, per-request model/prompt) | Med | M | None by itself | Build when a second table is justified |
| Live HUD-memory second table | Med | S (after multi-table) | +1x plus ~15% tokens | Only if offline probe shows an effect |
| Flagship showcase sessions | High (Twitter) | S (after multi-table) | 10-100x per hand; time-boxed | Weekly/donation-funded |
| Replace weak format-failing models | Med-High | S | Similar | Decide after one week of error-rate data |
| Same lineup on 4 tables | Low | M | 4x | Skip |
| Duplicate (rotated-seat) tables | Med | L | ~9x | Skip for now; all-in EV first |
| "Last N hands" memory variant | Low | M | +large tokens | Skip |
| Reasoning full-text search | Low-Med | S | None | Later |
| Supabase storage pruning/archival | Med | S | Avoids paid tier | Before headless table or within ~3 months |
