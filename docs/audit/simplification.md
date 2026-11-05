# No-LLMit simplification audit

Repo: /Users/rizzwareengineer/No-LLMit at 1cd0b9d (working tree clean, nothing in the repo was touched).
Baseline: 8,170 lines of Go/Python/TS(X) source.
Scratch copies with the verified changes applied:
- engine: /private/tmp/claude-501/-Users-rizzwareengineer/9e855f1b-560f-48a1-9090-bd698d74fc31/scratchpad/simplify-scratch/engine (patch: .../simplify-scratch/engine-simplify.patch)
- web: /private/tmp/claude-501/-Users-rizzwareengineer/9e855f1b-560f-48a1-9090-bd698d74fc31/scratchpad/simplify-scratch/web (patch: .../simplify-scratch/web-simplify.patch)
- llm: /private/tmp/claude-501/-Users-rizzwareengineer/9e855f1b-560f-48a1-9090-bd698d74fc31/scratchpad/simplify-scratch/llm

Verified means: engine `go build`, `go vet`, `go test ./...` and `staticcheck` pass; web `tsc --noEmit` passes and eslint drops from 15 to 7 problems (all remaining are pre-existing `set-state-in-effect`); llm smoke-tested with FastAPI TestClient (`/usage`, `/decide` with the mock provider).

## 0. Bug found during the audit (fix before anything else)

**`ALL_IN` from a model is applied as a FOLD.**
The system prompt and `llm/parsing.py` both use `ALL_IN`, but `engine/api/messages.go` `ParseActionType` only accepts `"ALL-IN"`, `"all-in"`, `"allin"`; the default branch returns `game.ActionFold`.
Fold is always legal, so `table.go` never marks it `illegal` and the saved hand records status `ok` with applied `FOLD`.
Every model all-in on the live table (and every mock `ALL_IN`) has been a silent fold, which also skews saved hand history.
Verified in the scratch copy with a one-line test: `ParseActionType("ALL_IN") != game.ActionAllIn` fails.
Fix: add `"ALL_IN"` to that case (or `strings.ToUpper` + `strings.ReplaceAll(s, "_", "-")`), plus a test. Consider back-flagging stored hands where `parsed.action == "ALL_IN"` and `applied.type == "FOLD"`.

## 1. Ranked items

Ranked by (lines removed or clarity gained) / effort.

| # | Item | Files | Lines saved | Risk | Verified |
|---|------|-------|-------------|------|----------|
| 1 | Delete the per-connection game flow (PRIVATE_GAMES=1) | engine/api | ~670 | Low | Yes |
| 2 | Delete "play vs LLMs" / test mode in web | web/src | ~655 | Low | Yes |
| 3 | Delete dead code in engine/game | engine/game, client | ~220 | Low | Yes |
| 4 | Delete llm/usage.py (HuggingFace-era tracker) | llm | ~150 | Low | Yes |
| 5 | Delete dead Python packaging (pyproject.toml, uv.lock, .python-version) | llm | ~897 (config) | Low | n/a |
| 6 | `go mod tidy` (gorm, sqlite, mux, jinzhu, x/text unused) | engine/go.mod, go.sum | 8 + go.sum | Low | Yes |
| 7 | Remove leftover play-mode wire types in web/lib/api.ts and lib/constants.ts | web/src/lib | ~85 | Low | No |
| 8 | Deduplicate web types (DisplayState, ButtonCard, ButtonDetermination) | web/src | ~35 | Low | No |
| 9 | Send position from the engine; delete PokerTable `getPosition` | engine/api/messages.go, web PokerTable | ~35 | Low | No |
| 10 | Unused web deps and boilerplate files | web/package.json, web/public, web/README.md | 3 deps, 5 svgs, 36 doc lines | Low | No |
| 11 | Dead props: `isPaused`, `inline` | UsageIndicator, ReasoningPanel | ~18 | Low | Partly |
| 12 | One `getJSON` helper in engine/client | engine/client/llm.go | ~25 | Low | No |
| 13 | Small engine/game duplications | game.go, action.go, messages.go | ~45 | Low-Med | No |
| 14 | System prompt kept in two places | web/src/lib/systemPrompt.ts, llm/prompts.py | 32 + drift risk | Low-Med | No |
| 15 | Small Python cleanups | llm/registry.py, schemas.py, parsing.py, providers/openrouter.py | ~12 | Low | No |
| 16 | Stale docs | README.md, llm/README.md | ~75 | None | n/a |
| 17 | Side-pot fast path in CalculatePots | engine/game/pot.go | ~15 | Medium (money) | No |

### 1. Delete the per-connection game flow (engine/api) — ~670 lines, verified

