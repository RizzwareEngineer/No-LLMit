# Dataset export

Turns the saved hands into the open dataset: Parquet tables, the raw JSONL, PokerStars hand histories and a dataset card.

```sh
cd dataset && uv venv .venv -p 3.11 && uv pip install -p .venv/bin/python -r requirements.txt
.venv/bin/python export.py --out out --from-jsonl ../engine/data/hands.jsonl ../engine/data/prompts.jsonl
.venv/bin/python upload.py --out out --pull && .venv/bin/python upload.py --out out
```

Exporting from the database needs `SUPABASE_URL` and `SUPABASE_SERVICE_KEY`. Uploading needs `HF_TOKEN` and `HF_REPO`.
