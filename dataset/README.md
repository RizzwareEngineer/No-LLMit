# Open dataset export

Turns the saved hands ([docs/hand-history.md](../docs/hand-history.md)) into the public dataset: Parquet tables, the
raw JSONL records, PokerStars hand histories, and a dataset card (`out/README.md`, written by `export.py`
`write_card`) that documents every column.

## Setup and tests

```sh
cd dataset
uv venv .venv -p 3.11 && uv pip install -p .venv/bin/python -r requirements.txt
.venv/bin/python -m pytest -q
```

The tests export `tests/fixtures/generated/` (40 hands played through the engine's real recorder with scripted random
replies: all-ins, side pots, every fallback status, hands across midnight UTC), `tests/fixtures/repro_hands.jsonl` (two
hands whose payout differs from poker rules) and `docs/hand-record-example.json`. They reload the Parquet, check row
counts, that each hand's net sums to zero and every `prompt_id` resolves, and parse the PokerStars text back into the
same actions.

## Run it

From the engine's local files (what `scripts/dev.sh` writes):

```sh
.venv/bin/python export.py --out out --from-jsonl ../engine/data/hands.jsonl ../engine/data/prompts.jsonl
.venv/bin/python upload.py --out out --dry-run
```

From Supabase, with `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` set:

```sh
.venv/bin/python export.py --out out --day yesterday   # or --day 2026-11-03, or no --day for every hand
```

A day is the America/New_York date the hand started. Re-exporting a day replaces it, so `--back 3` safely re-exports
the three days before `--day` too.

To publish, set `HF_TOKEN` (a write token) and `HF_REPO` (for example `user/no-llmit-hands`):

```sh
.venv/bin/python upload.py --out out --pull   # first, so the card covers the days already published
.venv/bin/python export.py --out out --day yesterday --back 3
.venv/bin/python upload.py --out out
```

`.github/workflows/dataset.yml` runs those three steps nightly at 09:17 UTC. It needs the repository secrets
`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `HF_TOKEN` and `HF_REPO`, and skips until all four are set.

## PokerStars hand histories

`hh.py` writes the PokerStars play-money cash game format (`python hh.py hands.jsonl > hands.txt`). Where it differs
from a real PokerStars file:

- Every player's hole cards appear as `Dealt to` lines: this is a full-information history, so a tracker's "hero"
  stats mean nothing.
- Hand numbers are `<table hex as integer> * 1000000 + hand_number` for a 6-digit table hex, and
  `crc32(table id) * 1000000 + hand_number` for longer ids; the table name is the session id (`tbl_xxxxxx`).
- `shows [..]` lines carry no hand description such as `(a pair of Tens)`.
- Side pots are not itemized: each winner gets one `collected N from pot` line with their total, and the summary is
  `Total pot N | Rake 0`.
- Uncalled bets are derived from the actions and printed as `Uncalled bet (N) returned to X`, as PokerStars does.
- Before 2026-11-09 a short all-in could win the whole pot, unmatched chips included, when the last player with chips
  folded with nothing to call. Those hands follow the engine's payout (no uncalled-bet line) and end with a
  `#note <hand_id>: ...` line.
- `hh.py` never fails on a hand: one it cannot write is left out and named on stderr.
