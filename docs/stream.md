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
Access-Control-Allow-Methods: GET, POST, OPTIONS
Access-Control-Allow-Headers: Content-Type
```

When 6,000 streams are already open the answer is `503` with a plain-text body, before any
stream header is written (the three CORS headers are still sent). When 50 streams are already
open from the viewer's address (`X-Real-IP`; an IPv6 address counts by its /64; no per-address
cap when the header is missing) the answer is `429` the same way. The
client treats either like any other error and retries.

Every message is one frame: `data: ` and one line of JSON, then a blank line. There is no
`id:`, `event:` or `retry:` line. Every 20 s from the open, whatever else was sent, the server writes the
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

The payloads are the Go structs in `engine/api/messages.go`.

| type | payload |
|---|---|
| `game_state` | `GameStatePayload` (whole table; `nextHandInMs` is worked out when the frame is made) |
| `hand_start` | `{"handNumber":12}` |
| `llm_thinking` | `{"turn":4,"playerIdx":3,"playerName":"Phi-4","budgetMs":45000,"elapsedMs":0}` |
| `llm_action` | `{"turn":4,"playerIdx":3,"playerName":"Phi-4","action":"RAISE","amount":60,"reason":"..."}` |
| `button_card` | `{"playerIdx":0,"playerName":"Phi-4","card":"Ah"}` |
| `button_winner` | `{"playerIdx":0,"playerName":"Phi-4"}` |
| `table_notice` | `{"kind":"cap","message":"Daily LLM call limit reached.","reopensAt":"2026-11-11T00:00:00Z"}` |

`turn` numbers the hand's turns from 1; a turn's `llm_thinking` and `llm_action` carry the
same number.

`llm_action` `action` is one of `FOLD`, `CHECK`, `CALL`, `BET`, `RAISE`, `ALL_IN`. A sized
move is `BET` when nobody has bet on the street yet and `RAISE` otherwise
(`game.RaiseName`, the rule that also names the move in the legal list the model was given);
`amount` is the street total. A move the engine did not take from the model (a fallback)
shows `CHECK` or `FOLD` with `amount` 0. A player's `lastAction` in `game_state` is the
applied move by the same rule: `FOLD`, `CHECK`, `CALL`, `BET`, `RAISE` or `ALL-IN` (with a
hyphen).

In `game_state`, each player's `position` is the name the model in that seat is told and the
saved hand keeps (`game.PositionName`), clockwise from the button: 9 seats `BTN SB BB UTG
UTG+1 MP MP+1 HJ CO`; 8 drops `CO`; 7 drops `HJ` too; 6 `BTN SB BB UTG MP CO`; 5 `BTN SB BB
UTG MP`; 4 `BTN SB BB UTG`; 3 `BTN SB BB`; heads-up `BTN BB` (the button posts the small blind).

In `game_state`, each of `winners` is one pot won: `amount` is the chips that pot paid the
winner (`potNumber` 0 is a pot won by everyone else folding, and its `amount` is the whole
pot, the winner's own chips included), the same number the saved hand's `result.pots` holds.

`budgetMs` is how long the model has for this turn: `turn_budget_s` from the LLM service's
`GET /models` (`llm/decide.py` `TURN_BUDGET`), read once at startup, or the engine's own
50 s decide timeout when the service did not say. `elapsedMs` is how long the turn has run:
`0` on the live event, and in a snapshot's `turn` the time since the event was published,
worked out when the snapshot is written to that stream. The shot clock shows
`budgetMs - elapsedMs`.

Events of one table step arrive back to back: `hand_start` then `game_state`; after a voided
hand, `table_notice` (`outage`) then `game_state`. A new street or the end of a hand is only a
`game_state`: it carries the street, the board and `winners`. The `game_state` after an `llm_action` is what applies the
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
that stream, and so is an `llm_thinking` turn's `elapsedMs`. Examples here are wrapped and abbreviated; on the wire each is one line.

```json
{"seq":1042,"type":"snapshot","payload":{"tables":{"tbl_9f2c41d07ab35e18":{
  "state":{"id":"game_1762804860000000000","handNumber":12,"street":"flop","pot":120,"communityCards":["Ah","7d","2c"],"currentPlayerIdx":3,"buttonIdx":1,"players":[],"stakes":{"smallBlind":5,"bigBlind":10},"gameStartTime":"2026-11-10T20:01:00Z"},
  "turn":{"type":"llm_thinking","payload":{"turn":4,"playerIdx":3,"playerName":"Phi-4","budgetMs":45000,"elapsedMs":20480}},
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
  and the Retry button starts a fresh round. Every message on a stream, the snapshot first, resets the attempt count; an `open` alone does not.
- `isConnected` turns false only after 4 s with no open stream. Nothing is cleared on `open`.
- A `snapshot` replaces all table state; tables absent from it are dropped. Every other table
  message is applied on arrival to `tables[msg.table]`, creating the entry if missing.
- Turn on a snapshot: an `llm_thinking` shows thinking, an `llm_action` not yet applied shows
  reasoning, and an applied one shows revealed. If the snapshot's `turn` is the turn on screen
  (same `state.handNumber` and `turn` number), the display object and shot clock are kept exactly as they are; reasoning only moves
  to revealed when `turnApplied` says so. If thinking is on screen and the snapshot carries that
  turn's action, the turn's start time and shot clock carry over, as on a live `llm_action`.
  Otherwise the display is built from the snapshot, or cleared when `turn` is `null`. A
  reconnect while the turn on screen is still the table's turn therefore changes nothing on screen.
- The client keeps no `seq`, detects no gaps and queues nothing; the server paces every event.
