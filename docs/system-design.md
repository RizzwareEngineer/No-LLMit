# No-LLMit system design

No-LLMit is a live No-Limit Hold'em game played by LLMs. People watch it in a browser. Nobody plays.

**Built on this branch (`feat/sse-stream`):** one table, delivered to every viewer over one Server-Sent Events stream, `GET /stream`. The wire format is in [stream.md](stream.md).
**Not built:** more than one table, a table picker, and relay servers. The diagram draws ten tables because ten is the ceiling the design allows. The code constructs exactly one.

![Viewers' browsers GET the page from Vercel (1) and open GET /stream to the Go game server on Railway (2). The table loop sends state and legal actions to the Python LLM service, which calls OpenRouter (3). The table appends each event to an in-memory ring of the newest 50 and updates an in-memory snapshot in one locked step (4). Each viewer's stream writer reads the events after the last number it sent (5) and writes the snapshot, then every new event, to its browser (6). At hand end the table saves the hand to Postgres on Supabase before dealing the next (7). A reconnect is a new GET /stream (8).](system-design.png)

## Requirements

- Every viewer sees the same live game, in order. A viewer who joins or rejoins sees the game as it is now.
- 1 to 5,000 concurrent viewers. Normal load is 5 to 10. A burst of thousands happens when a tweet lands.
- Up to 10 tables at once. Today the code runs 1.
- Every finished hand is kept, with each decision and its reasoning. Stats (bb/100, VPIP, matchups) are current to the last hand.
- Hobby cost, run by one person.

## The design, step by step

The numbers match the diagram.

**1. GET the page.** The browser GETs the static Next.js build (HTML, JS, CSS) from Vercel's CDN. No server renders HTML.
Without it: the Go process would serve page assets to every burst viewer, on the same CPU that runs the table.

**2. GET /stream, one per viewer.** The browser opens `EventSource` at `${API_URL}/stream` on the Go engine on Railway. `API_URL` is still derived from `NEXT_PUBLIC_WS_URL`. The response is `200`, `Content-Type: text/event-stream`, `Cache-Control: no-store`, `Access-Control-Allow-Origin: *`, no `Content-Length`. Traffic on it is one-way, server to browser. The browser sends nothing per event. The usage, timeline and waitlist requests remain as ordinary GETs and POSTs.
Without it: viewers would have to poll, and moves would arrive late and out of step with the table's pacing.

**3. Table loop asks the LLM service.** One goroutine per table runs deal, ask the next player, apply the action, repeat. To ask, it POSTs the game state as that player sees it plus the legal actions to `POST /decide` on the Python FastAPI service on Railway. That service builds the prompt, calls the model through OpenRouter, and parses the reply. The engine checks legality. If the reply is illegal or the 45 s turn budget runs out, the engine checks if it can and otherwise folds. All pacing sleeps live in this goroutine, so an event is published at the moment it should appear.
Without it: prompt and provider code would live in the engine, and one model's 45 s wait would sit inside the process that streams to viewers.

**4. Append to recent events and update the snapshot, in one locked step.** The hub holds a `sync.RWMutex`, one `seq` counter shared by all tables, a ring of 50 slots of `{seq, frame}`, a snapshot value per table, the full stats body, and a `wake` channel. The table marshals each event to its SSE frame once, before taking the lock. Under the lock it increments `seq`, writes the ring slot, swaps that table's snapshot, and replaces `wake` with a new channel. After unlocking it closes the old channel, which wakes every writer. All events of one table step (for example `street_change`, `hand_complete`, `game_state`) go in one publish. The lock is never held during a marshal, an LLM call or a save.
Without the lock: a writer could read a ring entry and a snapshot that disagree, and two tables could interleave half-written steps.
Without the ring: every wake would have to resend the whole snapshot to every viewer.
Without the snapshot: a joiner would only see the game from its next event.

**5. Events after its last number.** Each `GET /stream` handler goroutine is that viewer's writer. It remembers the last `seq` it sent. On wake it takes the read lock, reads `seq` and `wake` together, and copies frames `last+1..seq` from the ring. A writer exactly 50 behind is served from the ring. One 51 or more behind gets a fresh snapshot instead.
Without one writer per viewer: one slow socket would block everyone else's delivery.

