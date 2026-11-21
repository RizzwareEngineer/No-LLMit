# LLM service

The FastAPI service the engine asks for every move: it builds the prompt, calls the seat's model on OpenRouter, reads the reply and retries once if it is illegal.

```sh
cd llm && uv venv -p 3.11 && uv pip install -r requirements-dev.txt
LLM_PROVIDER=mock .venv/bin/python -m uvicorn app:app --port 5001
.venv/bin/python -m pytest -q
```

Settings come from the environment or `.env` ([`.env.example`](.env.example)): `LLM_PROVIDER` (`mock` or `openrouter`), `OPENROUTER_API_KEY`, `LLM_SERVICE_TOKEN` (the engine's shared secret) and `LINEUP` (nine names from `registry.py`).