PRIVATE_GAMES=1 is the only way to reach it, and the only frontend caller is the dev-only test/play modes (item 2).
- Delete `engine/api/game_handlers.go` (248) and `engine/api/llm_handlers.go` (211). Move `buildLLMValidActions` (38 lines) into `table.go`; the table is its only remaining caller.
- `engine/api/server.go` 328 → 129: drop `games`, `clients`, `paused`, `pendingPause`, `mu`, `handleListGames` (`/api/games`, nothing calls it), `parsePayload`, `isPaused`, `isPendingPause`, `activatePendingPause` (staticcheck U1000 already flags it), `getGameForConn`, `sendGameState`, `sendActionRequiredIfNeeded`, `sendError`, `send`, the PRIVATE_GAMES branch and every `s.table != nil` check. `handleMessage` becomes a 3-case switch inside the read loop.
- `engine/api/messages.go`: drop `MsgNewGame`, `MsgStartHand`, `MsgAction`, `MsgPause`, `MsgResume`, `MsgActionReq`, `MsgPaused`, `MsgResumed`, `NewGamePayload`, `ActionPayload`, `ActionRequiredPayload`, `ParseGameMode`, the `showAllCards` param and the mode-based card visibility in `ConvertGameState` (spectators always see all cards), and `GameStatePayload.Mode`.
- `engine/client/llm.go`: drop the `mode` argument and request field (Python ignores it).
- `engine/game/game.go`: drop `GameMode`, `ModeSimulate/Play/Test`, `GameConfig.Mode`, `UserSeatIdx` (both structs).
Risk: low. Loses local "drive every seat by hand" debugging; `record_test.go`/`prompt_test.go` already script hands directly against `game`, which is the better tool for that.
Also fixes the stale file-header comments that still say "Called by api/llm_handlers.go" (client/llm.go, game/llm.go, game/prompt.go, game/action.go, game/game.go).

### 2. Delete play/test mode in web — ~655 lines, verified

The "Play vs. LLMs" button is permanently `disabled`, nothing links to `/play`, and test mode needs PRIVATE_GAMES=1 (item 1).
- Delete `web/src/app/play/page.tsx` (112), `web/src/components/ActionPanel.tsx` (188), `web/src/lib/timing.ts` (50; only `SHOT_CLOCK_MS` is used, inline it in useGameState), `web/src/components/CornerBorders.tsx` (returns `null`; remove its 7 imports and usages).
- `web/src/app/page.tsx` 488 → 246: remove `gameMode`, `selectedLLMs`, the sessionStorage/`?test=true` effect, auto-create-game and auto-start-hand effects, the client-side next-hand countdown restart, `handleStartHand`, `handleAction`, `handleBackToSpectate`, `showActionPanel`, `canAct`, the Next Hand button, `onSkipCountdown`, the ActionPanel block, and the dev pause/test-mode controls. The countdown effect collapses to "show the server's `nextHandInMs`".
- `web/src/hooks/useGameState.ts` 392 → 304: drop `actionRequired`, `isPaused`, `newGame`, `startHand`, `submitAction`, `pause`, `resume`, and the `action_required`, `street_change` (empty), `paused`, `resumed` handlers.
Risk: low; spectate rendering is unchanged (same JSX branch). Effort: an hour including a browser check.

### 3. Dead code in engine/game — ~220 lines, verified

All write-only or uncalled:
- `LLMPreviousHands`, `LLMPreviousHand`, `ArchiveHandForLLMs`, `GetLLMPlayers`, `LLMPlayer`, `Player.SeatPosition` (prompt.go says "Nothing from previous hands is included"; the archive is built every hand and never read, and it grows without bound on a table that runs forever). `ArchiveHandForLLMs` call sites become `gs.LLMActionsThisHand = []LLMAction{}`.
- `EvaluatorDebug` and its seven `fmt.Print` blocks in hand.go (~50 lines).
- `actionsThisRound` and `LastRaiseAmount` (written in 9 places, never read).
- `GetButtonWinner`, `Suit.Symbol`, `ParseCard` (~45 lines), `Deck.Reset` (alias of `Shuffle`), `WinnerFinder` type, `Pot.ContributedBy`, `PlayerSittingOut`.
- `HandStore.wg` in api/store.go: `Add`/`Done` but never `Wait` (3 lines, not applied).
Risk: low.

### 4. Delete llm/usage.py — ~150 lines, verified