**6. Snapshot, then every new event.** On connect the writer flushes the 200, then writes one `snapshot` message holding, for every table, its state, the hand's last turn (thinking or an action, with whether the action is applied) or null, the notice or null, the whole button-cards list and the button winner or null. Then it writes one `stats` message with the full precomputed all-time stats body. After that it writes each new event, flushes, and waits on `wake`, a 20 s heartbeat ticker (`: hb`), a lifetime timer of a random 10 to 14 minutes, or the request context. Each write has a 10 s deadline (60 s for the snapshot and stats). Any write error ends the handler.
The browser replaces all table state when a snapshot arrives. It keeps the turn already on screen when the snapshot's turn is the same one, so a reconnect every 10 to 14 minutes changes nothing on screen: reasoning does not retype, the revealed action stays, and the shot clock does not reset.
Without the one-message snapshot: a mid-stream snapshot would leave a cleared notice or finished turn on screen and double the button cards.

**7. Hand end: save it, then deal the next hand.** The table publishes `hand_complete` and `game_state`. Then, outside every lock, it calls Supabase's `save_hand` database function (`POST /rest/v1/rpc/save_hand`, 15 s timeout), which writes the hand, every decision, the prompts and the system prompt. Voided hands, hands with no decision and mock-provider hands are skipped first. On failure it retries forever, 2 s doubling to a 60 s cap, and after the first failure sets the table notice "The table is paused until the last hand is saved." Stats count the hand only after the save succeeds, so a process death between showing and saving loses at most one hand per table.
Stats are computed in memory from finished hands. At boot they load from Supabase. After each recompute that added a hand, the hub swaps the full stats body and publishes one `stats` event with every row that changed, as absolute values keyed by model name.
Without the blocking save: a hand could be shown and never stored, which is the spill-file path this replaces.

**8. Reconnect: a new GET /stream.** There is no resume. Frames carry no `id:` and the server ignores `Last-Event-ID`. A reconnect gets a new snapshot. The client reopens the stream itself: on every `error` it calls `es.close()`, waits a random 0 to 1 s the first time and then 2 s times the attempt times a random 0.5 to 1.5, and gives up after 10 attempts with a Retry button. It does not rely on `EventSource`'s built-in retry, which stops for good after a non-200 answer, such as Railway's 502 while the engine restarts. The page shows Offline only after 4 s without an open stream.
Without it: Railway ends every HTTP request at 15 minutes. WebSockets are exempt from that limit and SSE is not, so every viewer reconnects at least four times an hour. The server-chosen 10 to 14 minute lifetime spreads a burst's reconnects over four minutes instead of one second.

## Where the data lives

| Data | Where | Lifetime |
|---|---|---|
| Live table state and the current turn | the snapshot value in the engine's hub | until the next event or a restart |
| The newest 50 events | the hub's ring, as encoded SSE frames | overwritten as new events arrive |
| Finished hands, decisions, prompts | Postgres on Supabase, written by `save_hand` | kept |
| All-time stats | engine memory, rebuilt from Supabase at boot | until restart |
| Stats for `/about`, `?session=` and the timeline | `GET /api/stats`, `GET /api/stats/timeline` | served from the same memory |
| What the viewer sees | browser memory, keyed by table id | until the tab closes |

## Numbers

| Figure | Value | Source |
|---|---|---|
| Hands per day, one table | about 150 (9am to 9pm ET, about 12 an hour) | estimated from the call budget |
| Open-stream cap | 6,000; the next request gets 503 | set in code |
| Ring size | 50 events | set in code |
| Egress at 5,000 viewers | about 3.5 MB/s at one table, 21 to 26 MB/s at ten | estimated |
| Egress price | $0.05/GB on Railway | Railway's price list |
| Bytes per reconnect | about 185 KB (snapshot plus full stats) | estimated |
| Memory for 5,000 connections | 100 to 200 MB | estimated |
| Memory for stats | about 16 KB per finished hand held since boot, on top of the above | estimated |
| CPU per event at 5,000 viewers | 10 to 25 ms | estimated |
| LLM usage refresh | at most once per 60 s, cached in the engine | set in code |

Nothing here was measured under load. A 5,000-connection load test is an experiment that needs the owner's go.
More replicas do not help, because the game state lives in one process. The next step past one instance would be relay servers. That is not planned.

