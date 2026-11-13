# LLM service

The Python (FastAPI) service that turns the engine's game state into a prompt, asks the seat's model on OpenRouter and returns a legal move.

## Run and test

```sh
cd llm
uv venv -p 3.11 && uv pip install -r requirements-dev.txt   # requirements.txt alone in production
LLM_PROVIDER=mock .venv/bin/python -m uvicorn app:app --port 5001
.venv/bin/python -m pytest -q
```

`scripts/dev.sh` at the repo root runs it with the engine and the site. Settings are in [`.env.example`](.env.example):
without `OPENROUTER_API_KEY` (or with `LLM_PROVIDER=mock`) the service runs mock models that play random legal moves
and call nothing. `LINEUP` picks the nine seated models by name from the roster below; unset means the first nine. A
name not in the roster, a repeat, or a count other than nine stops the service at startup. With mock models the lineup
instead rotates over the whole roster, nine seats per engine session, so every model gets hands locally.
`test_every_roster_slug_is_on_openrouter` is marked `network` and skips when OpenRouter is unreachable.

## Roster

`registry.py` `MODELS` is the roster. The table below is the only price list: hand-kept OpenRouter
list prices in USD per million tokens, checked against https://openrouter.ai/api/v1/models on 2026-11-05.

| Model | OpenRouter slug | Prompt | Completion | Default seat |
|---|---|---|---|---|
| GPT-OSS 20B | `openai/gpt-oss-20b` | 0.03 | 0.13 | yes |
| Claude Haiku 5.5 | `anthropic/claude-haiku-5.5` | 0.10 | 0.50 | yes |
| Gemma 3 12B | `google/gemma-3-12b-it` | 0.05 | 0.15 | yes |
| Llama 3.1 8B | `meta-llama/llama-3.1-8b-instruct` | 0.05 | 0.08 | yes |
| Mistral Nemo | `mistralai/mistral-nemo` | 0.029 | 0.03 | yes |
| DeepSeek V4 Flash | `deepseek/deepseek-v4-flash` | 0.091 | 0.182 | yes |
| Phi-4 | `microsoft/phi-4` | 0.07 | 0.14 | yes |
| Qwen 3.7 Flash | `qwen/qwen3.7-flash` | 0.03 | 0.13 | yes |
| Cohere Command R7B | `cohere/command-r7b-12-2024` | 0.0375 | 0.15 | yes |
| Qwen3 235B A22B | `qwen/qwen3-235b-a22b-2507` | 0.14 | 0.80 | |
| Qwen3 32B | `qwen/qwen3-32b` | 0.08 | 0.28 | |
| DeepSeek V3.2 | `deepseek/deepseek-v3.2` | 0.26 | 0.38 | |
| Llama 4 Maverick | `meta-llama/llama-4-maverick` | 0.35 | 1.00 | |
| Mistral Large 3 | `mistralai/mistral-large-2512` | 0.50 | 1.50 | |
| Gemma 3 27B | `google/gemma-3-27b-it` | 0.08 | 0.35 | |
| GLM-4.6 | `z-ai/glm-4.6` | 0.50 | 2.00 | |
| Kimi K2 | `moonshotai/kimi-k2-0905` | 0.60 | 2.50 | |
| GPT-OSS 120B | `openai/gpt-oss-120b` | 0.022 | 0.083 | |
| Nemotron 3.5 Super | `nvidia/nemotron-3.5-super-vl` | 0.15 | 0.50 | |

`web/src/lib/constants.ts` `ALL_LLMS` mirrors the roster; `tests/test_registry.py` keeps them in sync.

## Endpoints

- `GET /health`: `{"status", "provider"}`; 503 when `openrouter` has no key
- `GET /usage`: `{"provider", "spend"}`, the OpenRouter spend against the key's limit (null for mock)
- `GET /prompt`: the system prompt and the prompt version
- `GET /models?session=N`: `{"provider", "seated", "turn_budget_s"}`; the engine reads its lineup and shot clock here
  at startup; `session` only matters to the mock rotation
- `POST /decide`: the seat's move for a game state

## POST /decide

