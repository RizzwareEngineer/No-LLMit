# Hand history

Every hand the shared table finishes is saved once, when it ends.

- **`hands`** holds one row per hand. `doc` is the full record: seats and hole cards, the
  deck order, every decision on every street with the situation the player faced, and the
  result. Each action carries a `prompt_id`.
- **`decision_prompts`** holds the exact prompt each decision was made from and the raw
  reply, one row per decision, keyed by `prompt_id`. A retried decision also carries
  `retry_prompt`, the follow-up message the model was sent (Supabase dropped it before the
  2026-11-13 migration, so older rows have it null; the local `prompts.jsonl` always kept it).
- **`system_prompts`** holds each system prompt once, keyed by the `prompt_version` in the
  hand's `config`. The version covers the system prompt, the user prompt template, the
  parser, the legality check, retry and time budget, and the sampling settings
  (`llm/prompts.py`, `llm/parsing.py`, `llm/decide.py` and `llm/providers/openrouter.py`;
  versions before 2026-11-13 covered only the first two); a change to any of them starts a
  new one, and every action records it too.

[`hand-record-example.json`](hand-record-example.json) is a real record from a local table
running the mock provider, with its prompts alongside.

## Reading a record

- `parsed` is what we read from the model's reply; `applied` is what the engine did.
  `parsed.amount` is the reply's size on a bet or raise and 0 on every other move (before
  2026-11-13 a fold, call or all-in kept whatever number the reply wrote).
- `status` is `ok` when they are the same decision. Otherwise the applied action is a
  fallback and the status says why. `unparseable` (no readable ACTION) and `illegal`
  (a move the rules do not allow) are the model's own miss; `timeout` and `api_error`
  mean the model's provider failed (network, 429, 5xx, empty reply, out of time) and
  `service_error` that the LLM service itself was unreachable. Exclude all of them from
  playing-style statistics; count only the first two against the model.
- An `unparseable` or `illegal` reply is retried once: the model gets its own reply back
  with the reason and the legal-actions line as a follow-up message (`That reply wasn't
  legal: …`), and `retried` is true.
  `parsed` is then the retry's reply, the prompt's `raw_reply` holds both separated by
  `--- retry ---`, and `retry_prompt` is the follow-up. If the retry is also bad, the
  fallback is `CHECK` when checking is legal and `FOLD` otherwise. Provider failures are
  retried within the turn's time budget without counting as a model retry.
- A hand in which no call succeeded (no action `ok`, at least one `timeout`, `api_error` or
  `service_error`) is an outage, not a hand: it is voided and never saved, every stack and
  the button go back to where they were before the blinds, and the table waits 5 minutes
  (showing "The models can't be reached") before dealing again. Hand numbers skip it.
  Hands saved before 2026-11-09 can still be such hands; they were moved to
  `hands_voided` (see below).
- `model` and `upstream_provider` on an action are what OpenRouter reported serving that
  call; `reasoning_tokens` is its count of thinking tokens. All three are absent on records
  from before the Python-owned prompts, as is the per-action `prompt_version`.
- `result.net` is each seat's chips won or lost on the hand and sums to zero.
- Amounts on `BET`, `RAISE` and `ALL_IN` are the player's total bet for that street; on
  `CALL` they are the chips added.
- A call that covers the player's stack is offered as `call all-in N` and may come back as
  `call` or `all-in`: `parsed` keeps the model's word, `applied` is `ALL_IN` with the street
  total. A raise is only offered while an opponent can respond, so facing a lone all-in the
  legal list is fold and call. The prompt format itself is described in `llm/README.md`.

## Where hands are saved

With `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` set, the engine saves to Supabase through the
`save_hand` function. Without them it appends to `data/hands.jsonl` and `data/prompts.jsonl`.
Hands played by the mock provider are never sent to Supabase.

If a save fails, the table waits and retries (2 s, doubling to 60 s) until it succeeds,
and viewers see the "saving" notice meanwhile. A hand is counted in the stats only after it
is saved. The stats poll that reads new hands from Supabase every 5 minutes also keeps a
free Supabase project from being paused for inactivity.

`hands_voided` and `decision_prompts_voided` (the columns `hands` and `decision_prompts` had then;
`decision_prompts_voided` has no `retry_prompt`)
hold the 71 hands saved between 2026-11-04 and 2026-11-09 in which every call failed at the
provider: outages, not poker. Stats and the dataset read `hands` only. To restore one, insert
its rows back into `hands` and `decision_prompts`, naming the columns.