## When something fails

| What fails | What happens |
|---|---|
| A viewer's connection drops | The client closes it and reopens after 0 to 1 s, then backs off. The new stream starts with a snapshot. The table is unaffected. |
| A slow viewer | Its writer blocks on its own socket. The 10 s write deadline ends that stream and the client reconnects. If it falls 51 or more behind, it gets a snapshot. Other viewers are unaffected. |
| The engine restarts | Every stream ends and Railway's edge answers 502 until the process is back. Clients keep retrying. The hand in progress is lost, and at most one shown but unsaved hand. The table gets a new 8-byte random id so hand ids cannot collide with saved ones. Stats reload from Supabase. |
| Postgres (Supabase) is down | The save retries forever with backoff. The table pauses with the "saving" notice. Streams stay open. Stats do not change until the save succeeds. |
| The LLM service or OpenRouter is down | Each failed call is a check or fold. If every call in a hand fails, the hand is voided: stacks and button are restored, the outage notice is set, nothing is saved, and the table pauses 5 minutes. |
| More than 6,000 streams | `/stream` answers 503 before any stream header. The client retries with backoff and shows Retry after 10 failures. |

## What the review attacked, and what came of it

Twelve changes were adopted:

1. The client reopens the stream itself, because `EventSource` never retries after a non-200.
2. The routine 15-minute reconnect is hidden: 0 to 1 s first retry, a 4 s Offline grace, and a 10 to 14 minute server lifetime.
3. The snapshot is one message that replaces all table state, used on connect and when 51 or more behind.
4. A snapshot keeps the turn already on screen, and `nextHandInMs` is computed when it is written.
5. Joiners get the full stats on the stream, and each hand end sends whole changed rows.
6. The save keeps `save_hand`, blocks the table with retry, and shows the "saving" notice. The queue, spill file and replay are deleted.
7. `/api/usage` is cached for 60 s in the engine, and the viewer count comes from an atomic counter of open streams.
8. Streams are capped at 6,000 with a 503.
9. The table id is 8 random bytes instead of 3, because the hand number restarts at 1 on every boot.
10. Every event carries its table id and the browser keeps state by table id, with exactly one table constructed.
11. The merge-gate checks in `web/scripts/checks.mjs` script `EventSource` instead of `WebSocket`.
12. Four sentences of the design were corrected: egress, the Railway 15-minute rule, when a hand counts, and what the browser still sends.

Rejected:

- Polling once a second. It also meets the written requirements, but the review found no failure in SSE, and SSE was a deliberate choice.
- Dropping the buffer of 50. Its only failure case came from the old multi-message snapshot, fixed by change 3. The ring is also the main delivery path on every wake, and the stats event is a delta that needs it.

## Not decided

- Lineups: which models sit at each table when there is more than one?
- The daily call cap: is it per table or shared, and what is the model budget for ten tables?
- The picker: how does a viewer choose a table, and what do the stats live session and the calls bar show with several?
- Storage: prune old hands or move to Supabase Pro, before the table count or budget goes up?
- Stats memory: running accumulators instead of every hand in memory, before ten tables run for weeks?

## Spoken version

No-LLMit runs a poker game between language models, and people watch it live.
The page itself is static files on Vercel.
When the page loads, the browser opens one long HTTP request to our Go server on Railway, called slash stream.
That request uses Server-Sent Events, so the server can keep pushing messages down it.
Inside the server, one goroutine runs the table.
When it is a model's turn, it posts the game state to a separate Python service, which calls the model through OpenRouter and returns an action.
Every action becomes a numbered event.
The table puts it into a ring of the last 50 events and updates a snapshot of the whole table, under one lock, for microseconds.
Then it wakes every viewer's writer.
Each viewer has its own writer goroutine.
It sends the snapshot first, then every event after the last one it sent.
If it falls more than 50 events behind, it just sends a fresh snapshot.
So a slow viewer only slows itself down.
When a hand ends, the server saves it to Postgres on Supabase and waits for that to succeed before dealing again.
If the connection drops, the browser reconnects and gets a new snapshot.
Railway cuts requests at 15 minutes, so the server ends each stream a little before that, at a random time.
