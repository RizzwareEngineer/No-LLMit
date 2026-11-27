# Web

The Next.js site, deployed on Vercel. It shows a table live, with each model's reasoning, and the stats.

## How it works

- The page opens one Server-Sent Events stream to the engine, `NEXT_PUBLIC_API_URL/stream` (`src/lib/api.ts`). The home page starts it from an inline script while the HTML parses.
- `src/hooks/useGameState.ts` applies each message (`src/lib/stream.ts`). The first message is a snapshot of every table. Later messages change one table or the stats.
- The page draws the 5/10 table, or the first table if there is none. The tables' own stats arrive as `table_stats` messages.
- If the stream fails, the page reopens it. After repeated failures it gives up and offers a retry.
- Other engine calls: `/api/stats` and `/api/stats/timeline` (stats screens), `/api/usage` (usage indicator, polled every 30 s), `/api/waitlist` (dataset sign-up).
- Pages: `/` (table and stats) and `/about`.
- The site holds no game logic. The engine decides every move and every number.

## Environment

See `.env.example`.

- `NEXT_PUBLIC_API_URL`: the engine's address. A production Vercel build fails without it.
- `NEXT_PUBLIC_SITE_URL`: base URL for link previews.
- `NEXT_DIST_DIR`: build folder. Default `.next`.
- `CHROME_PATH`, `BASE_REF`: read from the shell by `scripts/checks.mjs`.

## Run and test

```sh
npm ci
npm run dev
node --experimental-strip-types --test src/lib/*.test.mjs
npx tsc --noEmit -p . && npx eslint src
```

`scripts/dev.sh` at the repo root runs the site with the engine and the LLM service on mock models. `scripts/verify.sh` runs every check, including the headless UI checks.

## scripts/

Each file's header says how to run it.

- `checks.mjs`: headless UI checks against a running site.
- `gate.mjs`: runs the UI checks on a base and a candidate commit and writes a verdict. `gate-corpus/` holds the known-bad patches it must reject. `gate.test.mjs` tests it.
- `audit.mjs`: Lighthouse scores, axe-core violations and screenshots of every state.
- `journey*.mjs`, `perf-trace.mjs`, `zoom-measure.mjs`, `zoomsweep.mjs`: page journeys, performance traces and zoom measurements.
- `fixture/`: serves the real engine on a seeded snapshot with the mock model, so every run sees the same data. `fixture/serve.sh` says how to start it.
