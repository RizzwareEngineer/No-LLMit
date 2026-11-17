# loop-ssr-draft (lever L3: server-rendered first frame behind ?ssr=1)

Started 13:46 UTC 2026-11-17 on work/loop-base a0dbd90. Deadline: stop new work 15:56, end 16:16.

## Mechanism metric and prediction (written before any product change)
Metric: time from navigation start to the first frame that shows real engine data (a seated model's name visible,
effective opacity > 0.5, on the phone table), Pixel-class phone profile (412x915, DPR 2.625, touch, mobile UA, no
automation flags beyond puppeteer's), applied 4x CPU throttling, fresh browser context per run, ?ssr=1 against the
base page (no flag), >= 20 interleaved paired runs, median paired difference with a bootstrap 95% interval.

Prediction: the base paints its first real data only after the JS has loaded, React has hydrated and the stream's first
snapshot is applied (about 1.5-2.5 s at 4x on this VM with no network throttling). With ?ssr=1 the data is in the HTML,
so it paints at first paint (about 0.3-0.7 s). Predicted gain: at least 1.0 s faster (median paired difference),
minus a server-side cost of a few tens of ms on a cache miss (the engine fetch).

## What changed (draft only; the default page is unchanged)
1. `web/next.config.ts`: a `beforeFiles` rewrite sends `/?ssr=1` (and only that: a `has` query condition) to a new route
   `/ssr`. No middleware/proxy function, so `/` without the flag is served exactly as before (still `○ Static`).
2. `web/src/app/ssr/page.tsx` (new, `force-dynamic`, `noindex`, canonical `/`): awaits `firstFrame()` and renders the
   home page's own component (`app/page.tsx`'s `Home`) with `initial`.
3. `web/src/lib/firstFrame.ts` (new server helper): opens the engine's `/stream` exactly as a viewer does, keeps the
   `snapshot` frame and the `stats` frame that follows in the same flush, closes the stream. One read per second at most
   (TTL 1000 ms, concurrent requests share one read); 500 ms budget, after which the page renders blank like the default.
4. `web/src/lib/stream.ts`: `fromFirstFrame(frames, at)` applies those frames with the same `applyMessage`/`applyStats`
   the stream uses, so the server frame is the stream's own opening, not a second implementation.
5. `web/src/hooks/useGameState.ts`: optional `initial` seeds the tables and stats; the stream resumes on top (its own
   snapshot goes through `fromSnapshot`, which keeps the very same display object and clock for a turn already on
   screen: no retype, no clock reset). If the stream has sent no snapshot by the time the page would say Offline
   (4 s), the frame is dropped (blank, as the default page shows then). Returns `fromServer`.
6. `web/src/app/page.tsx`: `Home`/`Table` take optional `initial`; while hydrating with a first frame, `useFillIn`
   (lib/boxes.ts) skips its fade (the data was already painted: no second fade); the live dot is on while the
   unconfirmed frame shows (it was live at most ~1 s earlier), so it does not flip grey -> red as the stream confirms.
   Without `initial` every line behaves as before.

Why not `searchParams` in `app/page.tsx` (the file list suggested its "server part"): reading `searchParams` there makes
`/` dynamic for every viewer, which changes the default page (TTFB, caching). Splitting `page.tsx` into a server page
plus a client component was tried first: the DOM was identical but the RSC payload changed (Next's ClientPageRoot
wrapper dropped). The final shape keeps `page.tsx` the client page and imports its component from `/ssr`.

Default page check: `curl /` on the base build and on this branch, chunk hashes and build id stripped: same length
(38,648 chars) and the only diff is one minifier-chosen function name (`cY` vs `c$`) inside the inline BEFORE_PAINT
script. Same RSC payload shape, same text.

## Measured (mechanism metric), scripts/ssr-paint.mjs
Phone profile 412x915 DPR 2.625, mobile UA, touch, applied 4x CPU (no network throttling: localhost), fresh browser
context per load, A = base build `/` (port 3301, origin/work/loop-base), B = branch `/?ssr=1` (port 3300), pairs
interleaved with alternating order, engine live at pace 0.3. Bootstrap 95% interval of the median paired difference.

| run | pairs | A median | B median | median B-A | 95% CI |
|---|---|---|---|---|---|
| 3 (final detector) | 24/24 | 1,314 ms | 304 ms | **-1,007 ms** | [-1,045, -963] |
| 1 (full-name detector) | 24/24 | 1,289 ms | 397 ms | -908 ms | [-967, -892] |
| 2 (full-name detector) | 17/20 | 1,305 ms | 355 ms | -943 ms | [-1,032, -905] |

Runs 1-2 matched only full model names; on the phone table only "Phi-4" is shown in full, so they timed a single seat
(and 3 pairs timed out while it was folded/faded). Run 3 matches whole-word parts too (Haiku, V4 Flash, 12B) and is
the one to use. Prediction was >= 1.0 s: met at the point estimate, the interval straddles it ([-1,045, -963]).

Second instrument (run 3, browser's own LCP): A 1,720 ms, B 456 ms, median paired difference -1,238 ms: same sign.

Costs (run 3 medians): TTFB 6 -> 55 ms (+49: the engine read plus a dynamic render; on a cache hit less), FCP
228 -> 326 ms (+98 ms: later and bigger HTML), HTML transfer 9.7 KB -> ~63.5 KB (gzip; ~315 KB raw, of which ~250 KB is
the all-time stats body carried in the RSC payload), long-task blocking past 50 ms in the first 10 s 758 -> 580 ms.

## Status
(checks in progress)
