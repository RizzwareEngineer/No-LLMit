# Stats

`GET /api/stats` on the engine returns these numbers for every model, in the shape of
[`stats-api-contract.json`](stats-api-contract.json), over every saved hand; `sessions`
lists each session, for now one table id. The code is `engine/stats`; to check a file of
hands offline, run `go run ./cmd/stats -in data/hands.jsonl` from `engine/`.

The engine loads every saved hand once at startup and adds each hand as soon as it is saved,
so the numbers are never more than one hand behind. Every 5 minutes it also asks Supabase for
hands newer than the newest one it holds (another writer's, such as an overlapping deploy),
never the whole table again. Until the first
load succeeds the endpoint answers 503 (a failed load is retried every 15 seconds). Both
stats endpoints send gzip to clients that accept it: the demo's 191 KB of stats are 36 KB.

All-ins are worked out a few hands at a time after a restart, so serving never waits on
them. While some are left, `partial` is `true` and those hands count at their actual result
in all-in EV bb/100. `ended_at` is `null` only for the table being played now (right
after a restart that is a new session with no hands yet, not the session of the latest hand).

## Which decisions count

Playing-style stats (VPIP, PFR, 3-bet, AF, c-bet, fold to c-bet, average bet, fold when
check was free) count only decisions with status `ok`. A decision that was fixed on its
retry is `ok` and counts. Any other status means the engine chose the action (a forced
check or fold), so it says nothing about the model's style; it counts only toward the
error rate (and, for `illegal` and `unparseable`, misses). Results (net, bb/100, all-in
EV, WTSD, W$SD, pots, head to head) count every hand, since the chips moved whoever chose
the action.

A rate with nothing to count, such as c-bet for a model that never had the chance, is
`null`, not 0.

## Results

- **Net chips**: the sum of the model's `result.net` over its hands.
- **bb/100**: the model's average net per hand in big blinds, times 100.
- **95% interval on bb/100**: each hand's net in big blinds is one sample. The interval
  is 100 × (mean ± 1.96 × sample standard deviation ÷ √hands), the normal approximation.
  It is `null` below two hands.
- **All-in EV bb/100**: bb/100 with luck taken out of all-ins. When every player still in
  the hand is all-in before the river (or all but one, who has no one left to bet
  against), each of them is credited with what they would win on average over every
  possible rest of the board, given everyone's actual hole cards, minus the chips they
  put in. Side pots are split by contribution level and only the players in each pot can
  win it. After the flop or turn every runout is counted exactly (990 for two players on
  the flop); preflop it is 10,000 random runouts from a fixed seed, so the number never
  changes between runs (its standard error is about 0.5% of the pot per hand for a coin flip). Every other hand counts
  at its actual net.
- **Biggest pot won**: the largest pot in a hand the model finished ahead in, counting the
  whole pot even when it was split.
- **Biggest pot lost**: the largest pot in a hand the model finished behind in, after
  putting chips in by choice or reaching showdown (a folded blind does not count).
  A pot is every chip put in, less the part of a bet nobody called.
- **By position**: hands, VPIP, PFR and bb/100 for each seat position.
- **Cumulative bb**: the running total in big blinds after each of the model's hands,
  starting at [0, 0]. Past 200 hands it keeps every nth point (and always the last) so
  there are never more than 200.
- **Head to head (vs)**: `hands` is how many hands both models were dealt in; over the
  hands where both put chips in by choice or reached showdown, `pots` is how many there
  were and `net_chips` is what flowed between them. In a pot with several players, each
  loser's chips are shared among the winners in proportion to what each won. The Matchups
  card shows each pair as bb/100: `net_chips` ÷ big blind ÷ `hands` × 100, drawn faint under
  100 hands together (on the demo data, pairs under 100 hands swing to a 90th-percentile
  |bb/100| of 250–680; from 100 up it is 135–210, the same as pairs with a thousand). Its
  Total column is the row's bb/100 against the models shown: the chips it won from them per
  100 hands dealt in with one of them, which is the row's cells averaged by hands together.
  A pair with no hands together has no entry (an empty cell).

## Style

- **VPIP**: of the hands where the model made an `ok` preflop decision, the share where
  it called, bet, raised or went all-in preflop. Posting a blind or checking the big blind
  does not count.
- **PFR**: of the same hands, the share where it raised or went all-in for more than a
  call preflop.
- **3-bet**: of the hands where the model made an `ok` preflop decision facing exactly one
  raise, the share where it raised again.
- **AF (aggression factor)**: on the flop, turn and river, bets and raises divided by
  calls. `null` with no calls.
- **C-bet**: of the hands where the model made the last preflop raise and was first to
  bet on the flop (no one had bet before its first flop decision), the share where it bet.
- **Fold to c-bet**: of the hands where the model faced that flop bet before anyone
  raised it, the share where it folded.
- **WTSD (went to showdown)**: of the hands where the model saw the flop, the share where
  it reached showdown.
- **W$SD (won money at showdown)**: of the hands where it reached showdown, the share
  where it won at least one pot.
- **Average bet as % of pot**: over the model's flop, turn and river bets (the first
  chips in on a street), the average of bet ÷ pot before the bet.
