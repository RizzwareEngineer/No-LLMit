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

`LINEUP` picks the nine seated models: comma-separated display names from the roster below,
for example `LINEUP="GPT-OSS 120B,Qwen3 32B,DeepSeek V3.2,..."`. Unset means the default nine.
A name not in the roster, a repeat, or a count other than nine stops the service at startup.
The engine reads the lineup from `GET /models` when it starts. With the mock provider the
lineup instead rotates over the whole roster, nine seats per engine session, so every model
gets mock hands locally.

## Roster

`registry.py` `MODELS` is the roster and `PRICES` the OpenRouter list price in USD per
million tokens, checked against https://openrouter.ai/api/v1/models on 2026-11-05.

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

MiniMax M2 is not listed: `minimax/minimax-m2` is no longer on OpenRouter (M2.5 and M2.7 are).
`web/src/lib/constants.ts` `ALL_LLMS` mirrors the roster; `tests/test_registry.py` keeps them in sync.

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

`test_every_roster_slug_is_on_openrouter` is marked `network` and skips when OpenRouter is unreachable.

## API Endpoints

- `GET /health` - Health check
- `GET /usage` - `{"provider", "spend"}`: the provider and OpenRouter spend against the key's limit
- `GET /prompt` - The system prompt and the prompt version
- `GET /models?session=N` - `{"provider", "seated", "models": [{"name", "slug", "price_per_mtok", "seated"}]}`; `session` only matters to the mock provider's rotation
- `POST /decide` - The seat's move for a game state

### POST /decide

The engine sends the game state as data; the service renders the prompts, asks the seat's
model, parses and checks the reply, retries, and returns the move. Players are never named
to the model: it sees `Player N (POS)`, N being the seat number.

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