The engine sends the game state as data; the service renders the prompts, asks the model, parses and checks the reply,
retries, and returns the move. The model never sees a model name: players are `Player N (POS)`, N being the seat index
plus one.

Request (`schemas.py` `DecisionRequest`):
```json
{
  "player_name": "Claude Haiku 5.5",
  "small_blind": 5, "big_blind": 10,
  "seats": [{"seat": 7, "position": "SB", "stack": 1953}, {"seat": 8, "position": "BB", "stack": 1990}, "..."],
  "streets": [
    {"street": "preflop", "board": [], "pot": 0, "actions": [
      {"seat": 7, "action": "post", "amount": 5}, {"seat": 8, "action": "post", "amount": 10},
      {"seat": 0, "action": "fold"}, {"seat": 6, "action": "raise", "amount": 30}, {"seat": 7, "action": "call", "amount": 25}]},
    {"street": "flop", "board": ["Ah", "7d", "2c"], "pot": 90, "actions": []}
  ],
  "seat": 8, "position": "BB", "hole_cards": ["Ad", "Tc"],
  "pot": 90, "to_call": 0, "stack": 1970,
  "legal_actions": [{"type": "FOLD"}, {"type": "CHECK"}, {"type": "BET", "min": 10, "max": 1970}, {"type": "ALL-IN", "amount": 1970}]
}
```

`seats` run clockwise from the seat after the button, button last, with current stacks (heads-up: the big blind, then
the button). Action amounts are chips added for `post` and `call` and the street total for `raise` and `all_in`; a
street's `pot` is the pot when it began. When the bet covers the player's stack the engine lists `CALL` with the
remaining chips beside `ALL-IN`; the prompt shows them as one move, `call all-in N`. A raise is listed only while an
opponent can still respond, so facing a lone all-in the list is fold and call.

Response (`DecisionResponse`):
```json
{
  "action": "RAISE", "amount": 150, "reason": "Strong hand in position.",
  "raw": "ACTION: raise\nAMOUNT: 150\nREASON: Strong hand in position.",
  "latency_ms": 1234, "status": "ok", "retried": false, "error": null,
  "prompt": "Blinds 5/10.\n\nOpponents:\n...",
  "retry_prompt": null,
  "provider": "openrouter", "model": "microsoft/phi-4",
  "tokens_in": 812, "tokens_out": 41, "cost_usd": 0.00002, "prompt_version": "f605559",
  "reasoning_tokens": null, "upstream_provider": "DeepInfra"
}
```

- `status`: `ok`, or why the engine plays its fallback (`CHECK` when legal, otherwise `FOLD`) instead: `unparseable`
  or `illegal` (the model's own miss, twice), `timeout` or `api_error` (the provider failed after retries within the
  turn budget), or `service_error` (our parser failed). [docs/hand-history.md](../docs/hand-history.md) says how each is recorded.
- `action`/`amount`: the model's last parsed reply (`FOLD 0` when none came). `amount` is the size for `RAISE` (a bet
  or a raise to a street total) and 0 for every other move.
- `retried`: the first reply was unparseable or illegal and the model got one follow-up (`retry_prompt`). `raw` holds
  both replies separated by `--- retry ---`. A provider failure never counts as a retry.
- `reason` is empty when the model gave none; it is never filled in for the model.
- `prompt` is the user prompt for this turn; the engine saves it with the hand.
- `prompt_version` hashes `prompts.py`, `parsing.py`, `decide.py` and `providers/openrouter.py`: the prompts, the
  parser, the legality check, the retry and time budget, and the sampling settings. Any change starts a new version.
- `model`, `upstream_provider` and `reasoning_tokens` are what OpenRouter reports; the last two are null for mock.

## Prompts

`prompts.py` holds the system prompt and renders the user prompt and the retry message. Every model gets the same
two. `web/src/lib/systemPrompt.ts` shows copies on the About page; `tests/test_prompts.py` fails when they drift.

