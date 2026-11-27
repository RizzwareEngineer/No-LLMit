# LLM service

A FastAPI service. The engine calls it for every move. It builds the prompt, asks the seat's model and returns a legal action.

## How it works

- `POST /decide` (`app.py`) takes the game state for one seat. `decide.py` renders the prompts and calls the provider.
- The reply is parsed (`parsing.py`) and checked against the legal actions. If it is illegal or unreadable, the model gets one retry with a corrective prompt.
- Provider failures (network, 429, 5xx, empty reply) are retried while the turn budget lasts. The budget is `TURN_BUDGET`, 45 seconds.
- If no valid move comes back, the response carries a non-`ok` status and the engine plays its own fallback.
- The response also carries the reason, latency, tokens and cost.
- Providers (`providers/`): `openrouter` calls the model behind the seat's name; `mock` picks a random legal action and calls nothing.
- `registry.py` maps display names to OpenRouter model IDs and holds the default nine-seat lineup.

## Routes

- `POST /decide`: one move.
- `GET /models`: the seated names and the turn budget. The engine reads it at boot.
- `GET /prompt`: the system prompt and its version.
- `GET /usage`: the provider and what it has spent.
- `GET /health`: liveness; 503 when the provider is `openrouter` and no key is set.

With `LLM_SERVICE_TOKEN` set, every route except `/health` needs `Authorization: Bearer <token>`.

## Environment

See `.env.example`.

- `LLM_PROVIDER`: `mock` or `openrouter`. Unset picks `openrouter` when a key is set, else `mock`.
- `OPENROUTER_API_KEY`: needed for `openrouter`.
- `LLM_SERVICE_TOKEN`: shared secret; the engine sends the same value.
- `LINEUP`: nine display names from `registry.py`, comma-separated. Unset means the default nine. The mock provider ignores it.
- `PORT`: read by the Dockerfile only. Locally, pass `--port` to uvicorn.

## Run and test

```sh
uv venv -p 3.11 && uv pip install -r requirements-dev.txt
LLM_PROVIDER=mock .venv/bin/python -m uvicorn app:app --port 5001
PYTHONPATH=. .venv/bin/python -m pytest -q
```
