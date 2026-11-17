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

No second fade: ssr-paint.mjs counts opacity 0->1 animations started on a box that already shows a model's name after
the first real-data frame. Run 3: 0 on B (and 0 on A). Shown to catch the fault: a validation build with the hydration
fade guard removed (lib/boxes.ts `if (preFilled) return;` deleted, not committed) gave 60 such re-fades in 4 loads
(15 boxes per load: seats, felt, panels) against 0 for this branch.

## What the server HTML now holds (?ssr=1 only; `/` is unchanged and still holds only the chrome)
Visible text of `/` (no JS): 475 characters: the title, tagline, "Hand # 00", "POT 0", "Profits & Losses",
"Waiting for next action...", tab labels. Of `/?ssr=1`: about 2,200 characters, all from the engine at request time:
- the hand number, blinds, the pot and the board;
- every seat (both layouts' trees are in the HTML, CSS shows one): model name (and the phone's short label), position
  badge, stack, last action and amount, hole cards for seats whose turn has come (the same peek rule as live);
- the session's Profits & Losses leaderboard (rank, name, signed amount, en-US separators);
- the turn on screen: the acting model, its action and amount, and the reason's full text in the screen-reader copy
  (the visible typewriter starts at 0 characters on the server and types after hydration, as for any new viewer);
- the phone bar's status label ("Live", hand number).
Not in the HTML: the all-time stats sections (Trends, Profiles, Matchups) and About: StatsScreens mounts them on the
client only, so their text is still client-only. The all-time stats body IS in the page (the RSC payload, ~250 KB raw),
so the stats mount without waiting for the stream's stats frame, but search engines and screen readers do not see it
as text. For search engines the draft route is `noindex` with canonical `/`, so nothing is indexed until the owner
picks; if adopted as the default, crawlers would get the live table text above (a snapshot that changes every request).
For screen readers: the table, the leaderboard and the current reason are readable before any JS runs; the stream's
updates then replace them in place.

## How a stale cached snapshot is kept from showing wrong figures
1. The cache is 1 s (TTL_MS) and never served past it: an expired read is dropped before the new read starts (no
   stale-while-revalidate). A read that fails or takes over 500 ms gives no frame: the page renders blank as `/` does.
2. The HTML itself is not cacheable: `/ssr` is `force-dynamic`, and the response is
   `Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate` (checked with curl), so no CDN or browser
   copy can replay an old frame.
3. The figures are the engine's own frames applied by the stream's own code (`fromFirstFrame` -> `applyMessage` /
   `applyStats`): no second implementation to drift.
4. Time-based figures are timed conservatively: the frame's age at render is subtracted from the page's navigation
   start, which is earlier than when the frame really reached the page, so the shot clock and "Next hand in" can only
   show fewer seconds than the engine has, never more (unit test: 45 s budget, 10 s run, 1.5 s old -> 34 s shown).
5. The stream's own snapshot replaces every figure as soon as it arrives (the early stream opens from the HTML, so
   about when hydration ends); a turn already on screen keeps its display object and clock (no retype, no reset). If
   the stream sends no snapshot before the page would say Offline (4 s), the frame is dropped and the page goes blank,
   as the default page is then: an unconfirmed frame is never shown as the table for longer than that.
Honest limit: between first paint and the stream's snapshot (about 0.6-1 s at 4x here) the figures are those of a
moment up to ~1 s (TTL) plus the read and render time behind the engine. Each equals the engine's figure at that
moment, but a hand can move on in that window, after which the stream's figures replace them.

## Checks
Targeted set (45 ids: table-*, phone-table-oval, phone-chrome, desktop-table-text, status-boxes-remembered,
phone-card-ring, sticky-pot-bb, skeleton-matches, the stream ones reconnect-unseen, stats-while-typing,
chunk-fail-keeps-table, chunk-fail-says-so, early-scroll-kept, clock-after-load, clock-stops-at-move,
watching-counts-me, numbers-one-format, and the stats ones trends-chart-fills, phone-stats-windows,
profiles-all-stats, matchups-tile-filled, segments-fill, leader-scope, leader-bb100, stats-any-viewport,
no-stats-hash, history-timeline-fetches), --lanes 2:
- Without the flag (`--base :3300`): 43/45. FAIL skeleton-matches (1728x1117: the stats-table card 1.8 px taller
  after data) and FAIL clock-after-load (countdown showed 5 s with 4 s left). The default page's code path is
  unchanged (HTML identical to the base), so these are base behaviour; see below for the base rerun.
