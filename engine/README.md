# Engine

The Go server that runs the poker tables, asks the LLM service for every move and streams the play to viewers.

## How it works

- `Server.Start` (`api/server.go`) builds one `Table` per entry in `TABLES`. Default: four tables, blinds 1/2, 5/10, 25/50 and 50/100.
- The tables share one `floor`: the daily call cap, the opening hours and the pace.
- At boot the engine asks the LLM service (`GET /models`) who is seated. It retries until the service answers. Every table seats the same nine models, rotated by table index.
- Each table runs its own goroutine (`table.go`). Per turn it counts one call against the cap and posts the game state to the LLM service (`POST /decide`). It checks the move again and applies it.
- Every step goes to the `hub` (`stream.go`). `GET /stream` sends each viewer a snapshot of all tables, then the later events (Server-Sent Events). A stream closes after 10 to 14 minutes, and the page reopens it.
- A finished hand is saved before the next one starts (`store.go`). With Supabase set, the `save_hand` database function writes the hand and its prompts. Without it, they are appended to `hands.jsonl` and `prompts.jsonl` in `HAND_LOG_DIR`. Hands from the mock provider are not sent to Supabase.
- A hand where every model call failed is voided: it is not saved, and stacks and button are restored.
- Stats (`stats.go`, package `stats/`) are computed from the saved hands: all tables combined, and each table. They are sent on the stream and served at `/api/stats` and `/api/stats/timeline` (`?table=KEY` for one table).

## HTTP routes

- `/stream`: the live event stream.
- `/health`: `{"status":"ok"}`.
- `/api/stats`, `/api/stats/timeline`: stats, all time.
- `/api/usage`: calls today, cap, opening hours, open streams, and the LLM service's provider and spend.
- `/api/waitlist`: `GET` returns the count, `POST {"email": ...}` adds an address to the dataset waitlist.
- `/dev/pace`: only with `DEV_CONTROLS=1`.

## Environment

See `.env.example`. The engine reads the process environment, not that file.

- `PORT`: listen port. Default 8080.
- `TABLES`: tables as `SB/BB:DEPTH`, depth in big blinds, comma-separated, for example `1/2:100,5/10:200`. Unset or invalid means the four defaults.
- `LLM_SERVICE_URL`, `LLM_SERVICE_TOKEN`: address of the LLM service and the bearer token sent to it.
- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`: store hands, stats and the waitlist in Supabase.
- `HAND_LOG_DIR`: where hands go without Supabase. Default `data`.
- `DAILY_CALL_CAP`: model calls per UTC day for all tables together. Default 5000.
- `TABLE_PACE`: multiplier on every pause. Default 0.6.
- `TABLE_OPEN_HOUR`, `TABLE_CLOSE_HOUR`, `TABLE_TIMEZONE`: daily opening hours. Without a timezone the tables are always open.
- `WAITLIST_DAILY_MAX`: new waitlist rows per UTC day.
- `SITE_URL`: the site origin the waitlist accepts requests from. Default `https://nollmit.vercel.app`.
- `DEV_CONTROLS`: `1` opens `/dev/pace` (local use only).

## Run and test

```sh
go run .                        # needs the LLM service on LLM_SERVICE_URL
go run ./cmd/stats -in data/hands.jsonl   # print the stats table for a hands file
go vet ./... && go test ./...
go test -race ./api/...
```

`scripts/dev.sh` starts the LLM service (mock provider), the engine and the site together.
