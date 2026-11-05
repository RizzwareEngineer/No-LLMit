# Multiple tables: system design

Status: proposal, 2026-11-04. Nothing here is built.

## What it has to do

Run several poker tables in the one engine, each with its own lineup, prompt variant, stack policy, pace and hours, under one money budget, with stats that never mix variants. First uses: a headless research table that plays at model speed, and short flagship showcase sessions. The poker rules do not change.

## Design in one paragraph

A table is a config plus a goroutine. The engine loads `engine/tables.json`, builds one `Table` per entry, and runs each in its own goroutine with its own lock, spectators, recorder and spill file, exactly as the single table works today. The server routes `/ws?table=<id>` and `/api/*?table=<id>` to the table by id. One shared `Budget` object meters calls, tokens and dollars per provider per day and is the only hard stop. The LLM service stays stateless and takes the model and prompt variant per request, so one instance serves every table. Each saved hand carries `table_id`, `lineup_id`, `prompt_variant` and `session_id`, and stats are computed per `(table, lineup, variant)`.

## Table config

```
id             "main"              stable; hand ids and sessions key off it
name           "Open models"
lineup         [{seat, display, provider, model}]        2..9 seats
prompt         {variant: "v2", memory: "none"}
stacks         {start: 2000, session_hands: 1000, rebuy: true}
seating        "balanced-8" | "fixed"                     ordering rotates per session
pace           1.0 (display) | 0 (model speed)
hours          {open: 9, close: 21, tz: "America/New_York"} | "always"
gate_on_spectators  true | false
daily_call_cap 5000
enabled        true
```

Config is a file in the repo. Tables change rarely, every change is a reviewed commit with history, and there is no admin UI to build.

## Components and the changes to each

| Component | Change |
|---|---|
| `engine/api/table.go` | `NewTable(cfg)` replaces the globals. Session counter, stack reset at `session_hands`, seating ordering from `cfg`. Spill file per table. |
| `engine/api/server.go` | `tables map[string]*Table`; `/ws?table=`, `/api/tables`, `/api/usage?table=`, `/api/stats?table=`. Missing id = the table marked `featured`. A panic in one table's loop is recovered and that table restarted. |
| `engine/api/budget.go` (new) | Per-provider counters for calls, tokens, USD today; checked before every call; flushed to Supabase every minute and reloaded at boot. Global USD cap = the OpenRouter key limit. When hit, every table shows the cap notice. |
| `llm/app.py` | `/decide` takes `provider`, `model`, `prompt_variant`, `temperature`. System prompts live in `llm/variants/<id>.md`. Seat-name lookup removed. |
| Supabase | `sessions` table (id, table_id, ordering, started, ended, hands); `usage_daily` (day, provider, model, calls, tokens, usd, errors). Hand `config` gains `lineup_id`, `session_id`, `seat_ordering`. |
| `web` | Tab strip from `/api/tables`; `/` is the featured table, `/t/<id>` any table; the spectator component takes a table id. Headless tables show as "research, no live view" with a stats link. |

## Why this is the efficient shape

Load per table is tiny. A displayed table makes about 15 LLM calls per hand at 12 hands an hour, 3 calls a minute; a headless table at model speed makes about 40 a minute. A sleeping goroutine and a few hundred KB of state per table cost nothing measurable; ten tables fit in the current Railway service with no change in plan.

The expensive resources are outside the process, and the design meters exactly those. Money: one in-memory `Budget` is the single point of truth, so there is nothing to coordinate across processes and the hard stop is one comparison per call. Database: a hand is 35–50 KB, so a headless table writes about 50 MB a day and fills Supabase's free 500 MB in ten days; the nightly export and prune (loop 3) must ship before the first headless table, and this design makes that a per-table setting (`archive_after_days`). Provider rate limits: per-provider counters in `Budget` are also where fallback routing hooks in later.

Broadcast cost stays flat: a message is marshalled once per broadcast and copied to each spectator's channel, so 500 spectators on one table is 500 channel sends, not 500 marshals (today it marshals per spectator; fix in PR 2).

## Alternatives considered

One process per table: needs budget coordination through the database on every call, one Railway service per table, and the same code anyway. Rejected; `TABLES=a,b` on a second service is kept as an escape hatch if a single process ever saturates, which at these rates it will not.

Tables defined in the database with an admin page: flexible, but an admin UI, auth and migrations for a thing that changes a few times a month. Rejected in favour of the config file.

One LLM service per table: pointless; the service is stateless and per-request parameters are three fields.

Duplicate-deck groups (same shuffled deck across N tables with rotated seats, so card luck cancels): the strongest variance reduction, and it fits this design as a `deck_group` config field with a seeded shuffle per hand number. Deferred; it costs N× and the all-in EV adjustment in loop 1 recovers most of the benefit for free.

## Failure modes

A table loop panics: recovered, logged, restarted; others unaffected. Supabase down: per-table spill files as today. Global cap hit: all tables stop with a notice; nothing spends. Provider outage: decisions get `api_error`, fold-or-check as today; the budget counts errors so a dead provider does not burn the cap. Redeploy: table ids and session numbers come from config plus the `sessions` table, so a deploy no longer resets a session.

## Build order (each a PR, each shippable on its own)

1. `TableConfig` + `tables.json` with the current table; sessions and balanced seating as config. No behaviour change otherwise.
2. Table map, `/ws?table=`, `/api/tables`, per-table recorder and spill, marshal-once broadcast, panic isolation.
3. LLM service per-request model and variant; `llm/variants/`.
4. `Budget` with persisted counters and the global cap; `/api/usage` reads it.
5. Web tab strip and `/t/<id>`.
6. First headless research table, `daily_call_cap` 1500 (~100 hands, ~$0.10 a day), after loop 3's export and prune are live.

Sizes: 1 S, 2 M, 3 S, 4 M, 5 S, 6 S. Roughly four agent-days end to end.

## Open decisions for the owner

The featured table keeps id `main` so existing hand ids stay valid. The global cap is the OpenRouter key limit ($10/month today). A human seat is out of scope; it would be `provider: "human"` on a seat with a turn timeout, over the same websocket.
