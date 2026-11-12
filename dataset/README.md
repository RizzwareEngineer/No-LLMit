# Open dataset export

Turns the saved hand history (see [`docs/hand-history.md`](../docs/hand-history.md)) into the public dataset:
Parquet tables, the raw JSONL records, PokerStars hand histories, and a dataset card.
The card the export writes (`out/README.md`) documents every column.

## Setup

```sh
cd dataset
uv venv .venv -p 3.11 && uv pip install -p .venv/bin/python -r requirements.txt
.venv/bin/python -m pytest -q
```

## Run it locally

From the engine's local files (what it writes without Supabase):

```sh
.venv/bin/python export.py --out out --from-jsonl ../engine/data/hands.jsonl ../engine/data/prompts.jsonl
.venv/bin/python upload.py --out out --dry-run
```

From Supabase, with `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` set:

```sh
.venv/bin/python export.py --out out --day yesterday   # or --day 2026-11-03, or no --day for every hand
```

Days are America/New_York dates the hand started; the live table plays during its configured hours.
Re-exporting a day replaces that partition, so `--back 3` safely re-exports the three days before `--day` too.

To publish, set `HF_TOKEN` (write token) and `HF_REPO` (for example `user/no-llmit-hands`):

```sh
.venv/bin/python upload.py --out out --pull   # first, so the card covers days already published
.venv/bin/python export.py --out out --day yesterday --back 3
.venv/bin/python upload.py --out out
```

`.github/workflows/dataset.yml` runs those three steps nightly at 09:17 UTC, re-exporting the three days before
yesterday as well so hands saved late (saved after a Supabase outage) or a failed night still get published.
It needs the repo secrets `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `HF_TOKEN` and `HF_REPO`, and skips until all four are set.

## PokerStars hand histories

`hh.py` writes the PokerStars play-money cash game format (`python hh.py hands.jsonl > hands.txt`).
Where it differs from a real PokerStars file:

- Every player's hole cards appear as `Dealt to` lines, not just the hero's: this is a full-information history.
  Trackers pick the hero from `Dealt to`, so stats attributed to "hero" are not meaningful.
- Hand numbers are `<table hex as integer> * 1000000 + hand_number` for a 6-digit table hex, and `crc32(table id) * 1000000 + hand_number` for longer ids; the table name is the session id (`tbl_xxxxxx`).
- `shows [..]` lines carry no hand description such as `(a pair of Tens)`.
- Side pots are not itemized: each winner gets one `collected N from pot` line with their total,
  and the summary is `Total pot N | Rake 0` without `Main pot` / `Side pot` amounts.
- Uncalled bets are derived from the actions and printed as `Uncalled bet (N) returned to X`, as PokerStars does.
- In hands recorded before 2026-11-09 a short all-in could win the whole pot, unmatched chips included, when the last
  player with chips folded with nothing to call (the engine no longer gives that player a turn: the board runs out).
  Those hands follow the engine's payout (no uncalled-bet line) and end with a `#note <hand_id>: ...` line.
  `hh.py` never fails on a hand: one it cannot write is left out and named on stderr.

## Tests

`tests/fixtures/generated/` holds 40 hands played through the engine's real recorder with scripted random replies
(short stacks for all-ins and side pots, fallbacks of every status, hands spanning midnight UTC).
`tests/fixtures/repro_hands.jsonl` holds two engine hands whose payout differs from poker rules
(a short all-in paid unmatched chips; a side pot with dead money missing from `result.pots`).
The tests export them with `docs/hand-record-example.json`, reload the Parquet, check row counts, that each
hand's net sums to zero and every `prompt_id` resolves, and parse the PokerStars text back into the same actions.