- With the flag: `--query ssr=1` only reaches the scripted-table loads, so the run used `--base :3302`, a 15-line local
  proxy (not committed) that adds `ssr=1` to every request for `/`, plus `--query ssr=1`; checks.mjs untouched.
  First run 42/45: FAIL table-refresh-fades (desktop: 7 status-row boxes popped in; 27 hole cards moved
  28x40 -> 40x56 at hydration), FAIL skeleton-matches (the first frame is not blank: expected, the draft changes the
  load sequence and this spec needs the owner's yes; plus the same stats-table card resize), FAIL clock-after-load
  (shot clock 35 s shown with 34 s left).
  The first two table-refresh-fades faults were real draft bugs, fixed in 7fba592 ("Fix two ?ssr=1 hydration
  faults"): the fade guard was re-armed on every render, and desktop seats were server-rendered with the phone's card
  size (lib/tableSwitches `useCardSize` server snapshot now follows the seat's layout; `/` has no cards in its HTML,
  so it is unchanged: verified identical again).

Full suite once, with ?ssr=1 on every home-page load (proxy :3302 plus `--query ssr=1`), --lanes 2, after 7fba592:
FULL_RESULT

Reading the full-suite failures:
- phone-table-places, phone-table-ownership: expected red until the owner picks the seat (RUN-RULES).
- phone-table-ownership-beside / -tucked: the open seat drafts (?seat=), with bets of 120 and 1,250; untouched here.
- skeleton-matches: "placeholders not blank" is the draft's intent (the first frame is real data); this spec changes
  only with the owner's yes. Its stats-table card resize also failed without the flag (1.8 px), so it is not the draft.
- table-refresh-fades: two kinds. (a) Real, open: desktop seat names that need a shorter form (FitName measures after
  mount) are server-rendered whole, then shortened at hydration: seat0/seat1 106 -> 88 px wide at -2.45 s, i.e. as
  the page hydrates. Not fixed (FitName would need a pre-paint inline pass like BEFORE_PAINT). (b) The moves and
  pops at +1 ms / +79 ms come from the check's own method: it holds the stream and then injects a doctored snapshot
  (all seats active, a flop) that differs from the real frame the server already painted, so data changes on screen.
  Under ?ssr=1 the check's premise (blank until the snapshot) does not hold; it needs the owner's yes and a variant
  that injects the same state the server rendered.
- history-overtake-burst, history-overtake-shake, trends-zoom: Trends chart checks; the draft does not touch the
  Trends code or its data path (the stats arrive in the same body, one stream frame earlier). Not rerun on the base
  in the time left: judge them against the frozen red list (H2).
- clock-after-load failed in the targeted runs with and without the flag (default page = base code), passed in the
  full suite run.

## Open
- FitName's hydration shortening on desktop seats under ?ssr=1 (above).
- table-refresh-fades and skeleton-matches need ?ssr-aware variants with the owner's yes before this could become the
  default.
- HTML weight: ~250 KB of the ~315 KB raw page is the all-time stats body in the RSC payload (gzip 9.7 KB -> ~63.5 KB).
  It is not rendered as text (StatsScreens mounts the stats on the client), so for the first paint it is pure cost;
  dropping it from the first frame (stats from the stream as today) is the obvious next variant to measure, together
  with the FCP cost (+98 ms) it mostly explains.
- Server reads: each read is one short-lived engine stream (closed within ~100 ms of the snapshot), at most one per
  second per server instance; it counts against the engine's per-address stream limit (50) from the host's address
  for that moment, and briefly in "watching" if the hub counts open streams.
- No network throttling in the paint runs (localhost); on a phone network the gain should be larger (the base waits
  for JS and a stream round trip, the draft for the HTML only), but that was not measured. No WebKit, no Vercel Preview.
- The paint runs were on the build before 7fba592; that fix touches only the fade guard (later fades) and the desktop
  card size, not the phone first paint, so the metric should be unchanged; not re-measured.

## Honest read
The lever works as predicted on its mechanism: with ?ssr=1 real data is on the first paint, about 1.0 s sooner on a
4x phone (1,314 -> 304 ms, interval [-1,045, -963] ms), the browser's LCP agrees (-1.24 s), and the stream resumes on
the frame without retyping, a clock reset or a second fade (planted-fault test shows the fade count works). It costs
~50 ms TTFB, ~100 ms FCP and ~54 KB gzip of HTML, mostly the stats body that is not rendered. It is a draft, not
ready to flip: one real hydration jump remains on desktop (FitName), and two load-sequence specs need the owner's
yes. The default page is byte-identical to the base apart from one minifier name.
