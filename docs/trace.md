# What runs when a browser opens the page

This is the code path from the engine starting to pixels on a viewer's screen, one function at a time.
It names what runs, where it runs, what triggers it and what it hands on, so a new engineer can open the same files and follow along.
[system-design.md](system-design.md) explains why the system has this shape and [stream.md](stream.md) defines every message on the wire; neither is repeated here.

## How to read this

- `engine/api/stream.go` → `publish` is the function, method, hook or component named after the arrow, defined in the file before it (a path from the repo root). There are no line numbers: search the file for the name.
- Where a method's receiver matters, the sentence names it: the hub, the table, the stats cache.
- Each step has four parts. **Where / trigger** is the place it runs and what starts it. **Code** is what runs. **Does** is what it does. **Next** is what it hands on.
- Steps 1 to 5 run once when the engine boots. The table loop (steps 6, 17 to 24 and 38 to 42) then repeats for every hand and turn, with or without viewers.
- Step 7 runs once per deploy. One viewer's path is steps 8 to 16, then steps 27 to 37 for every event, then steps 43 to 46 when the stream ends.
- A value in parentheses is the constant in the code today. The table's pacing sleeps are multiplied by `TABLE_PACE` (default 1).

Code runs in these places:

- **Browser.** The viewer's tab: the React components and hooks under `web/src`.
- **Vercel.** Builds `web/` with `next build` and serves the output.
- **Engine, main goroutine.** Wires the server, then blocks in `http.ListenAndServe`.
- **Engine, table loop goroutine.** The only goroutine that changes the game. Every pacing sleep, model call and hand save happens on it.
- **Engine, stats goroutine.** Loads the saved hands, recomputes the stats and publishes `stats` events.
- **Engine, handler goroutine.** `net/http` starts one per request. For `GET /stream` it lives as long as the stream and is that viewer's only writer.
- **llm service.** The FastAPI app in `llm/`. It builds the prompt and calls the model through OpenRouter.
- **Supabase.** Postgres. It runs the `save_hand` function and serves the saved hands for the stats load.

The engine and the llm service run on Railway. Railway's edge proxy sits in front of the engine and sets `X-Real-IP`, which step 13 reads.

## Before the viewer arrives

**START.** Railway starts the engine container, which runs the `server` binary built from `engine/`. No browser is involved yet.

**1. Wire the server.**
- **Where / trigger:** engine, main goroutine. The process starts.
- **Code:** `engine/main.go` → `main`; `engine/api/server.go` → `Start`; `engine/api/stream.go` → `newHub`; `engine/api/stats.go` → `newStatsCache`; `engine/api/table.go` → `NewTable`; `engine/api/store.go` → `newSaver`.
- **Does:** Reads the port from `PORT` (default 8080). Builds the hub (`seq` 0, an empty `tables` map, `stats` nil, one `wake` channel), then the stats cache, whose `hub` field it sets to that hub. Builds the one table with `NewTable`, passing the hub and the cache's `Add` method, which the table keeps as `onSaved` (step 41). The table's id is `tbl_` plus 16 hex digits. Hands are saved to and loaded from Supabase when `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` are both set, otherwise `hands.jsonl` under `HAND_LOG_DIR`.
- **Next:** Starts the table loop goroutine (step 3) and, without waiting for it, goes on to step 2.

**2. Register the routes and listen.**
- **Where / trigger:** engine, main goroutine. Step 1 continues in the same function.
- **Code:** `engine/api/server.go` → `Start`; `engine/api/server.go` → `handleCORS`.
- **Does:** Registers `/stream`, `/health`, `/api/usage`, `/api/stats`, `/api/stats/timeline` and `/api/waitlist` on the default mux, all but `/health` behind the CORS wrapper. Calls `http.ListenAndServe`, which blocks for the life of the process. The server sets no timeouts of its own: each stream sets a deadline before every write (steps 15 and 27).
- **Next:** `net/http` answers every request on its own handler goroutine from now on, even while steps 3 to 5 are still running.

**3. Ask the llm service who is seated.**
- **Where / trigger:** engine, table loop goroutine. It is the goroutine step 1 started.
- **Code:** `engine/api/table.go` → `lineup`; `engine/api/table.go` → `seatedPlayers`; `engine/client/llm.go` → `GetSeated`; `llm/app.py` → `get_models`.
- **Does:** Sends `GET {LLM_SERVICE_URL}/models?session=N`, `lineupWait` (5 s) apart, until the service answers. The service answers `seated`: its `LINEUP`, by default the first 9 names of `MODELS` in `llm/registry.py`, or a rotation over the roster with the mock provider. The same reply carries `turn_budget_s`, which `GetSeated` stores in `client.TurnBudget` when it is above 0. Each try has a 5 s HTTP timeout, and a reply with fewer than 2 names counts as a failed try. There is no fallback lineup: the table waits however long the service takes, logging about once a minute, since the lineup and the shot clock's budget are the service's and no hand could be played without it.
- **Next:** The goroutine gives the stats cache the lineup, starts the stats goroutine (step 4) and runs the table (step 5).

