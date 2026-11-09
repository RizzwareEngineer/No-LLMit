# Hand history

Every hand the shared table finishes is saved once, when it ends.

- **`hands`** holds one row per hand. `doc` is the full record: seats and hole cards, the
  deck order, every decision on every street with the situation the player faced, and the
  result. Each action carries a `prompt_id`.
- **`decision_prompts`** holds the exact prompt each decision was made from and the raw
  reply, one row per decision, keyed by `prompt_id`. A retried decision also carries
  `retry_prompt`, the follow-up message the model was sent.
- **`system_prompts`** holds each system prompt once, keyed by the `prompt_version` in the
  hand's `config`. The version covers the system prompt, the user prompt template and the
  parser (`llm/prompts.py` and `llm/parsing.py`); a change to any of them starts a new one,
  and every action records it too.

[`hand-record-example.json`](hand-record-example.json) is a real record from a local table
running the mock provider, with its prompts alongside.

## Reading a record

- `parsed` is what we read from the model's reply; `applied` is what the engine did.
- `status` is `ok` when they are the same decision. Otherwise the applied action is a
  fallback and the status says why. `unparseable` (no readable ACTION) and `illegal`
  (a move the rules do not allow) are the model's own miss; `timeout` and `api_error`
  mean the model's provider failed (network, 429, 5xx, empty reply, out of time) and
  `service_error` that the LLM service itself was unreachable. Exclude all of them from
  playing-style statistics; count only the first two against the model.
- An `unparseable` or `illegal` reply is retried once: the model gets its own reply back
  with the reason and the legal list as a follow-up message, and `retried` is true.
  `parsed` is then the retry's reply, the prompt's `raw_reply` holds both separated by
  `--- retry ---`, and `retry_prompt` is the follow-up. If the retry is also bad, the
  fallback is `CHECK` when checking is legal and `FOLD` otherwise. Provider failures are
  retried within the turn's time budget without counting as a model retry.
- `model` and `upstream_provider` on an action are what OpenRouter reported serving that
  call; `reasoning_tokens` is its count of thinking tokens. All three are absent on records
  from before the Python-owned prompts, as is the per-action `prompt_version`.
- `result.net` is each seat's chips won or lost on the hand and sums to zero.
- Amounts on `BET`, `RAISE` and `ALL_IN` are the player's total bet for that street; on
  `CALL` they are the chips added.

## Where hands are saved

With `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` set, the engine saves to Supabase through the
`save_hand` function. Without them it appends to `data/hands.jsonl` and `data/prompts.jsonl`.
Hands played by the mock provider are never sent to Supabase.

A hand that still fails after 5 attempts is appended to `unsaved.jsonl` in `HAND_LOG_DIR`
(default `data/`), and that file is replayed at startup and after every successful save.
The engine also reads one row from `hands` every 6 hours so a free Supabase project is
never paused for inactivity.
