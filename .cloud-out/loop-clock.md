# loop-clock

Start 13:47 UTC 2026-11-17 on origin/work/loop-base (base build served at :3301, this branch at :3300, e0806b1 at :3302 for one guard).
Fixture: the real engine with the mock models, about 2,600 hands in the log (two fast sessions plus a DEV_CONTROLS session, then pace 0.3).

## Metric and predicted gain (written before product code)
- Finding 1: longest main-thread task after hydration at 4x CPU, 1440x900 (long-task observer, 9-12 s after load). Base: 266-348 ms in 5 of 5 runs. Predicted: under 250 ms.
- Finding 0: shot-clock values drawn below the hold after the move, with the move held behind the stats' transition. Base: one every run. Predicted: 0.

## Commits (one per idea; checks separate)
| commit | what | findings |
|---|---|---|
| b14a61d, 2014f98, 958d6d1 | checks: clock-stops-at-move holds the stats' code until 260 ms before the move and judges the held figure at t1; new countdown-follows-deal; trends-zoom bb/100 and Chips zooms with no flat edge runs and the whole-fit stretch inside; trends-pinch-keeps-pack at 90% and no new edge points; chunk-fail-says-so needs the drawer line gone within 8.5 s; checkCovers' walk is changedChecks' own code | 0, 3, 4, 5, 6, 7, 8, 9 |
| 5399648 | lib/stream `arrive()` / `arrivedClock()` / `arrivedDealAt()`: useGameState applies each message on arrival; useSecondsDraw's callers read the arrived clock and deal time at each step, and stop when the arrived clock has stopped | 0 |
| 4f52c66 | StatsSections: the overview's Matchups tile body is its own mount part (6 parts) | 1 |
| ecce695 | lib/format: one cached Intl.NumberFormat per kind and decimals (grouped, compact); same text | 1 |
| e2795ab | CumulativeChart: a zoom fits its points from cut = lerp(X0, X1, 0.75 x zoomWidth / fullWidth), untrimmed; the `zoom ||` clamp removed (only pre-fitAt points held at the edge) | 2, 4 |
| 328428d | lib/drawer: one loader for every route (StatsSections' preload included); page clears the failed line on any successful load, after 6 s, or on the next tap or key | 5 |

## Measured
Fail before / pass after (each new or changed check):
| check | base (:3301) | this branch (:3300) |
|---|---|---|
| clock-stops-at-move | FAIL 3/3 ("counted on: 42s at +262 ms", then back to 43) | PASS 3/3 (held 43, shown 43) |
| countdown-follows-deal | FAIL ("4s at +271 ms" against a 180 s deal); e0806b1 FAIL 2/2 (stray chain: 3, 2, 1 against 179-177) | PASS 3/3 |
| trends-zoom | FAIL (bb/100 zoom 1566-2361: 49 points in flat runs on the edge) | PASS |
| trends-pinch-keeps-pack | FAIL (83%, edge points 1 -> 6) | PASS (100%, 1 -> 0) |
| chunk-fail-says-so | FAIL (drawer line still up 8.5 s later) | PASS |
| checkCovers walk test | passes with ONE_LINE mutated to /\}\)\);\s*$/ (vacuous) | fails on that mutation ("649 -> phone-table-ownership-tucked"...), passes unmutated |
| clock-after-load, alone | 2/3 pass (1 FAIL: "38s still shown with 37s left") | 3/3 pass after the split, 3/3 again after the formatter cache |

Finding 1 mechanism metric (longest task after the hydration task, 1440x900, 4x CPU):
- base: 348, 266, 274, 291, 304 ms (5/5 over 250).
- Matchups tile split: 239, 210, 195, 200 ms (+ one run with a live stats update: 713 ms); 8 more runs: 188, 240, 353, 640 (live stats update), 179, 369, 345, 278. The over-250 tasks came right after the Matchups card's commit or from a stats update.
- Profile (built with --no-mangling): HeadToHead's fitFigure -> signed/grouped/signedCompact (toLocaleString / new Intl.NumberFormat on every call) was about 30% of a stats-update task and a large part of the Matchups mounts.
- + formatter cache, 8 runs, mount: 143, 173, 173, 311 (a live stats update landed mid-mount), 244, 190, 130, 132 ms; a re-fed full stats update: 228, 147, 116, 273, 192, 117, 142, 158 ms (before the cache: 206-371; a live "changed" update was 830 + 612 ms).
- Read: the mount is under 250 ms in 7 of 8 runs (interval not computed; n=8). A stats update still reaches about 270 ms sometimes. Inconclusive against the strict "no task over 250 ms" bar; clock-after-load passes 3 of 3 alone.

## Left open
- The hydration task itself is 250-510 ms at 4x (the first task after load); not addressed (it precedes the first clock value in clock-after-load).
- A stats update over the stream (each hand's "changed" body) can still make a 200-300 ms task (render of every stats screen at DefaultLane, sync). Rendering it in a transition was tried and reverted: the commit stayed long (541 ms once) and the stats would lag.
- The verifier's other suggestion for finding 1 (digits off the main thread) not tried.
- countdown-follows-deal and clock-stops-at-move get their transition only on their first turn (the stats mount once).

## Checks run
- `npx tsc --noEmit`, `node --experimental-strip-types --test src/lib/*.test.mjs` (134 pass, plus the new arrivedClock test), `npx eslint src --quiet`: clean.
- Full suite at --lanes 2 on this branch (with ecce695): 160/169. Failures:
  - phone-table-places, phone-table-ownership: expected red until the owner picks (run rules).
  - phone-table-ownership-beside, phone-table-ownership-tucked: seat drafts with bets of 120 and 1,250; not touched here (no seat or table code changed), not rerun on base.
  - profiles-all-stats: same failure on base alone ("figures clipped: ▼43%, ▼11%, −1,248, ▲20%"): pre-existing, data-dependent.
  - numbers-one-format: same failure on base alone ("ungrouped 1070"): pre-existing, data-dependent.
  - table-shuffle, table-shuffle-notice: failed under the suite's load, both PASS alone on this branch and on base.
  - **glide-clean: FAIL alone on this branch** ("Matchups open 1440x900: row "Qwen 3.7 Flash" has its numbers but no name (frame 3); Matchups close by Escape: row "Claude Haiku 5.5" ... (frame 7)"), PASS alone on base (66 glides clean; that base run shared the machine with the suite). **Treat as a regression of this branch until shown otherwise.** Suspects: 4f52c66 (the Matchups tile body mounts in its own part) or ecce695 (the formatters return the same text, so less likely). It was found at 15:46, too late to bisect (a build plus a 9-minute check). Next step: rebuild with 4f52c66 reverted and rerun glide-clean alone 2x on each.

## Honest read
- Findings 0, 2, 3, 4, 5, 6, 7, 8, 9: fixed at the cause, and each new or changed check fails on the base (9 also on e0806b1) and passes here.
- Finding 1: clock-after-load now passes 3 of 3 alone (base 2 of 3), and the stats mount's longest task fell from 266-348 ms to mostly 130-244 ms. But it is not under 250 ms in every run (311 ms once, with a live stats update mid-mount), a stats update still reaches about 270 ms, and hydration is 250-510 ms. So the strict "no task after load over 250 ms" is not met. The split commit may also be what broke glide-clean (above).
- Not done: no Lighthouse or journey numbers. Interval statistics not computed (n = 3 to 8 per arm).
