# LLM Service

Python service that handles LLM API calls for No-LLMit poker.

## Setup

```bash
cd llm
uv venv
source .venv/bin/activate
uv pip install -r requirements-dev.txt   # requirements.txt alone in production
```

`requirements.txt` and the `Dockerfile` (Python 3.11) are the source of truth for dependencies.

## Environment

Create `.env` file:
```
OPENROUTER_API_KEY=sk-or-your_api_key_here
PORT=5001
```

Without `OPENROUTER_API_KEY` the service runs the mock provider, which plays random legal
actions and calls no model. Set `LLM_PROVIDER=mock` or `LLM_PROVIDER=openrouter` to force one.

## Run

```bash
source .venv/bin/activate
python app.py
```

Or with uvicorn directly:
```bash
uvicorn app:app --reload --port 5001
```

## Test

```bash
.venv/bin/python -m pytest -q
```

## API Endpoints

- `GET /health` - Health check
- `GET /usage` - `{"provider", "spend"}`: the provider and OpenRouter spend against the key's limit
- `GET /prompt` - The system prompt and its version
- `POST /decide` - Get LLM decision

### POST /decide

Request:
```json
{
  "player_name": "Claude Haiku 5.5",
  "prompt": "Hand #12. No Limit Texas Hold'em cash game, blinds 5/10, 9 players. ...",
  "valid_actions": [{"type": "FOLD"}, {"type": "CALL", "amount": 20}],
  "retry_note": null
}
```

`retry_note` is optional. When set, it is sent as a second user message
("Your previous reply was invalid: ... Reply again in the required format.").

Response:
```json
{
  "action": "RAISE",
  "amount": 150,
  "reason": "Strong hand in position.",
  "raw": "ACTION: RAISE\nAMOUNT: 150\nREASON: Strong hand in position.",
  "latency_ms": 1234,
  "status": "ok",
  "provider": "openrouter",
  "model": "microsoft/phi-4",
  "tokens_in": 812,
  "tokens_out": 41,
  "cost_usd": 0.00002,
  "prompt_version": "d7fd8ae",
  "reasoning": null,
  "reasoning_tokens": null,
  "finish_reason": "stop",
  "upstream_provider": "DeepInfra",
  "generation_id": "gen-1730000000-abc",
  "temperature": 0.7
}
```

- `status`: `ok`, `unparseable` (no action in the reply; the service folds), `truncated`
  (hit `max_tokens`, usually while thinking, before a usable answer), `timeout` or `api_error`.
- `reason` is empty when the model gave no REASON; it is never filled in for the model.
- `reasoning` is the model's thinking text when the model returns one; `reasoning_tokens`,
  `finish_reason`, `upstream_provider` (the host OpenRouter routed to), `generation_id` and
  `temperature` come from OpenRouter. The mock provider leaves all six null.

## Architecture

- **Go** manages game state and writes the text prompt for each decision
- **Python** is stateless: receives the prompt → calls the seat's model on OpenRouter → returns the action
- Each prompt describes the current hand only; there is no memory of previous hands
- Only the "You are ..." section (name, cards, stack) differs per LLM

## Files

- `app.py` - FastAPI server
- `prompts.py` - System prompt for LLM poker players
- `registry.py` - Seat names and the OpenRouter model behind each
- `parsing.py` - Turns a raw reply into an action
- `providers/openrouter.py` - OpenRouter client
- `providers/mock.py` - Random legal actions for local development
- `schemas.py` - `/decide` request and response
- `tests/` - pytest tests for parsing, `/decide` with the mock provider, and the OpenRouter client

