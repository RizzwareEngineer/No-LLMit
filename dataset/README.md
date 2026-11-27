# Dataset exporter

Turns the hands the engine saved into an open dataset and publishes it to a Hugging Face dataset repo.

## How it works

- `export.py` reads hands and prompts from Supabase (`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`), or from the engine's local `hands.jsonl` and `prompts.jsonl` with `--from-jsonl`.
- It writes one folder per day (the America/New_York date the hand started): `hands.jsonl`, `hands.parquet`, `seats.parquet`, `decisions.parquet` and `pokerstars.txt`.
- It also writes `system_prompts.jsonl` and a dataset card, `README.md`, built from every day in the output folder.
- `hh.py` renders hands as PokerStars-format hand histories.
- `upload.py` publishes the output folder to the Hugging Face repo `HF_REPO`. `--pull` first downloads the published tables, so the card covers every day. `--dry-run` uploads nothing.
- `.github/workflows/dataset.yml` runs the export nightly. It exports yesterday and the three days before it, then uploads. It skips itself until the four secrets below are set.

## Environment

- `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`: read hands from Supabase.
- `HF_TOKEN`, `HF_REPO`: upload target and its write token.

## Run and test

```sh
uv venv .venv -p 3.11 && uv pip install -p .venv/bin/python -r requirements.txt
.venv/bin/python export.py --out out --from-jsonl ../engine/data/hands.jsonl ../engine/data/prompts.jsonl
.venv/bin/python export.py --out out --day yesterday --back 3   # from Supabase
.venv/bin/python upload.py --out out --pull && .venv/bin/python upload.py --out out
.venv/bin/python -m pytest -q
PG_TEST_URL=postgresql://localhost/scratch .venv/bin/python -m pytest -q tests/test_schema.py   # the Supabase migrations on a scratch Postgres (its public schema is dropped)
```
