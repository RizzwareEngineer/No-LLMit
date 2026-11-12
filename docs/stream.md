# Stream

`GET /stream` on the engine is the only way the browser hears the game. It is one-way
Server-Sent Events: the browser opens it with `EventSource` at `${API_URL}/stream` and
never sends anything on it. The code is `engine/api/stream.go`, `web/src/lib/api.ts` and
`web/src/hooks/useGameState.ts`.

## Response

`200` with these headers, no `Content-Length`, flushed before the first message:

```
Content-Type: text/event-stream
Cache-Control: no-store
Access-Control-Allow-Origin: *
```

When 6,000 streams are already open the answer is `503` with a plain-text body, before any
stream header is written. When 50 streams are already open from the viewer's address
(`X-Real-IP`; an IPv6 address counts by its /64) the answer is `429` the same way. The
client treats either like any other error and retries.

Every message is one frame: `data: ` and one line of JSON, then a blank line. There is no
`id:`, `event:` or `retry:` line. Every 20 s with nothing else to send the server writes the
heartbeat comment `: hb` and a blank line; `EventSource` ignores it. Each stream ends itself
after a random 10 to 14 minutes, chosen when it opens; the client then reconnects.

## Envelope

```json
{"seq":1042,"table":"tbl_9f2c41d07ab35e18","type":"llm_action","payload":{}}
```

- `seq`: one counter for all tables. A `snapshot` carries the counter it reflects; the full
  `stats` written after it carries the counter of the publish that set those stats. The
  client never reads it.
- `table`: the table id, `tbl_` and 16 hex digits. `snapshot` and `stats` have no `table`.
- `type` and `payload`: below. No type is called `error`; `get_state` and `error` are gone.

## Table messages

The payloads are today's Go structs in `engine/api/messages.go`, unchanged.

| type | payload |
|---|---|
| `game_state` | `GameStatePayload` (whole table; `nextHandInMs` is worked out when the frame is made) |
| `hand_start` | `{"handNumber":12}` |
| `street_change` | `{"street":"flop"}` |
| `hand_complete` | `{"winners":[WinnerPayload],"handNumber":12}` |
| `llm_thinking` | `{"turn":4,"playerIdx":3,"playerName":"Phi-4"}` |
| `llm_action` | `{"turn":4,"playerIdx":3,"playerName":"Phi-4","action":"RAISE","amount":60,"reason":"..."}` |
| `button_card` | `{"playerIdx":0,"playerName":"Phi-4","card":"Ah"}` |
| `button_winner` | `{"playerIdx":0,"playerName":"Phi-4"}` |
| `table_notice` | `{"kind":"cap","message":"Daily LLM call limit reached.","reopensAt":"2026-11-11T00:00:00Z"}` |

`turn` numbers the hand's turns from 1; a turn's `llm_thinking` and `llm_action` carry the
same number.

Events of one table step arrive back to back: `hand_start` then `game_state`; `street_change`
(and `hand_complete` when the hand ends), then `game_state`. The `game_state` after an `llm_action` is what applies the
action (the page moves its reasoning to revealed); the action stays the table's turn until the
next `llm_thinking` or `hand_start`. There is no turn-cleared message.

`table_notice` kinds: `closed`, `cap`, `outage`, `saving`, and `""`, which clears the notice.
`outage` is cleared right before the next `hand_start`, which deals the probe hand.
`saving` is sent after the first failed attempt to save a finished hand and cleared when the
save succeeds:

```json
{"seq":2210,"table":"tbl_9f2c41d07ab35e18","type":"table_notice","payload":{"kind":"saving","message":"The table is paused until the last hand is saved."}}
```

## snapshot

Written first on every stream, and again whenever the stream falls more than 50 messages
behind (exactly 50 behind is still served message by message). `payload.tables` has every
running table, keyed by table id; before the lineup is known it is `{}`. Every key is always
present: `turn`, `notice` and `buttonWinner` are `null` when there is none, `buttonCards` is
`[]` when there are none. `turn` is the hand's last `llm_thinking` or `llm_action` as
`{type,payload}` (no `seq` or `table`), or `null` from `hand_start` until the hand's first
`llm_thinking`. `turnApplied` is `true` when `turn` is an `llm_action` that the `game_state`
after it has already applied, else `false`. So a snapshot is the whole picture on screen:
thinking, reasoning, or the revealed action. `notice` is `null` when the kind is `""`. `state.nextHandInMs` is worked out when the snapshot is written to
that stream. Examples here are wrapped and abbreviated; on the wire each is one line.