`seats` run clockwise from the small blind with current stacks. Action amounts are chips
added for `post` and `call` and the street total for `raise` and `all_in`; `pot` on a street
is the pot when it began. When the bet covers the player's stack the engine lists `CALL`
with the player's remaining chips beside the `ALL-IN`; the prompt shows them as one move,
`call all-in N`, and `call` or `all-in` in the reply both play as that all-in. A raise is
only listed while an opponent can still respond: facing a lone all-in the list is fold and
call (or fold and `call all-in N` when covered).

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
  "reasoning": null, "reasoning_tokens": null, "finish_reason": "stop",
  "upstream_provider": "DeepInfra", "generation_id": "gen-1730000000-abc", "temperature": 0.7
}
```

- `status`: `ok`; `unparseable` (no readable ACTION, twice) or `illegal` (a move outside the
  legal list, twice) are the model's own miss; `timeout` and `api_error` mean the provider
  failed (network, 429, 5xx, empty reply) after retries within the turn budget. When the
  status is not `ok`, `action`/`amount` are the model's last parsed reply (`FOLD 0` when none
  came) and the engine plays its own fallback: CHECK when legal, otherwise FOLD.
- `retried`: the first reply was unparseable or illegal and the model got one follow-up
  message (`retry_prompt`: its own reply back, the reason and the legal list). `raw` holds
  both replies separated by `--- retry ---`. A provider failure never counts as a retry.
- `prompt` is the user prompt rendered for this turn; the engine stores it with the hand.
- `prompt_version` hashes `prompts.py` and `parsing.py`: the system prompt, the user prompt
  template and the parser. A change to any of them starts a new version.
- `model` and `upstream_provider` are what OpenRouter reports serving the call;
  `reasoning` is the model's thinking text when it returns one, `reasoning_tokens` its
  count, and `finish_reason`, `generation_id`, `temperature` come from OpenRouter. The mock
  provider leaves them null.
- `reason` is empty when the model gave no REASON; it is never filled in for the model.

## Prompts

`prompts.py` holds the system prompt (`system_prompt`) and renders the user prompt
(`render_user_prompt`) and the retry message (`render_retry_prompt`). The same two prompts
go to every model; no model name, hand number or "still in the hand" list appears in them.
`web/src/lib/systemPrompt.ts` shows copies on the About page; `tests/test_prompts.py` fails
when they drift.

The system prompt says what each message holds and asks for the three-line reply. The user
prompt is a hand history: the blinds, the opponents' current stacks (chips, BB in
parentheses), one line for the player (`You are Player 4 (UTG+1), 1,130 (113 BB), holding
As Kd.`), one line per street with the board so far and the cards dealt on it, every action
and the pot after them (`Turn [Qh 7s 2c] [9d]: Player 1 (SB) bets 100. Pot 250.`), then one
line of legal actions.
Players are `Player N (POS)`, N the seat number. Action amounts follow hand-history
convention: `calls N` is chips added; `bets N`, `raises to N` and `all-in for N` are the
player's total on that street.

The legal-actions line lists, in this order, `fold`, `check`, `call N`, `bet N–M` or
`raise to N–M` (street totals; `bet` while nothing has been bet on the street, so the big
blind's preflop option is a raise), then the all-in: `call all-in N` when the bet covers the
stack (N the whole stack, the only way to call), `bet all-in N` or `raise all-in N` otherwise
(N the street total). Facing a lone all-in the engine lists no raise, so the line is
`fold, call 100`; too short to min-raise it is `fold, call 100, raise all-in 150`.

The reply format is ACTION, AMOUNT, REASON in that order for every model. Models with a
reasoning channel think there before the first line; models without one commit first and
explain after. Putting REASON first would turn it into a thinking dump that the site has to
display, and a long one risks being cut off before the ACTION line, the worst failure. The
parser holds a reply to that format and forgives only dress (markdown, case, list numbers,
quotes, emoji, field order, spellings of the all-in, commas in numbers): a reply is read as
the move it states or as a miss that gets the retry, never as a different move. Three
reviews each found a looser parser playing moves the model had not made, so:

- A label counts only at the start of a line, and a reply holds one answer: ACTION lines
  that differ are `unparseable` (a draft before the answer and a plan after it look the
  same). A one-line reply (`ACTION: fold | AMOUNT: 0 | REASON: ...`) and a label alone on
  its line with the value on the next are read.
- The ACTION line is only the move: `fold`, `check`, `call`, `bet`, `raise`, or the all-in
  (`all-in`, `raise all-in`, `bet all-in`, `go all-in`), with a size after bet or raise
  (`raise to 300`). Anything more is `unparseable`: `calling`, `shove`, `call the raise`,
  `fold (too weak)`, `call - actually all-in`. `call all-in` is a call, so `call the
  all-in` never shoves over a smaller bet; `call` when the bet covers the stack is that
  all-in.
- A bet or raise needs one whole number of chips, on the AMOUNT line (`300`, `$1,130`,
  `raise to 300`, `300 chips`) or right after the word. Big blinds, multiples, percentages,
  signs, decimals, arithmetic, and an ACTION and AMOUNT that disagree are `illegal` with a
  message that says which; `AMOUNT: all-in` is the all-in.
- With no ACTION label, only a reply whose first line is the move alone counts, with
  nothing else outside labelled fields (`RAISE: 150`).
- A reply the token limit cut off before the REASON that ends its answer is `unparseable`,
  and so is one over 20,000 characters. A parser error is ours: status `service_error`, no
  retry, never a 500 and never the model's miss.

`bet` where the legal action is RAISE is a raise; a raise to the all-in total is a raise when
one is legal and the all-in otherwise. The retry message after a bad reply is `That reply wasn't legal: <reason>.
Reply again in the three-line format with one of: <the legal-actions line>.`

## Budget and timeouts

One budget for every model (`providers/openrouter.py`, `decide.py`):

| Setting | Value | Why |
|---|---|---|
| `max_tokens` | 1536 | reasoning counts against it on most providers; leaves 512 for the three-line reply |
| `reasoning.max_tokens` | 1024 | Anthropic's minimum; effort-only models get the effort OpenRouter derives from it; non-reasoning models ignore it |
| `temperature` | 0.7 | sent explicitly so every host samples the same way |
| `REQUEST_TIMEOUT` | 25 s | a full 1024-token think plus the reply at ~50 tok/s |
| `TURN_BUDGET` | 45 s | the whole turn: one slow request, one retry, backoffs |
| `BACKOFF` | 1 s, 2 s | pauses before retrying a provider failure, while the budget allows |
| engine timeout | 50 s | `engine/client/llm.go`, the turn budget plus slack |

See https://openrouter.ai/docs/use-cases/reasoning-tokens for how OpenRouter maps a token
budget to an effort level and vice versa.

## Architecture

- **Go** manages game state, lists the legal moves and sends the state as data
- **Python** renders the prompts, calls the seat's model on OpenRouter, parses and checks the
  reply, retries once on the model's miss and while time remains on provider failures
- **Go** checks the returned move against the rules again (it stays the source of truth),
  applies it or its fallback, and records the decision
- Each prompt describes the current hand only; there is no memory of previous hands

## Files

- `app.py` - FastAPI server
- `decide.py` - One turn: prompts, call, parse, legality check, retries, fallback status
- `prompts.py` - The system prompt, the user prompt renderer and the version
- `parsing.py` - Turns a raw reply into an action
- `registry.py` - Seat names and the OpenRouter model behind each
- `providers/openrouter.py` - OpenRouter client and the token budget
- `providers/mock.py` - Random legal actions for local development
- `schemas.py` - `/decide` request and response
- `tests/` - pytest tests for prompt rendering (golden examples), parsing, the decision loop, `/decide` with the mock provider, and the OpenRouter client

