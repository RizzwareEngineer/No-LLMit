# LLM service

The Python (FastAPI) service the engine asks for every move: it writes the prompt, calls the seat's model through
OpenRouter, reads the reply, retries once if it is illegal or unreadable, and returns a legal move.

## Run

```sh
cd llm
uv venv -p 3.11 && uv pip install -r requirements-dev.txt
LLM_PROVIDER=mock .venv/bin/python -m uvicorn app:app --port 5001
.venv/bin/python -m pytest -q
```

`scripts/dev.sh` runs it together with the engine and the site.

## Settings

Read from the environment or `llm/.env` ([`.env.example`](.env.example)).

| Variable | Meaning |
|---|---|
| `LLM_PROVIDER` | `mock` (random legal moves, no API calls) or `openrouter`; unset picks `openrouter` when a key is set |
| `OPENROUTER_API_KEY` | needed only for `openrouter` |
| `LLM_SERVICE_TOKEN` | shared secret the engine sends; every route but `/health` needs it |
| `LINEUP` | nine model names from `registry.py`, comma-separated; unset means the default nine |

## Where things are

- `prompts.py`: the system prompt, the user prompt and the retry message (every model gets the same two)
- `parsing.py`: reads a reply as `ACTION`, `AMOUNT`, `REASON`
- `decide.py`: one turn: prompt, call, parse, legality check, retry
- `registry.py`: the roster of models and the lineup
- `app.py`: the routes: `/health`, `/models`, `/prompt`, `/usage` and `POST /decide`