It estimates tokens at 4 chars/token against HuggingFace free/pro limits and persists to `.usage_stats.json`. Nothing reads its output: the web widget only uses `llm.provider` and `llm.spend` (OpenRouter's real spend), and the table's own call cap lives in table.go.
- Delete `llm/usage.py` (137), the `POST /usage/reset` route, the `tracker` import, `est_input`/`est_output`, and the tracker part of the log line in `llm/app.py` (16 lines). `/usage` returns `{"provider", "spend"}`.
- Delete the untracked `llm/.usage_stats.json`.
- Update `llm/README.md` line "spend ... and request counts".
Risk: low.

### 5. Dead Python packaging — ~897 lines of config

`llm/pyproject.toml` lists `google-generativeai`, `groq`, `huggingface-hub`, `openai` (none imported), requires Python >=3.13, while the Dockerfile uses python:3.11 and `requirements.txt`, and the README says `uv pip install -r requirements.txt`. `uv.lock` (880 lines) is generated from the unused pyproject.
Delete `llm/pyproject.toml`, `llm/uv.lock`, `llm/.python-version` (or move to pyproject and delete requirements.txt; pick one source).
Risk: low.

### 6. go mod tidy — verified

`go mod tidy` in the scratch copy reduces the require block to `github.com/gorilla/websocket v1.5.3` (and drops the `// indirect` mislabel on it). gorm, sqlite (cgo), mux, jinzhu/*, x/text are unused.

### 7. Leftover play-mode wire types in web — ~85 lines, not verified

After item 2: `lib/api.ts` `MessageType` entries for client commands, `ClientMessage` can be narrowed, `NewGamePayload`, `ActionPayload`, `ActionRequiredPayload`, `ValidAction`, and the `newGame`/`startHand`/`action` methods (~45). `PokerWebSocket.connect`'s CONNECTING polling branch (~18) only protects against a double connect that `connectingRef` already prevents. The `'No game found'` string check in the `error` handler only matched legacy server errors. `lib/constants.ts` (27) has no importers once play/test mode is gone (`LLMName`, `GameMode` were already unused).
Engine side: `GameStatePayload.ValidActions`, `MinRaise`, `CurrentBet` and `ValidActionPayload` were only consumed by ActionPanel (~20 Go lines). `LLMThinkingPayload.Reason` is never set.
Also: `useGameState`'s `autoConnect` option is unused because page.tsx calls `connect` in its own effect; keep one.

### 8. Duplicate web types — ~35 lines

`ButtonCard`/`ButtonDetermination` are declared three times (useGameState.ts, PokerTable.tsx, TableFelt.tsx); `DisplayState`/`DisplayPhase` twice (useGameState.ts, ReasoningPanel.tsx). Export once from the hook (or lib/api.ts) and import. `DisplayPhase` values `'waiting'` and `'idle'` are never set by the hook.

### 9. Position labels computed twice, and they disagree

`engine/game/game.go getPositionName` (what the models are told: UTG+1, MP, MP+1, HJ, CO at 9-handed) and `web/src/components/PokerTable.tsx getPosition` (what spectators see: UTG+1, UTG+2, LJ, HJ, CO) give different names for the same seat. Add `Position string` to `PlayerStatePayload` from `gs.PositionName(i)` and delete the TS function (~40 lines). One source of truth, and the UI matches the prompt shown on the reasoning panel.

### 10. Unused web deps and boilerplate

`package.json`: `framer-motion`, `howler`, `@types/howler` are never imported (code uses `motion/react`). `web/public/{file,globe,next,vercel,window}.svg` are create-next-app leftovers. `web/README.md` is the create-next-app template. `LLMLogo` lists `gemini` and `grok` keys with no seat using them (harmless).

### 11. Dead props

`UsageIndicator`: `inline` is always true, so the fixed-position wrapper is dead; `isPaused` is always false. `ReasoningPanel.isPaused` likewise. ~18 lines. The scratch web copy stops passing them but still declares them.

### 12. engine/client getJSON helper — ~25 lines

`CheckLLMServiceHealth`, `GetLLMUsage`, `GetSystemPrompt` each repeat new client / GET / status check / decode. One `getJSON(path string, out any) error` with a package-level `http.Client{Timeout: 5s}`. `GetLLMDecision` can reuse a package-level 30s client too.

### 13. Small engine/game duplication — ~45 lines

- `dealHoleCards`: two identical loops → `for round := 0; round < 2; round++`.
- `dealTurn`/`dealRiver` identical → one `dealOne`.
- `postBlinds`: SB and BB blocks identical → `postBlind(idx, amount)`; it always returns nil, so drop the error.
- `IsBettingRoundComplete`: `activePlayers` counted but unused; body reduces to `return playersInHand <= 1 || playersToAct == 0`.
- Card→string loops repeated in `GetLLMCommunityCards`, `GetLLMHoleCards`, `DeckOrder`, `ConvertGameState` → one `cardStrings([]Card) []string`.
- `ConvertGameState` rebuilds winners by hand and drops `EligiblePlayers`/`PotNumber`; call `convertWinners` instead.
- `PositionName` is an exported wrapper over `getPositionName`; rename once.
- `buildLLMValidActions`: if/else-if chain on `va.Type` → switch.
- `ParseActionType`: accepting lowercase variants is legacy (only Python, which uppercases, calls it now).
- `SuitRank` allocates a map on every call and its comment's numbers are wrong; a 4-element array indexed by `Suit` is clearer.

### 14. System prompt in two places

`web/src/lib/systemPrompt.ts` is a hand copy of `llm/prompts.py` ("If you change one, change the other"). The engine already fetches it (`client.GetSystemPrompt`); expose it on the engine (e.g. `/api/prompt`) and have the About page fetch it, then delete the TS copy (32 lines) and the drift risk.

### 15. Small Python cleanups

`registry.list_models` unused; `get_model_id` is `MODELS[name]`. `DecisionRequest.mode` unused. In `parsing.py` the second `REASON` regex (`elif`) can never match when the first did not (first already matches up to `$`). The fallback reason "Decision based on hand strength and position." is invented text shown to spectators as if the model said it; prefer empty or "No reason given". In `openrouter.get_spend`, `value = None` is set three times. `llm/__init__.py` is unused (imports are flat).
Optional: `app.py log_decision` writes every prompt and reply to `logs/decisions.jsonl`, which the hand store now records properly (prompts table); keep only if it is still used for local debugging.

### 16. Stale docs

- `README.md` line 22 says models see "opponents' previous actions in current and previous hands"; line 46 and the prompt say no memory of previous hands.
- `llm/README.md` "Future: Training Mode" (~75 lines) is built on `LLMPreviousHand`, which item 3 deletes; the hand records in Supabase are now the data source. Rewrite in a few lines or drop.
- `web/SKINS.md` (116 lines) only explains why CornerBorders returns null; drop with item 2 if the design is settled.

### 17. CalculatePots fast path (only with tests)

The `needsSidePots` early return produces the same single pot the general loop produces when no shorter stack is all-in, so it can go (~15 lines) along with `contribution.isAllIn`. Money logic: only do this with a side-pot test (none exists for multi-way all-ins today).

## 2. Delete candidates

Whole files (or whole sections):

| Path | Lines | Depends on |
|------|-------|-----------|
| engine/api/game_handlers.go | 248 | item 1 |
| engine/api/llm_handlers.go (minus 38 moved) | 173 | item 1 |
| web/src/app/play/page.tsx | 112 | item 2 |
| web/src/components/ActionPanel.tsx | 188 | item 2 |
| web/src/lib/timing.ts | 50 | — |
| web/src/components/CornerBorders.tsx (+13 usage lines) | 17 | — |
| web/src/lib/constants.ts | 27 | item 2 |
| llm/usage.py | 137 | — |
| web/src/lib/systemPrompt.ts | 32 | item 14 |
| llm/pyproject.toml, llm/uv.lock, llm/.python-version | 897 | — |
| web/README.md | 36 | — |
| llm/README.md "Future: Training Mode" | ~75 | item 3 |
| web/SKINS.md | 116 | optional |
| web/public/{file,globe,next,vercel,window}.svg | 5 files | — |
| llm/.usage_stats.json (untracked) | — | item 4 |

Totals:
- Source code removable, verified in scratch (items 1–4): engine 4,509 → 3,616 lines (893), web 655 net, llm 153. About **1,700 lines, ~21% of the 8,170-line codebase**, with all tests, vet, staticcheck, tsc passing.
- Source code removable, not yet verified (items 7–15): about **300 more lines**.
- Config, lockfiles and docs (items 5, 6, 10, 16): about **1,170 lines** (uv.lock alone is 880), plus go.sum shrinkage.
- Whole-file delete list above: **~2,150 lines** (1,000 of them code, the rest config/docs), plus 5 svgs.

## 3. Suggested order

1. Fix the ALL_IN bug with a test (item 0).
2. Items 1 + 2 + 3 + 6 together in one PR (they are coupled through the wire protocol); apply the two scratch patches as a starting point, then browser-check spectate mode.
3. Items 4 + 5 + 15 (llm) in one PR.
4. Items 7–14 as follow-ups; 17 only with a side-pot test.

Process suggestion: add `staticcheck` and `go mod tidy -diff` to CI for engine, and `eslint --max-warnings=0` (after fixing the 7 pre-existing set-state-in-effect errors) for web, so dead code like `activatePendingPause` and unused modules get flagged automatically.

Not checked: Next.js production build (`next build`), the Dockerfiles, Supabase migration, runtime behaviour in a browser.