```json
{"seq":1042,"type":"snapshot","payload":{"tables":{"tbl_9f2c41d07ab35e18":{
  "state":{"id":"game_1762804860000000000","handNumber":12,"street":"flop","pot":120,"communityCards":["Ah","7d","2c"],"currentPlayerIdx":3,"buttonIdx":1,"players":[],"stakes":{"smallBlind":5,"bigBlind":10},"gameStartTime":"2026-11-10T20:01:00Z"},
  "turn":{"type":"llm_thinking","payload":{"turn":4,"playerIdx":3,"playerName":"Phi-4"}},
  "turnApplied":false,
  "notice":null,
  "buttonCards":[],
  "buttonWinner":null}}}}
```

## stats

Two forms of the all-time `GET /api/stats` body (`docs/stats-api-contract.json`). Neither
has `table`.

**Full.** Written right after every `snapshot` when the stats are loaded (skipped until then).
The payload is exactly the `GET /api/stats` body, `models` as the list of row objects.

```json
{"seq":1042,"type":"stats","payload":{"generated_at":"...","scope":{},"sessions":[],"models":[{"name":"Phi-4","hands":128}],"seated":["Phi-4"],"definitions_url":"/docs/stats.md","partial":false}}
```

The first `stats` event after the engine starts is also the full form, so a stream that
opened before any stats were loaded gets them whole.

**Changed rows.** Sent once per recompute that added a hand and once when the all-in
warm-up reaches zero left, never per warm-up pass, after that first full event. It has the same envelope keys except `models`, plus `model_names` (every model in the
order `models` must have) and `changed` (each row whose encoded bytes differ from the last
one published, whole and absolute).

```json
{"seq":2209,"type":"stats","payload":{"generated_at":"...","scope":{},"sessions":[],"seated":["Phi-4","Mistral Nemo"],"definitions_url":"/docs/stats.md","partial":false,"model_names":["Mistral Nemo","Phi-4"],"changed":[{"name":"Phi-4","hands":129}]}}
```

The client tells them apart by `"changed" in payload`. For the full form it replaces its
stats. For the changed form it copies the envelope keys and sets
`models = model_names.map(name => changed row with that name, else the held row)`, dropping a
name with neither. Rows are matched by `name` only, never by position.

`GET /api/stats` and `GET /api/stats/timeline` stay for `/about`, `?session=` and the timeline.

## Client rules

- Assign `es.onmessage`, parse the JSON, dispatch on `type`.
- On every `error` event: `es.close()`, then the reconnect loop. The client reopens the
  stream itself; `EventSource`'s own retry is never relied on.
- Reconnect loop: attempt 1 after an error waits a random 0 to 1 s; attempt n ≥ 2 waits
  2 s × n × a random 0.5 to 1.5. After 10 failed attempts the status is `gave_up`
  and the Retry button starts a fresh round. `open` resets the attempt count.
- `isConnected` turns false only after 4 s with no open stream. Nothing is cleared on `open`.
- A `snapshot` replaces all table state; tables absent from it are dropped. Every other table
  message is applied on arrival to `tables[msg.table]`, creating the entry if missing.
- Turn on a snapshot: an `llm_thinking` shows thinking, an `llm_action` not yet applied shows
  reasoning, and an applied one shows revealed. If the snapshot's `turn` is the turn on screen
  (same `state.handNumber` and `turn` number), the display object and shot clock are kept exactly as they are; reasoning only moves
  to revealed when `turnApplied` says so. If thinking is on screen and the snapshot carries that
  turn's action, the turn's start time and shot clock carry over, as on a live `llm_action`.
  Otherwise the display is built from the snapshot, or cleared when `turn` is `null`. A
  reconnect therefore changes nothing on screen.
- The client keeps no `seq`, detects no gaps and queues nothing; the server paces every event.