The user prompt is a hand history: the blinds, the opponents' current stacks (chips, BB in parentheses), one line for
the player (`You are Player 4 (UTG+1), 1,130 (113 BB), holding As Kd.`), one line per street with the board, every
action and the pot after them (`Turn [Qh 7s 2c] [9d]: Player 1 (SB) bets 100. Pot 250.`), then the legal actions.
`calls N` is chips added; `bets N`, `raises to N` and `all-in for N` are the player's street total.

The legal-actions line lists, in this order: `fold`, `check`, `call N`, `bet N–M` or `raise to N–M` (street totals;
`bet` while nothing has been bet on the street, so the big blind's preflop option is a raise), then the all-in:
`call all-in N` when the bet covers the stack, `bet all-in N` or `raise all-in N` otherwise, or `all-in N` when no bet
or raise is listed. Facing a lone all-in it is `fold, call 100`; too short to min-raise, `fold, call 100, all-in 150`.

## Reading the reply

The reply is ACTION, AMOUNT, REASON, in that order, for every model. Models with a reasoning channel think there
first; the rest commit first and explain after. REASON first would turn it into a thinking dump the site has to show,
and a long one could be cut off before the ACTION line.

The parser forgives only dress (markdown, case, list numbers, quotes, emoji, field order, spellings of the all-in,
commas in numbers). A reply is read as the move it states, or as a miss that gets the retry, never as a different move:

- A label counts only at the start of a line. ACTION lines that differ are `unparseable`. A one-line reply
  (`ACTION: fold | AMOUNT: 0 | REASON: ...`) and a label alone with its value on the next line are read.
- The ACTION line is only the move: `fold`, `check`, `call`, `bet`, `raise`, or the all-in (`all-in`, `raise all-in`,
  `bet all-in`, `go all-in`), with a size after bet or raise (`raise to 300`). Anything more is `unparseable`
  (`calling`, `shove`, `call the raise`, `fold (too weak)`). `call all-in` is a call, so it never shoves over a smaller
  bet; `call` when the bet covers the stack is that all-in.
- A bet or raise needs one whole number of chips, on the AMOUNT line (`300`, `$1,130`, `300 chips`) or right after the
  word. Big blinds, multiples, percentages, signs, decimals, arithmetic, and an ACTION and AMOUNT that disagree are
  `illegal`, with a message saying which. `AMOUNT: all-in` is the all-in.
- With no ACTION label, only a reply whose first line is the move alone counts (`RAISE: 150`).
- A reply cut off by the token limit before its REASON, or over 20,000 characters, is `unparseable`. A parser crash is
  ours: `service_error`, no retry, never the model's miss.
- `bet` where the legal action is RAISE is a raise; a raise to the all-in total is a raise when one is legal and the
  all-in otherwise.

The retry message is `That reply wasn't legal: <reason>. Reply again in the three-line format with one of: <the
legal-actions line>.`

## Budget and timeouts

One budget for every model (`providers/openrouter.py`, `decide.py`):

| Setting | Value | Why |
|---|---|---|
| `max_tokens` | 1536 | reasoning counts against it on most providers; leaves 512 for the reply |
| `reasoning.max_tokens` | 1024 | Anthropic's minimum; effort-only models get the effort OpenRouter derives from it |
| `temperature` | 0.7 | sent so every host samples the same way |
| `REQUEST_TIMEOUT` | 25 s | a full 1024-token think plus the reply at ~50 tokens/s |
| `TURN_BUDGET` | 45 s | the whole turn: one slow request, one retry, backoffs |
| `BACKOFF` | 1 s, 2 s | pauses before retrying a provider failure, while the budget allows |
| engine timeout | 50 s | `engine/client/llm.go`: the turn budget plus slack |

## Files

- `app.py`: the FastAPI server
- `decide.py`: one turn: prompts, call, parse, legality check, retries, status
- `prompts.py`: the system prompt, the user prompt, the retry message and the version
- `parsing.py`: turns a raw reply into a move
- `registry.py`: the roster and the lineup
- `providers/openrouter.py`, `providers/mock.py`: the two providers
- `schemas.py`: the `/decide` request and response
- `tests/`: prompt rendering (golden examples), parsing (a corpus of real replies), the decision loop, the app, the roster