**4. Load the saved hands and compute the first stats.**
- **Where / trigger:** engine, stats goroutine. Step 3 starts it.
- **Code:** `engine/api/stats.go` → `run`; `engine/api/stats.go` → `loadSupabaseHands`; `engine/api/stats.go` → `recompute`.
- **Does:** Loads every saved hand, from Supabase with `GET /rest/v1/hands?select=doc&order=started_at,hand_id` in pages of 1000 rows, and retries a failed load every `statsRetryEvery` (15 s). The first recompute publishes the full all-time body as a `stats` event and stores it in the hub (step 41 has the mechanism). Until then `/api/stats` answers 503 and a new stream gets no `stats` frame.
- **Next:** Waits for a saved hand (step 41) or its `statsPollEvery` (5 min) tick. With Supabase, the tick fetches only the hands that started at or after the newest one held (another writer's, such as an overlapping deploy) and adds them. All-in EV replaces a player's actual result in a hand where everyone left was all-in before the river with what they would win on average over every possible runout; `engine/stats/equity.go` → `WarmAIEV` works it out and caches it per hand. The warm-up lasts until every such hand is cached. Until then the stats body has `partial` true and uses the actual results for the hands not done yet. During the warm-up the loop runs again at once (`time.After(0)`), and each recompute works out at least `aievPerPass` (8) such hands, or one per 1000 hands held if that is more. A recompute publishes a `stats` event when a hand was added, or once when the warm-up ends.

**5. Start the game and draw for the button.**
- **Where / trigger:** engine, table loop goroutine. Step 3 calls it once.
- **Code:** `engine/api/table.go` → `Run`; `engine/api/table.go` → `startGame`; `engine/game/game.go` → `NewGame`; `engine/game/game.go` → `DetermineButton`.
- **Does:** Creates the game with the lineup, `tableStartingStack` (2000) and blinds 5/10, and deals one card per seat for the button. Publishes `game_state`, then a `button_card` per seat with a `buttonCardDelay` (2 s) sleep after each, then `button_winner` and a `buttonWinnerDelay` (5 s) sleep.
- **Next:** Runs step 6 in a loop, forever. Every publish goes through steps 25 to 27.

**6. Deal a hand.**
- **Where / trigger:** engine, table loop goroutine. The loop of step 5 calls it once per hand.
- **Code:** `engine/api/table.go` → `playHand`; `engine/api/table.go` → `waitForOpenHours`; `engine/api/table.go` → `dealHand`; `engine/game/game.go` → `StartHand`; `engine/api/record.go` → `newHandRecorder`.
- **Does:** Outside the opening hours it publishes `table_notice` with kind `closed` and polls every 10 s; when the table reopens it publishes a `table_notice` with kind `""` to clear it. Otherwise, under the table's mutex `t.mu`, it tops broke seats up to 2000, remembers every stack and the button, deals the hand and opens its record. It clears `buttonCards`, `buttonWinner`, `turn`, `turnApplied`, `turns` and `peeked`, then sends `hand_start` `{"handNumber":N}` and `game_state` in one publish: one call to the hub (step 26), whose messages get consecutive `seq` numbers.
- **Next:** The turn loop, steps 17 to 24, until the hand ends (step 38). If the deal fails, the table logs `Could not start hand`, sleeps 5 s with nothing published and comes back to step 6.

A viewer can arrive any time after step 2. The table loop is then somewhere in steps 6, 17 to 24 or 38 to 42: asleep between two events, waiting on a model, or saving a hand.

## The page loads

**7. Prerender the page.**
- **Where / trigger:** Vercel, once per deploy. `next build` runs before any viewer asks for the page.
- **Code:** `web/src/app/layout.tsx` → `RootLayout`; `web/src/app/page.tsx` → `Home`.
- **Does:** The home page is a client component that reads nothing from the request, so the build renders it once to static HTML with every hook at its initial value. `NEXT_PUBLIC_API_URL` is inlined into the JS bundle. `web/src/lib/api.ts` reads it as `API_URL`, an http(s) base URL, and derives `STREAM_URL` as `${API_URL}/stream`. If the setting is unset at build time, `API_URL` falls back to `http://localhost:8080`; a production build on Vercel (`VERCEL_ENV=production`) fails in `web/next.config.ts` instead, with a message naming the variable, so a deploy never ships a site that points at localhost.
- **Next:** HTML, JS and CSS files on Vercel's CDN.

**8. Serve `GET /`.**
- **Where / trigger:** Vercel. The browser requests the page.
- **Code:** `web/next.config.ts` → `redirects`.
- **Does:** Answers with the prerendered HTML; the JS and CSS chunks follow as static files. The only routing rules are two permanent redirects: `/stats` to `/#stats` and `/stats/:model` to `/#model=:model`. The engine is not contacted.
- **Next:** The browser parses the HTML.

**9. Size and paint the page before React runs.**
- **Where / trigger:** browser. The HTML parser passes two inline `<script>` tags, one after the table screen and one after the stats screens; then the browser paints.
- **Code:** `web/src/app/page.tsx` → `fitStage`; `web/src/lib/boxes.ts` → `holdBoxes`.
- **Does:** Both tags hold `BEFORE_PAINT`, the source of these two functions: the first sets the zoom of `.stage-zoom` and `--stage-w`; the second gives each `[data-box]` a minimum height (and a minimum width when it has `data-box-w`), and sets the overview's measured `--` CSS variables on `.stats-room`, from what is stored under the `localStorage` key `nollmit:boxes`. It does this only when the stored window size equals the current `innerWidth + 'x' + innerHeight`, so a first visit or a new window size gets the boxes' empty size. The first paint shows a blank status label (`connection` starts `connecting`; the label and the hand number stand in at their remembered widths), nine blank seats, an empty felt and blank panels. No connection bar shows: it needs `connection` `down`.
- **Next:** React hydrates when the JS chunks arrive (step 10).

**10. Hydrate and send the side requests.**
- **Where / trigger:** browser. React hydrates the page, then runs the mount effects of the page and its children.
- **Code:** `web/src/app/page.tsx` → `Home`; `web/src/hooks/useGameState.ts` → `useGameState`; `web/src/components/UsageIndicator.tsx` → `useUsage`; `web/src/components/StatsSections.tsx` → `StatsSections`; `web/src/lib/timeline.ts` → `useTimeline`.
- **Does:** The game-state hook starts with `tables` `{}` and `stats` null, so the page draws `EMPTY_TABLE`. The mount effects send two requests to the engine: `GET /stream` (step 12, from the hook's stream effect), then `GET /api/usage` (repeated every `USAGE_POLL_MS`, 30 s, from that page's own mount, so viewers' polls are spread out). The timeline waits for the stats: `useTimeline` is keyed on `Math.floor(stats.scope.hands / 25)`, which is undefined until the first `stats` frame arrives, and it fetches nothing while the key is undefined, so `GET /api/stats/timeline` leaves once, when that frame arrives; a 503 on that fetch is swallowed and leaves the timeline null until the next 25-hand refetch. The page's other mount effects (stage fit, paging by keys and wheel, the sticky bar's observer, hash cleanup) never touch the stream.
- **Next:** Step 11. The engine answers the two side requests in `engine/api/server.go` → `handleUsage` and `engine/api/stats.go` → `handleTimeline`; `spectators` in the usage answer is the hub's count of open streams. At most once a minute, `/api/usage` makes the engine call `GET {LLM_SERVICE_URL}/usage` (`engine/client/llm.go` → `GetLLMUsage`), and the request that starts that fetch waits for it. If the browser's usage fetch fails or is not 200, the usage box shows `???` and the `N watching` count is hidden. `GET /api/waitlist` leaves only when the About screen nears the viewport (`web/src/components/about/content.tsx` → `Waitlist`). On the home page About's race takes the stream's stats through `PageStats`, which `StatsSections` provides, so it sends no `GET /api/stats`; only `/about`, which has no provider, fetches it (`web/src/components/about/content.tsx` → `useField`), and `web/src/lib/stats.ts` → `useStats` refetches it every 10 s while the engine answers 503 and every 30 s while the body is `partial`.

## The browser opens the stream

**11. Create the stream client.**
- **Where / trigger:** browser. The hook's stream effect runs once on mount (deps `[]`).
- **Code:** `web/src/hooks/useGameState.ts` → `useGameState`; `web/src/lib/api.ts` → `GameStream`; `web/src/lib/api.ts` → `disconnect`.
- **Does:** Creates one `GameStream` with `reconnectAttempts` 0, `maxReconnectAttempts` 10 and `reconnectDelay` 2000 ms, assigns its `onMessage` and `onStatus` callbacks and opens the stream (step 12). It also starts `offlineTimer`, so a first attempt that errors or hangs turns `connection` to `down` once, `OFFLINE_AFTER_MS` (4000 ms) after this effect, unless an `open` comes first. The effect's cleanup disconnects, which closes the stream when the page unmounts.
- **Next:** Step 12.

**12. Open the `EventSource`.**
- **Where / trigger:** browser. Step 11, a reconnect timer (step 44) or the Retry button (step 46) calls it.
- **Code:** `web/src/lib/api.ts` → `connect`.
- **Does:** Closes any earlier stream, creates `new EventSource(STREAM_URL)` and assigns `es.onopen`, `es.onerror` and `es.onmessage`. Returns a promise that resolves on the first `open` and rejects on the first `error`. Creating the object sends `GET ${API_URL}/stream`, cross-origin and without credentials.
- **Next:** Railway's edge forwards the request to the engine with the viewer's address in `X-Real-IP`.

## The engine accepts the connection and sends the snapshot

**13. Check the request.**
- **Where / trigger:** engine, a new handler goroutine. `net/http` starts it for the request.
- **Code:** `engine/api/server.go` → `handleCORS`; `engine/api/stream.go` → `handleStream`; `engine/api/waitlist.go` → `clientAddr`.
- **Does:** The wrapper sets `Access-Control-Allow-Origin: *` on every answer. The handler reads the viewer's address from `X-Real-IP` (an IPv6 address counts by its /64; without the header this cap is skipped) and answers `429` when `maxStreamsPerAddr` (50) streams are open from it, then `503` when `maxStreams` (6000) are open in total. Otherwise both counts go up by one, and deferred calls take them down when the handler returns.
- **Next:** Step 14. A 429 or 503 reaches the browser as an `error` event (step 44).

**14. Send the response headers.**
- **Where / trigger:** engine, handler goroutine. Both caps passed.
- **Code:** `engine/api/stream.go` → `handleStream`.
- **Does:** Sets `Content-Type: text/event-stream` and `Cache-Control: no-store`, writes status 200 and flushes, so the browser has an open stream before any data. Starts a ticker of `heartbeatEvery` (20 s) and a one-shot timer of `streamLife()`: `streamLifetime` (10 min) plus a random 0 to 4 min. Sets `last`, the highest `seq` this stream has sent, to 0.
- **Next:** The browser fires `open` (step 16). The handler enters its loop (step 15). If that first flush fails, the handler returns at once, with no snapshot and no ticker; the deferred calls still take the stream out of both counts.

**15. Write the snapshot, then the full stats.**
- **Where / trigger:** engine, handler goroutine. First pass of its loop.
- **Code:** `engine/api/stream.go` → `since`; `engine/api/stream.go` → `write`; `engine/api/stream.go` → `snapshotFrame`; `engine/api/stream.go` → `send`.
- **Does:** Under the hub's read lock it reads `seq`, the `wake` channel, the `tables` map and the stored `stats` frame together, so no publish falls between them. It marshals one `snapshot` message whose `payload.tables` holds, per table id, `state`, `turn`, `turnApplied`, `notice`, `buttonCards` and `buttonWinner`; `state.nextHandInMs` is worked out here, per stream. It writes that frame and, when stats are loaded, the `stats` frame, each with a `snapshotWriteWait` (60 s) deadline, then flushes once.
- **Next:** Sets `last` to the `seq` it read and blocks in a `select` on the `wake` channel (step 27), the heartbeat ticker (step 28), the lifetime timer and the request context (step 43). Before step 5 has published, the snapshot's payload is `{"tables":{}}`.

**16. The browser sees the stream open.**
- **Where / trigger:** browser. The 200 and the headers of step 14 arrive and `EventSource` fires `open`.
- **Code:** `web/src/lib/api.ts` → `connect`; `web/src/hooks/useGameState.ts` → `useGameState`.
- **Does:** The `es.onopen` handler reports status `open` and resolves the promise of step 12, whose result is discarded. The hook's `onStatus` callback sets `gaveUp` false, clears `offlineTimer` and sets `connection` to `open`. The status label stays blank until the first state and the usage answer (or its failure) are in too; then it and the hand counter, blinds and timer fade in together (`web/src/lib/boxes.ts` → `useFillIn`), the label reading `Live` with `· N watching`. Nothing in `tables` is cleared, and an `open` alone does not reset `reconnectAttempts`.
- **Next:** The snapshot arrives as the first `message` (step 29).

## The table plays a turn

These steps repeat for every turn, with or without viewers.

**17. Find the next seat to act.**
- **Where / trigger:** engine, table loop goroutine. Each pass of the turn loop inside the hand of step 6.
- **Code:** `engine/api/table.go` → `playHand`; `engine/api/table.go` → `settleStreets`; `engine/api/table.go` → `waitForBudget`.
- **Does:** Under `t.mu` it first advances any street where nobody can act, one publish per street. The turn loop ends when the hand is complete (step 38, then step 39) or no seat is waiting to act. If it ends without the hand being complete, the table logs that the hand stalled and saves nothing. It still runs the wait for `nextHandAt`, but that time is from an earlier hand (or unset) and has passed, so it goes straight back to step 6. Otherwise it checks the day's call count: at `DAILY_CALL_CAP` it publishes `table_notice` with kind `cap` and polls every 10 s until the next UTC day.
- **Next:** Step 18.

**18. Publish `llm_thinking`.**
- **Where / trigger:** engine, table loop goroutine. Step 17 calls it.
- **Code:** `engine/api/table.go` → `playTurn`; `engine/api/table.go` → `buildLLMValidActions`; `engine/api/decision.go` → `buildDecisionRequest`; `engine/api/record.go` → `beginDecision`.
- **Does:** Under `t.mu` it builds the `DecisionRequest`: the acting seat with its position, hole cards and stack, every seat's stack, each street's board and actions, and `legal_actions`. It numbers the turn from 1 within the hand, adds the seat to `peeked` (the seats whose turn has come this hand) if it is not there, stores the `llm_thinking` message `{turn, playerIdx, playerName, budgetMs, elapsedMs}` as `t.turn` (`budgetMs` is `client.TurnBudget`, the `turn_budget_s` that `GET /models` gave at startup or the 50 s decide timeout; `elapsedMs` is 0, and a snapshot written later fills in the time since this moment) with `turnApplied` false, and publishes it. It counts one call toward the daily cap; step 23 counts a second one if the service retried.
- **Next:** Step 19, with no lock held.

**19. Ask the llm service.**
- **Where / trigger:** engine, table loop goroutine. Step 18 continues.
- **Code:** `engine/api/table.go` → `decideLLMTurn`; `engine/client/llm.go` → `GetLLMDecision`.
- **Does:** Sends `POST {LLM_SERVICE_URL}/decide` with the request as JSON and waits up to `llmTimeout` (50 s). Only the table loop goroutine waits; every stream keeps running on its own goroutine.
- **Next:** The llm service (step 20).

**20. Build the prompt and call the model.**
- **Where / trigger:** llm service. FastAPI validates the body as `DecisionRequest` and calls the route.
- **Code:** `llm/app.py` → `decide_turn`; `llm/decide.py` → `decide`; `llm/prompts.py` → `render_user_prompt`; `llm/decide.py` → `ask`; `llm/providers/openrouter.py` → `complete`.
- **Does:** Sets a deadline of `TURN_BUDGET` (45 s) for the whole turn and renders the user prompt, which ends with a `Legal actions:` line; the `system_prompt` is fixed and neither names a model. Posts both to `https://openrouter.ai/api/v1/chat/completions` for the model id `MODELS[request.player_name]`, with a timeout of `REQUEST_TIMEOUT` (25 s) or what is left of the budget. A provider failure is retried after `BACKOFF` (1 s, then 2 s) while the budget allows; a read timeout is not.
- **Next:** The reply text goes to step 21. With the mock provider (`LLM_PROVIDER=mock`, or `LLM_PROVIDER` unset or `auto` with no `OPENROUTER_API_KEY`), `llm/providers/mock.py` → `complete` returns a random legal action as reply text, which step 21 parses like any other reply, and no model is called. `LLM_PROVIDER=openrouter` without a key does not fall back to the mock.

**21. Parse the reply and check it.**
- **Where / trigger:** llm service. A reply came back.
- **Code:** `llm/parsing.py` → `parse_response`; `llm/decide.py` → `check_legal`; `llm/prompts.py` → `render_retry_prompt`.
- **Does:** Reads the `ACTION`, `AMOUNT` and `REASON` lines into `action`, `amount` and `reason`, then checks the move against `legal_actions`. On the first miss it sets `retried`, adds the reply and one retry message to the conversation and repeats the model call of step 20 once. The final `status` is `ok`, `unparseable`, `illegal`, `timeout`, `api_error` or `service_error`.
- **Next:** The route returns a `DecisionResponse` to the engine: the decision plus `prompt`, `raw`, `latency_ms`, `model`, the token counts, `cost_usd` and `prompt_version`.

**22. Check the move against the rules.**
- **Where / trigger:** engine, table loop goroutine. The HTTP call of step 19 returns.
- **Code:** `engine/api/table.go` → `decideLLMTurn`; `engine/api/table.go` → `checkLLMDecision`; `engine/api/table.go` → `fallbackAction`; `engine/api/record.go` → `appliedAction`; `engine/game/action.go` → `TryAction`.
- **Does:** A transport error or a non-200 answer becomes a decision with status `service_error`. Otherwise the action and the amount are played on a copy of the game (`TryAction` runs `ProcessAction` on the copy). If the status is not `ok` or the game refuses the move, the fallback is played on a fresh copy instead: `CHECK` when legal, else `FOLD`. That copy is the table after the move. `appliedAction` (in `engine/api/record.go`) names the seat's move in it: the action, as `BET`, `RAISE`, `ALL_IN` and so on, with the chips added on a `CALL`, the street total on a `BET`, `RAISE` or `ALL_IN`, and 0 on `FOLD` and `CHECK`. The `llm_action` of step 23 and the saved hand's `applied` of step 24 both read that one value.
- **Next:** Step 23.

**23. Publish `llm_action`.**
- **Where / trigger:** engine, table loop goroutine. Step 22 returns.
- **Code:** `engine/api/table.go` → `playTurn`.
- **Does:** Sleeps until `thinkingDuration` (5 s) has passed since `llm_thinking` went out. Stores the `llm_action` message `{turn, playerIdx, playerName, action, amount, reason}` as `t.turn` and publishes it; `action` and `amount` are the applied move of step 22, not the model's reply, so a fallback shows the fallback action with amount 0, and a raise is named by `game.RaiseName` (`BET` when nobody has bet on the street, else `RAISE`), the rule that also names it in `legal_actions`, the seat's `lastAction` and the saved hand's `applied`. Then it sleeps while viewers read: 25 ms per byte of `reason` (Go's `len` of the UTF-8 string, so a non-ASCII character counts two to four times) plus 200 ms, held between `minReasoning` (5 s) and `maxReasoning` (10 s), and only then multiplied by `TABLE_PACE`.
- **Next:** Step 24.

**24. Apply the action and publish `game_state`.**
- **Where / trigger:** engine, table loop goroutine. The reasoning sleep ends.
- **Code:** `engine/api/table.go` → `playTurn`; `engine/api/record.go` → `endDecision`; `engine/api/table.go` → `advanceStreet`; `engine/api/table.go` → `stateMessage`.
- **Does:** Under `t.mu` it makes the copy of step 22 the game, so the table gets exactly the move the `llm_action` showed, records the reply and the applied action in the hand's record, and advances the street if the betting round is over. It sets `turnApplied` true and publishes `game_state`, which carries the new street, the board and, when the hand ended, `winners`. Then it sleeps `postActionDelay` (5 s).
- **Next:** Back to step 17.

## The event reaches every viewer

**25. Build the table's snapshot.**
- **Where / trigger:** engine, table loop goroutine, holding `t.mu`. Every publish of steps 5, 6, 17, 18, 23, 24, 40 and 42 calls it.
- **Code:** `engine/api/table.go` → `publish`, `nextHandMs`; `engine/api/messages.go` → `ConvertGameState`.
- **Does:** Builds a new `tableSnap` from the table's fields: `State` (`ConvertGameState`'s view plus `peeked`), `Turn`, `TurnApplied`, a copy of `ButtonCards`, `ButtonWinner`, `Notice` when its kind is not empty, and `nextHandAt` when the hand is complete. `State` includes every seat's hole cards: viewers see them all. A `game_state` among the publish's messages (`stateMessage` leaves its payload empty) gets this same `State`, with `nextHandInMs` from `nextHandMs`, the one rule step 15's snapshot also uses.
- **Next:** Passes the snapshot and this publish's messages to the hub (step 26).

**26. Append to the ring and swap the snapshot.**
- **Where / trigger:** engine, the publishing goroutine: the table loop (step 25) or the stats goroutine (step 41).
- **Code:** `engine/api/stream.go` → `publish`; `engine/api/stream.go` → `sseFrame`.
- **Does:** Before taking the lock it marshals each message as `{table, type, payload}`; if one fails, the whole publish is dropped. Under the hub's write lock each message gets the next `seq` and its frame goes into ring slot `seq % ringSize` (50 slots); then the table's entry in `tables` is replaced and `wake` is replaced by a new channel. After unlocking it closes the old channel.
- **Next:** The close wakes every handler goroutine blocked on that channel (step 27). One frame; each ends with a blank line:

```
data: {"seq":1043,"table":"tbl_9f2c41d07ab35e18","type":"llm_thinking","payload":{"turn":4,"playerIdx":3,"playerName":"Phi-4","budgetMs":45000,"elapsedMs":0}}
```

**27. Each writer sends what it has not sent.**
- **Where / trigger:** engine, every stream's handler goroutine. The `wake` channel it waits on is closed.
- **Code:** `engine/api/stream.go` → `handleStream`; `engine/api/stream.go` → `since`; `engine/api/stream.go` → `write`; `engine/api/stream.go` → `send`.
- **Does:** Under the read lock it copies frames `last+1` to `seq` out of the ring. If it is more than `ringSize` behind, it takes a fresh snapshot instead, as in step 15. It writes each frame with an `eventWriteWait` (10 s) deadline and flushes once per batch; a write error ends this stream only (step 43).
- **Next:** Sets `last` and blocks again. The bytes cross Railway's edge to the browser (step 29).

**28. Heartbeat.**
- **Where / trigger:** engine, handler goroutine. The ticker of step 14 fires every 20 s from the moment the stream opened, whether or not events were sent.
- **Code:** `engine/api/stream.go` → `handleStream`.
- **Does:** Writes the comment `: hb` and a blank line with the 10 s deadline, then flushes. `EventSource` drops comment lines, so nothing fires in the browser.
- **Next:** Back to the top of the handler's loop: `engine/api/stream.go` → `since` runs again (step 27 if frames arrived), then the `select`.

## The browser applies it and draws

Every frame takes this path: the snapshot first, then the full stats, then live events.

**29. Parse and route the frame.**
- **Where / trigger:** browser. `EventSource` fires `message` for each `data:` frame.
- **Code:** `web/src/lib/api.ts` → `connect`; `web/src/hooks/useGameState.ts` → `useGameState`.
- **Does:** The `es.onmessage` handler sets `reconnectAttempts` to 0 and parses `event.data` as JSON; `seq` is never read. One `try` wraps both the parse and the `onMessage` call, so a bad frame, or anything `onMessage` throws synchronously, is logged as `Failed to parse message` and dropped; the state updaters run later, outside it. The hook's `onMessage` callback sends a `stats` message to the stats state (step 32). Every other message goes to the tables state with one `Date.now()` reading (steps 30 and 31).
- **Next:** React runs the pure functions of `web/src/lib/stream.ts` as state updaters.

**30. Apply a snapshot.**
- **Where / trigger:** browser. The message type is `snapshot`.
- **Code:** `web/src/lib/stream.ts` → `applyMessage`; `web/src/lib/stream.ts` → `fromSnapshot`; `web/src/lib/stream.ts` → `applyTurn`; `web/src/lib/stream.ts` → `reveal`.
- **Does:** The browser holds each table as a `TableView`, defined in `web/src/lib/stream.ts`: `gameState`, `notice`, `display` (the turn on screen and its phase), `clock` (the turn's `budgetMs` and `elapsedMs` as the engine sent them, `received`, the browser's `Date.now()` when the message arrived, and whether it runs) and `buttonDetermination`. A snapshot replaces all tables with those in `payload.tables` (a table missing from it is dropped): each takes `gameState` and `notice` from the snapshot and builds `buttonDetermination` from `buttonCards` and `buttonWinner`. If the snapshot's `turn` is the one on screen (same hand number, turn number and message type), the `display` object and the `clock` are kept; if not, `display` is built from `turn` and an `llm_thinking` starts the clock with its `budgetMs` and `elapsedMs` (the time the turn had run when the snapshot was written), received now, so a viewer who joins mid-turn sees the time really left; an `llm_thinking` without `budgetMs` gets no clock. If thinking is on screen and the snapshot carries that turn's `llm_action`, the display is rebuilt as reasoning and keeps the old clock; an `llm_action` that is not on screen gets no clock (`clock` null), so a late joiner who lands in the reasoning phase sees no shot clock. When `turn` is null, `display` and `clock` are cleared. `turnApplied` true moves phase `reasoning` to `revealed` and stops a running clock.
- **Next:** Step 33.

**31. Apply a table event.**
- **Where / trigger:** browser. Any other message that has a `table`; one without it is ignored.
- **Code:** `web/src/lib/stream.ts` → `applyMessage`; `web/src/lib/stream.ts` → `applyTableMessage`; `web/src/lib/stream.ts` → `applyTurn`; `web/src/lib/stream.ts` → `reveal`.
- **Does:** Applies the message to `tables[m.table]`, starting from `EMPTY_TABLE` if that entry is missing. What changes depends on `type`, as the table below shows.
- **Next:** Step 33.

| `type` | Change to that table |
|---|---|
| `llm_thinking` | `display` gets phase `thinking`; `clock` becomes `{budgetMs, elapsedMs, received: now, running: true}`, or null without `budgetMs` |
| `llm_action` | `display` gets phase `reasoning` with `reason`, `action` and `amount`; the clock stops: the move has arrived |
| `game_state` | `gameState` is replaced; phase `reasoning` becomes `revealed`; the clock stops if it still runs |
| `hand_start` | `notice`, `buttonDetermination`, `display` and `clock` are cleared |
| `table_notice` | `notice` is set, or null when `kind` is `""` |
| `button_card` | `buttonDetermination` gains a card; its winner and `isComplete` are reset |
| `button_winner` | `buttonDetermination` gains its winner; with no button cards held it stays null |

**32. Apply stats.**
- **Where / trigger:** browser. The message type is `stats`.
- **Code:** `web/src/lib/stream.ts` → `applyStats`.
- **Does:** A payload without `changed` is the full body and replaces the held stats. A payload with `changed` replaces those rows by `name`, orders `models` by `model_names`. It is ignored while no full body is held.
- **Next:** The stats screens (step 37).

**33. Derive what the page shows.**
- **Where / trigger:** browser. React re-renders after the state update.
- **Code:** `web/src/hooks/useGameState.ts` → `useGameState`; `web/src/app/page.tsx` → `Home`.
- **Does:** The hook returns the first table's `gameState`, `notice`, `display` and `buttonDetermination`. While `clock.running`, a 1000 ms interval sets `shotClockRemaining` to the whole seconds left, `budgetMs - elapsedMs - (Date.now() - received)` (`web/src/lib/stream.ts` → `clockLeft`, never below 0); the site holds no limit of its own. It shows `budgetMs - elapsedMs` until the first tick, keeps its last value once the clock stops, and is null (no clock shown) when there is no clock. The page derives `players`, `pot`, `communityCards`, `street`, `handNumber` and `winnersByIdx`, and highlights seat `displayState.playerIdx`, else `gameState.currentPlayerIdx`, except once the street is `complete`: between hands no seat glows. `winnersByIdx` sums each winner's `winners[].amount`, the chips the pots paid it (the whole pot when everyone else folded, the winner's own chips included, as at showdown). When the street is `complete` it sets `nextHandCountdown` to `Math.ceil(nextHandInMs / 1000)` and counts it down with 1 s timeouts, and sets it to null on any other street; a reconnect's snapshot carries a fresh `nextHandInMs`, which restarts the countdown. The `HH:MM:SS` timer is recomputed every second from `gameState.gameStartTime`, its first value before the paint. The status label is `Offline` (`connection` `down`), `Closed`, `Paused` or `Live`. On the first state each blank box (seats, felt, Profits & Losses, reasoning bar, sticky bar; API usage and the session bar on their own answer) fades its content in where it stands over 0.3 s (`useFillIn`; none with reduced motion), and the cards already out are simply there: a board card rises into place only when it is dealt while watching. The stats screens and the model drawer get `loading` while no `stats` frame has come, and once the stream has given up with none, the error `can't reach the game server`, which they show in place of `Stats are loading…`.
- **Next:** Props for steps 34 to 37.

**34. Draw the table.**
- **Where / trigger:** browser. The render of step 33.
- **Code:** `web/src/components/PokerTable.tsx` → `PokerTable`; `web/src/components/Player.tsx` → `Player`; `web/src/components/TableFelt.tsx` → `TableFelt`; `web/src/components/Card.tsx` → `Card`.
- **Does:** The table places the seats around the felt and shows a seat's `lastAction` once, in this street, its action, amount or stack has changed or it has been on the clock (thinking or reasoning); the engine keeps `lastAction` until the hand ends, so a seat that called preflop shows `CALL` on the flop as soon as its `llm_thinking` arrives. A viewer who joins mid-hand has no starting point for the first street they see. On that street only, every last action shows if it is preflop, and only seats with chips in front show one if it is later. From the next street on, the rule above applies. A seat draws its name, stack, position (the engine's `players[].position`, the name the model is told; hidden while the button is drawn), hole cards and one status; its hole cards are face down until the seat is in `peeked` or is the turn on screen (`llm_thinking` peels them up, Player's `HoleCard`), and every seat's are face up once the street is `complete`. The status is, in this order: the win (`+` the chips the pots paid it, with its hand); the last action (when shown); `SMALL BLIND`, `BIG BLIND` or `BET <amount>` while it has chips out; else `FOLD`, `ALL-IN`, `OUT`, `THINKING` (while it is the seat in the thinking or reasoning phase) or `WAITING`. The felt draws the pot, each seat's `currentBet` and the board, or in the board's place a notice or the button cards.
- **Next:** The DOM. Step 35 adds motion on top.

**35. Animate and sound the change.**
- **Where / trigger:** browser. An effect that runs when `players`, `handNumber`, the board count or the winners change, and a second one when a next-hand countdown starts.
- **Code:** `web/src/components/TableMotion.tsx` → `TableMotion`; `web/src/components/TableMotion.tsx` → `fly`; `web/src/lib/sound.ts` → `playSound`.
- **Does:** Compares the new state with the one before it: a new hand flies hole cards from the deck, a stack that fell flies a chip to the bet or the pot, and new winners get chips from the pot. The sounds are `deal` (each hole card landing, and each new board card), `chip` and `showdown`. Between hands, a second effect driven by the next-hand countdown shows the riffling deck where the board was, timed to end just before the deal (none if too little time is left); the deck goes on the deal, or 3 s after the riffle if no deal comes. The deck that shows plays `shuffle` on the frame its cards start to move (`Deck`), each card's flicks scheduled at its landing on the pile and the tap at the squared pile (`RIFFLE`), early by `outputLatency`; with reduced motion there is no deck and the sound plays at once. Sounds play only with the sound switch on and an `AudioContext` created in a click or key press. Nothing moves or sounds while the tab is hidden or the felt is off screen.
- **Next:** Nothing waits on it: the engine has already paced the events.

**36. Show the turn.**
- **Where / trigger:** browser. `displayState` or `shotClockRemaining` changed.
- **Code:** `web/src/components/ReasoningPanel.tsx` → `ReasoningPanel`; `web/src/components/TypewriterText.tsx` → `TypewriterText`.
- **Does:** With no `display` (from `hand_start` until the first `llm_thinking`) the panel shows `Waiting for next action…` under the name `—`. Phase `thinking` shows `Thinking…`; phases `reasoning` and `revealed` show the action (`BET`, `RAISE` and `ALL-IN` with the street total, `CALL` with the chips added) and type the reason at 25 ms per character (all at once with reduced motion), the rate the engine's sleep in step 23 allows for. When the reason is empty, as on the fallback after a `service_error`, the action still shows and is announced, with no reason under it. The shot clock shows until the phase turns `revealed`, and not at all when the turn has no clock. The typewriter is keyed by the reason text, so the same reasoning never types twice.
- **Next:** The DOM.

**37. Update the side panels.**
- **Where / trigger:** browser. The render of step 33; for the stats screens, a change of `stats` (step 32).
- **Code:** `web/src/components/WinningsPanel.tsx` → `WinningsPanel`; `web/src/components/StickyBar.tsx` → `StickyBar`; `web/src/components/UsageIndicator.tsx` → `useUsage`; `web/src/components/StatsSections.tsx` → `StatsSections`.
- **Does:** The winnings panel ranks `players` by `winnings`, and the sticky bar shows the pot and the acting seat once the table scrolls out of view (it slides down on a scroll, and fades in where it sits on a load below the table): no seat before the hand's first `llm_thinking`, `thinking…` during the thinking and reasoning phases, and the action only once revealed (`folds`, `checks`, `calls N`, `bets N`, `raises to N`, `all-in N`). The usage box and the `N watching` count change only on the 30 s poll of step 10. The stats screens re-render only when `stats` changes; every 25 hands of `scope.hands` also refetches `/api/stats/timeline`, and between fetches the timeline's end is stretched to `scope.hands`, so every line's tip stays at now. While the replay plays, a Profiles row shows only the timeline's figures (hands, bb/100, VPIP, PFR, AF) and a dash for the rest.
- **Next:** The page is idle until the next frame.

## The hand ends

**38. Complete the hand.**
- **Where / trigger:** engine, table loop goroutine. The action applied in step 24, or a street settled in step 17, ends the hand.
- **Code:** `engine/api/table.go` → `advanceStreet`; `engine/game/game.go` → `AdvanceStreet`.
- **Does:** The game ends the hand when one player is left, runs out the board when at most one can still act, or resolves the showdown after the river; the street becomes `complete`. The table sets `nextHandAt` to now plus `postActionDelay + nextHandDelay` (12 s). The `game_state` the caller then publishes carries street `complete`, `winners` and `nextHandInMs`.
- **Next:** In the browser `street === 'complete'` shows the winners and starts the `Next hand in Ns` countdown. On the engine the turn loop ends (step 39).

**39. Decide whether the hand is saved.**
- **Where / trigger:** engine, table loop goroutine, no lock held. The turn loop ended with the hand complete.
- **Code:** `engine/api/table.go` → `saveHand`; `engine/api/record.go` → `finish`; `engine/client/llm.go` → `GetSystemPrompt`.
- **Does:** Finishes the `HandRecord` with the board, the pots, each seat's net chips and the showdown cards. Three kinds of hand are not saved: an outage (step 42), a hand with no decision, and a mock-provider hand when the saver is Supabase. `prompt_version` is the first 7 hex digits of a SHA-256 over the source of `llm/prompts.py`, `llm/parsing.py`, `llm/decide.py` and `llm/providers/openrouter.py`; the llm service returns it in every `/decide` reply (step 21) and the hand's record keeps it. If it differs from the version the table last fetched, the table fetches the system prompt with `GET {LLM_SERVICE_URL}/prompt`. If that fails, the hand is still saved, with an empty system prompt; `save_hand` fills the text in later, when a hand with the same `prompt_version` arrives with it.
- **Next:** Step 40.

**40. Save, retrying until it works.**
- **Where / trigger:** engine, table loop goroutine, then Supabase. Step 39 calls it.
- **Code:** `engine/api/store.go` → `saveWithRetry`; `engine/api/store.go` → `save`; `supabase/migrations/20261009000000_create_hand_history.sql` → `save_hand`.
- **Does:** The Supabase saver sends `POST {SUPABASE_URL}/rest/v1/rpc/save_hand` with `p_hand`, `p_prompts` and `p_system_prompt` and a 15 s timeout. In Postgres the function upserts `system_prompts` and inserts into `hands` and `decision_prompts` in one transaction, skipping rows that exist, so a retry is safe. On failure the table publishes `table_notice` with kind `saving` once and retries after `firstSaveWait` (2 s), doubling up to `maxSaveWait` (60 s), for as long as it takes; the notice is cleared when the save succeeds.
- **Next:** Step 41, then the table sleeps until `nextHandAt` and deals again (step 6). Without Supabase, the file saver appends to `hands.jsonl` and `prompts.jsonl`.

**41. Count the hand and publish the stats.**
- **Where / trigger:** engine. The table loop goroutine calls `onSaved`, which step 1 set to the stats cache's `Add` method; the stats goroutine wakes on its `dirty` channel.
- **Code:** `engine/api/stats.go` → `Add`; `engine/api/stats.go` → `run`; `engine/api/stats.go` → `recompute`; `engine/api/stats.go` → `changedRows`; `engine/stats/stats.go` → `ComputeWithTimeline`.
- **Does:** `onSaved` runs inside `engine/api/store.go` → `saveWithRetry` only after a save succeeds, so the hands step 39 skips never reach the cache. The table loop goroutine inserts the hand into the cache in play order and signals `dirty` without blocking; `dirty` holds one signal, so several adds can collapse into one recompute and one event. The stats goroutine recomputes the stats and re-encodes the bodies of `/api/stats` and `/api/stats/timeline`. It publishes one `stats` event through step 26 with no table id: the payload is the all-time envelope (`generated_at`, `scope`, `seated`, `partial`, defined in step 4) plus `model_names` and the `changed` rows, without `models` (the full body the first time), and the hub's stored `stats` frame becomes the new full body.
- **Next:** Steps 27, 29 and 32 deliver it. The stats screens re-render, the changed Matchups cells flash (`web/src/lib/stats.ts` → `useChanges`) and, once every 25 hands, the timeline is refetched.

**42. A voided hand.**
- **Where / trigger:** engine, table loop goroutine. Step 39 found an outage: no decision with status `ok` and at least one `timeout`, `api_error` or `service_error`.
- **Code:** `engine/api/table.go` → `outage`; `engine/api/table.go` → `playHand`; `engine/api/table.go` → `restore`.
- **Does:** Puts every stack, the winnings and the button back to what step 6 remembered and clears the winners, so no seat shows chips the hand no longer gave. Sets a notice of kind `outage` and `nextHandAt` to now plus `outagePause` (5 min), and sends in one publish: `table_notice`, then `game_state`. Nothing is saved and the stats do not change.
- **Next:** It sleeps, then step 6 deals the probe hand and clears the notice with a `table_notice` of kind `""` right before `hand_start`.

## The connection drops or the server ends it

**43. The handler returns.**
- **Where / trigger:** engine, handler goroutine. Its lifetime timer fires 10 to 14 min after open, the request context ends because the viewer left, or a write fails or passes its deadline.
- **Code:** `engine/api/stream.go` → `handleStream`.
- **Does:** Returns, which ends the response. The deferred calls stop the timer and the ticker and take the stream out of the `open` counter and the per-address count. The hub keeps no list of streams, so nothing else is unregistered.
- **Next:** The browser's `EventSource` fires `error` (step 44). So do a network drop, a 502 from Railway while the engine restarts, and the 429 and 503 of step 13.

**44. Close and schedule a reconnect.**
- **Where / trigger:** browser. `EventSource` fires `error`.
- **Code:** `web/src/lib/api.ts` → `connect`; `web/src/lib/api.ts` → `handleReconnect`.
- **Does:** The `es.onerror` handler calls `es.close()`, so the browser's built-in retry never runs, and rejects the promise of step 12. An `EventSource` that has already been replaced or disconnected (`this.es !== es`) stops there. Otherwise `web/src/lib/api.ts` → `handleReconnect` runs, and does nothing while a reconnect timer is already pending. With `reconnectAttempts` at `maxReconnectAttempts` (10) it reports `gave_up` and sets no timer, so the page stays disconnected until Retry. Otherwise it adds one, sets a timer and reports `reconnecting`: the timer is a random 0 to 1000 ms for attempt 1, then `reconnectDelay` (2000 ms) × the attempt number × a random 0.5 to 1.5. The delays alone add up to 54 to 163 s, about 109 s on average, before `gave_up`, plus each attempt's own connection time.
- **Next:** The timer runs step 12 again. Steps 13 to 16 follow and the new stream starts with a snapshot.

**45. Keep the screen as it is.**
- **Where / trigger:** browser. Status `reconnecting` reaches the hook; a moment later the new snapshot arrives.
- **Code:** `web/src/hooks/useGameState.ts` → `useGameState`; `web/src/lib/stream.ts` → `fromSnapshot`.
- **Does:** The hook's `onStatus` callback sets `gaveUp` to whether the status is `gave_up`, so any `reconnecting` hides the Retry button, and starts `offlineTimer`: only after `OFFLINE_AFTER_MS` (4000 ms) without an `open` does `connection` turn `down`, which shows `Offline` and the bar `Connecting to the game server…`; `gave_up` turns it `down` at once. The table keeps its last state meanwhile. When the new snapshot names the turn already on screen, step 30 keeps the display object and the clock, so the reasoning does not retype and the shot clock does not reset.
- **Next:** Live events resume at step 29. The first message resets `reconnectAttempts`.

**46. Give up, then Retry.**
- **Where / trigger:** browser. Ten reconnect attempts pass without a single message; later the viewer clicks Retry.
- **Code:** `web/src/app/page.tsx` → `Home`; `web/src/hooks/useGameState.ts` → `useGameState`; `web/src/lib/api.ts` → `retry`.
- **Does:** With `gaveUp` true the bar reads `Can't reach the game server.` and shows a Retry button. The click calls the hook's `retry`, which calls the stream's `retry` through `streamRef`. That clears any pending timer, sets `reconnectAttempts` to 0, reports `reconnecting` and opens a new stream at once. The `reconnecting` status sets `gaveUp` false, so the bar goes back to the spinner and `Connecting to the game server…` until an `open` arrives. While `gaveUp` holds and no stats have come, the stats screens and the drawer say the game server can't be reached (step 33).
- **Next:** Step 12.

## Where to change things

| To change | Start here |
|---|---|
| A new event type | The `MessageType` and payload struct in `engine/api/messages.go`; publish it through `engine/api/table.go` → `publish`; add it to `MessageType` in `web/src/lib/api.ts`; handle it in `web/src/lib/stream.ts` → `applyTableMessage`; document it in [stream.md](stream.md). |
| A new field in the snapshot | `tableSnap` in `engine/api/stream.go`, filled by `engine/api/table.go` → `publish`; then `SnapshotTable` and `web/src/lib/stream.ts` → `fromSnapshot`. |
| A new field in the game state | `GameStatePayload` and `engine/api/messages.go` → `ConvertGameState`; then `GameState` in `web/src/lib/api.ts`. |
| The reconnect timing | `web/src/lib/api.ts` → `handleReconnect` with `reconnectDelay` and `maxReconnectAttempts`; `OFFLINE_AFTER_MS` in `web/src/hooks/useGameState.ts`; the server's side is `streamLifetime` in `engine/api/stream.go`. |
| The heartbeat | `heartbeatEvery` and `heartbeat` in `engine/api/stream.go`, used by `engine/api/stream.go` → `handleStream`. |
| The pace of a turn | `thinkingDuration`, `minReasoning`, `maxReasoning` and `postActionDelay` at the top of `engine/api/table.go`, used by `engine/api/table.go` → `playTurn`; or set `TABLE_PACE`. |
| What a seat shows | `web/src/components/Player.tsx` → `Player`; when a seat may show its last action is decided in `web/src/components/PokerTable.tsx` → `PokerTable`. |
| The prompt | `system_prompt` and `llm/prompts.py` → `render_user_prompt`; its data comes from `engine/api/decision.go` → `buildDecisionRequest`; keep `web/src/lib/systemPrompt.ts` equal, which `llm/tests/test_prompts.py` checks. |
| How a hand is saved | `engine/api/table.go` → `saveHand` (what is skipped), `engine/api/store.go` → `saveWithRetry` (retry and notice), `engine/api/record.go` → `newHandRecorder`, `engine/api/record.go` → `beginDecision`, `engine/api/record.go` → `endDecision` and `engine/api/record.go` → `finish` (what the record holds: seats, blinds and deck at the deal, each decision as it is made, then the board and result at the end) and the SQL function `save_hand` under `supabase/migrations/`. |
| A stat | `engine/stats/stats.go` → `addHand` (counting) and `engine/stats/stats.go` → `result` (the row); then `ModelStats` in `web/src/lib/stats.ts` and the column in `web/src/components/StatsTable.tsx`; the formula goes in [stats.md](stats.md). |
