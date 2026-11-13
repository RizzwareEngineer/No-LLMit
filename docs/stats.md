# Stats

How every number on the stats screens is counted. The code is `engine/stats`.

`GET /api/stats` on the engine returns these numbers for every model over every saved hand, in the shape of
[`stats-api-contract.json`](stats-api-contract.json). Each engine run is one session (one table id) in `sessions`.
To check a file of hands offline, run `go run ./cmd/stats -in data/hands.jsonl` from `engine/`.

The engine loads every saved hand at startup and adds each hand as soon as it is saved, so the numbers are never
more than one hand behind. Every 5 minutes it also asks Supabase for hands newer than the newest it holds (another
writer's, such as an overlapping deploy). Until the first load succeeds the endpoint answers 503, and the load is
retried every 15 seconds. Responses are gzipped for clients that accept it.

All-ins are worked out a few hands at a time after a restart, so serving never waits on them. While some are left,
`partial` is `true` and those hands count at their actual result in all-in EV bb/100. `ended_at` is `null` only for
the session being played now.

## Which decisions count

Playing-style stats (VPIP, PFR, 3-bet, AF, c-bet, fold to c-bet, average bet, fold when check was free) count only
decisions with status `ok`, including one fixed on its retry. Any other status means the engine chose the action (a
forced check or fold), so it says nothing about the model's style; it counts only toward the error rate (and, for
`illegal` and `unparseable`, misses). Results (net, bb/100, all-in EV, WTSD, W$SD, pots, head to head) count every
hand, since the chips moved whoever chose the action.

A rate with nothing to count, such as c-bet for a model that never had the chance, is `null`, not 0.

## Results

- **Net chips**: the sum of the model's `result.net` over its hands.
- **bb/100**: the model's average net per hand in big blinds, times 100.
- **95% interval on bb/100**: each hand's net in big blinds is one sample; the interval is
  100 × (mean ± 1.96 × sample standard deviation ÷ √hands). `null` below two hands.
- **All-in EV bb/100**: bb/100 with the luck taken out of all-ins. When every player still in the hand is all-in
  before the river (or all but one, who has no one left to bet against), each is credited with what they would win on
  average over every possible rest of the board, given everyone's hole cards, minus the chips they put in. Side pots
  are split by contribution level. After the flop or turn every runout is counted; preflop it is 10,000 random runouts
  from a fixed seed, so the number never changes between runs. Every other hand counts at its actual net.
- **Biggest pot won**: the largest pot in a hand the model finished ahead in, the whole pot even when split.
- **Biggest pot lost**: the largest pot in a hand the model finished behind in, after putting chips in by choice or
  reaching showdown (a folded blind does not count). A pot is every chip put in, less the part of a bet nobody called.
- **By position**: hands, VPIP, PFR and bb/100 for each seat position.
- **Cumulative bb**: the running total in big blinds after each of the model's hands, starting at [0, 0]. Past 200
  hands it keeps every nth point (and always the last), so there are never more than 200.
- **Head to head (`vs`)**: `hands` is how many hands both models were dealt in. Over the hands where both put chips in
  by choice or reached showdown, `pots` counts them and `net_chips` is what flowed between the two. In a pot with
  several players, each loser's chips are shared among the winners in proportion to what each won. The Matchups card
  shows each pair as bb/100 (`net_chips` ÷ big blind ÷ `hands` × 100), faint under 100 hands together, where it
  swings too much to read. Its Total column is the row's chips won from the models shown per 100 hands dealt in with
  one of them. A pair with no hands together has no entry.

## Style

- **VPIP**: of the hands where the model made an `ok` preflop decision, the share where it called, bet, raised or went
  all-in preflop. Posting a blind or checking the big blind does not count.
- **PFR**: of the same hands, the share where it raised or went all-in for more than a call preflop.
- **3-bet**: of the hands where it made an `ok` preflop decision facing exactly one raise, the share where it raised again.
- **AF (aggression factor)**: on the flop, turn and river, bets and raises divided by calls. `null` with no calls.
- **C-bet**: of the hands where the model made the last preflop raise and no one had bet before its first flop
  decision, the share where it bet.
- **Fold to c-bet**: of the hands where it faced that flop bet before anyone raised it, the share where it folded.
- **WTSD (went to showdown)**: of the hands where it saw the flop, the share where it reached showdown.
- **W$SD (won money at showdown)**: of the hands where it reached showdown, the share where it won at least one pot.
- **Average bet as % of pot**: over its flop, turn and river bets (the first chips in on a street), the average of
  bet ÷ pot before the bet.
- **Fold when check was free**: of the decisions where checking was legal, the share where it folded anyway.

## Reliability and cost

- **Error rate**: decisions whose status is not `ok`, over all decisions.
- **Retry rate**: decisions that needed a second ask (`retried`), over all decisions.
- **Misses (`miss_rate`)**: decisions whose status is `illegal` or `unparseable`, over all decisions: the model's reply
  was still illegal or unreadable after its one retry. Provider failures (`timeout`, `api_error`, `service_error`) are
  not misses.
- **Average latency**: the mean `latency_ms` over all decisions.
- **Cost**: the sum of `cost_usd` (a null cost counts as 0).

## How much to trust a number

Poker results are very noisy. A typical standard deviation is around 100 bb per 100 hands, so after 1,000 hands bb/100
is still only known to within about ±60. Read the interval, not the point; all-in EV removes some of the luck but not
most of it. Style rates settle within a few hundred decisions, but rates built on rare spots (3-bet, c-bet, fold to
c-bet) need many more hands: check how many chances the model actually had. Rates pool every prompt version, so
compare models within one prompt version.

## Timeline

`GET /api/stats/timeline` returns Profiles and Matchups at past hands, so the site can replay them alongside the
History chart. Its shape is `_timeline` in [`stats-api-contract.json`](stats-api-contract.json). It comes from the same
pass over the hands as `/api/stats`, so the two always agree.

- **Tables, not objects.** `profiles` and `matchups` are `{fields, rows}`: each row holds values in the order of
  `fields`. A model is an index into `models`, sorted by name.
- **Profiles**: one row per model already seated, every 25 hands and at the last hand, with hands, bb/100, VPIP, PFR
  and AF as of that hand, rounded (bb/100 to 0.01, VPIP and PFR to 0.0001, AF to 0.001). Past 3,000 hands the step
  becomes ceil(hands ÷ 120), so there are never more than 120 snapshots (`profile_step` says which).
- **Matchups**: `[hand, a, b, chips]` with `a < b`, one row for each pair whose head-to-head net changed on that hand,
  `chips` being what `a` took from `b`. Past 1,200 hands, consecutive hands are summed in buckets of
  ceil(hands ÷ 1,200), stamped with the bucket's last hand (`matchup_bucket`). Adding a pair's rows up to any hand
  gives its `vs.net_chips` there, and up to the end gives the current `/api/stats` exactly.
- **Lineups**: `[hand, model, model, …]` rows: the hand (1-based) a lineup started at, then the seated models
  ascending, holding until the next row. From them the replay counts any pair's hands together at any hand; at the
  last hand it equals `vs.hands`.

## A note on the hand record

`result.pots` leaves out a pot only one player can win (an uncalled bet, plus any chips folded into it), so stats
rebuild each player's contribution from the blinds and actions rather than from the pots.
