# Stats

`GET /api/stats` on the engine returns these numbers for every model, in the shape of
[`stats-api-contract.json`](stats-api-contract.json). `?session=<id>` limits them to one
session; for now a session is one table id. The code is `engine/stats`; to check a file of
hands offline, run `go run ./cmd/stats -in data/hands.jsonl` from `engine/`.

The engine loads every saved hand at startup and again every 5 minutes, and adds each hand
as soon as it is saved, so the numbers are never more than one hand behind. Until the first
load succeeds the endpoint answers 503 (a failed load is retried every 15 seconds).

All-ins are worked out a few hands at a time after a restart, so serving never waits on
them. While some are left, `partial` is `true` and those hands count at their actual result
in all-in EV bb/100. `ended_at` is `null` only for the session of the latest hand.

## Which decisions count

Playing-style stats (VPIP, PFR, 3-bet, AF, c-bet, fold to c-bet, average bet, fold when
check was free) count only decisions with status `ok`. A decision that was fixed on its
retry is `ok` and counts. Any other status means the engine chose the action (a forced
check or fold), so it says nothing about the model's style; it counts only toward the
error rate. Results (net, bb/100, all-in EV, WTSD, W$SD, pots, head to head) count every
hand, since the chips moved whoever chose the action.

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
  changes between runs (its error is about 0.1% of the pot per hand). Every other hand counts
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
- **Head to head (vs)**: over the hands where both models put chips in by choice or
  reached showdown, `pots` is how many there were and `net_chips` is what flowed between
  them. In a pot with several players, each loser's chips are shared among the winners
  in proportion to what each won.

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
- **Average latency**: the mean `latency_ms` over all decisions.
- **Cost**: the sum of `cost_usd` (null costs count as 0); cost per hand divides by the
  model's hands.

## How much to trust a number

Poker results are very noisy. A typical standard deviation is around 100 bb per 100
hands, so after 1,000 hands bb/100 is still only known to within about ±60. Read the
interval, not the point; all-in EV bb/100 removes some of the luck but not most of it.
Style rates settle much faster (a few hundred decisions), but rates built on rare spots,
such as 3-bet, c-bet and fold to c-bet, need many more hands than the headline count
suggests: check how many chances the model actually had. Rates also pool every prompt
version in the scope, so compare models within one prompt version.

## A note on the hand record

`result.pots` leaves out a pot only one player can win (an uncalled bet, plus any chips
folded into it). Stats therefore rebuild each player's contribution from the blinds and
actions rather than from the pots.