- **Fold when check was free**: of the decisions where checking was legal, the share
  where the model folded anyway.

## Reliability and cost

- **Error rate**: decisions whose status is not `ok`, over all decisions.
- **Retry rate**: decisions that needed a second ask (`retried`), over all decisions.
- **Misses (miss_rate)**: decisions whose status is `illegal` or `unparseable`, over all
  decisions: the model's own reply was still illegal or unreadable after its one retry, so
  the engine checked (when that was free) or folded for it. Provider failures (`timeout`,
  `api_error`, `service_error` and any other status) are not misses.
- **Average latency**: the mean `latency_ms` over all decisions.
- **Cost**: the sum of `cost_usd` (null costs count as 0).

## How much to trust a number

Poker results are very noisy. A typical standard deviation is around 100 bb per 100
hands, so after 1,000 hands bb/100 is still only known to within about ±60. Read the
interval, not the point; all-in EV bb/100 removes some of the luck but not most of it.
Style rates settle much faster (a few hundred decisions), but rates built on rare spots,
such as 3-bet, c-bet and fold to c-bet, need many more hands than the headline count
suggests: check how many chances the model actually had. Rates also pool every prompt
version in the scope, so compare models within one prompt version.

## Timeline

`GET /api/stats/timeline` (same scope: all time) returns Profiles and
Matchups at past hands, so the web can replay them alongside the race chart. Its shape is
`_timeline` in [`stats-api-contract.json`](stats-api-contract.json). It comes from the same
pass over the hands as `/api/stats`, recomputed with it after each hand, so the two always agree.

- **Tables, not objects.** `profiles` and `matchups` are `{fields, rows}`: each row holds
  values in the order of `fields`. A model is an index into `models`, sorted by name.
- **Profiles**: one row per model already seated, every 25 hands and at the last hand,
  with hands played, bb/100, VPIP, PFR and AF as of that hand. These are the definitions
  above, from the same code, rounded (bb/100 to 0.01, VPIP and PFR to 0.0001, AF to 0.001).
  The last snapshot is the current `/api/stats`. Past 3,000 hands the step becomes
  ceil(hands ÷ 120), so there are never more than 120 snapshots (`profile_step` says which).
- **Matchups**: `[hand, a, b, chips]` with `a < b`, one row for each pair whose
  head-to-head (`vs`) net changed on that hand, `chips` being what `a` took from `b` (negative
  when `b` won). Past 1,200 hands, consecutive hands are summed in buckets of
  ceil(hands ÷ 1,200) and stamped with the bucket's last hand (`matchup_bucket`), so there are
  never more than 1,200 change points. Each row is the change in the rounded running total,
  so adding a pair's rows up to any hand gives its `vs.net_chips` there, and up to the end
  gives the current `/api/stats` exactly.
- **Lineups**: who was dealt in, as `[hand, model, model, …]` rows: the hand (1-based) a
  lineup started at, then the seated models ascending, holding until the next row. Any
  pair's hands together by any hand follows (the runs both are in, cut at the hand), so the
  replay shows each pair's bb/100; at the last hand it equals `vs.hands`. One row per
  lineup change: a handful on a history of whole sessions, 509 on the demo's interleaved
  ones (19 KB raw, 2 KB gzipped).

Sizes, uncompressed and gzipped: the demo history (895 hands, 19 models) is 68 KB / 22 KB;
the preview's 1,587 hands with lineups are 134 KB / 36 KB (120 KB / 34 KB before them).
A synthetic 10,000 hands with nine fixed models is 43 KB of profiles and 188 KB of matchups;
the real lineups repeated to 10,000 hands (19 models) are 93 KB and 399 KB, 134 KB gzipped
in all. Matchups grow with the pairs that play in each change point, not with the cap: on
the real-shaped history 600 points give 334 KB and 120 points still 159 KB.

## A note on the hand record

`result.pots` leaves out a pot only one player can win (an uncalled bet, plus any chips
folded into it). Stats therefore rebuild each player's contribution from the blinds and
actions rather than from the pots.
