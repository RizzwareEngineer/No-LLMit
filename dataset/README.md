# Dataset export

Turns the saved hands into the open dataset: Parquet tables, the raw JSONL records, PokerStars hand histories and a
dataset card (`out/README.md`, written by `export.py`, which describes every column).

## Run

```sh
cd dataset
uv venv .venv -p 3.11 && uv pip install -p .venv/bin/python -r requirements.txt
.venv/bin/python -m pytest -q

# From the files scripts/dev.sh writes:
.venv/bin/python export.py --out out --from-jsonl ../engine/data/hands.jsonl ../engine/data/prompts.jsonl
# From the database (a day is the America/New_York date the hand started):
.venv/bin/python export.py --out out --day yesterday --back 3
# Publish (--pull first, so the card covers the days already published):
.venv/bin/python upload.py --out out --pull && .venv/bin/python upload.py --out out
```

`hh.py hands.jsonl > hands.txt` writes PokerStars hand histories on its own; its docstring lists where they differ
from a real PokerStars file.

## Settings

| Variable | Meaning |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | the database to export from (not needed with `--from-jsonl`) |
| `HF_TOKEN`, `HF_REPO` | the Hugging Face write token and dataset (for example `user/no-llmit-hands`) |
