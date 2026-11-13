# Hand history

What is saved for every hand and how to read it. The record is built in `engine/api/record.go`; the tables are in `supabase/migrations/`.

Every hand the table finishes is saved once, when it ends, before the next is dealt.

- **`hands`**: one row per hand. `doc` is the full record: seats and hole cards, the deck order, every decision on
  every street with the situation the player faced, and the result. Each action carries a `prompt_id`.
- **`decision_prompts`**: the exact prompt each decision was made from and the raw reply, one row per decision, keyed
  by `prompt_id`. A retried decision also has `retry_prompt`, the follow-up message the model was sent (null in
  Supabase rows before 2026-11-13; the local `prompts.jsonl` always kept it).
- **`system_prompts`**: each system prompt once, keyed by the `prompt_version` in the hand's `config` and on every
  action. The version hashes the prompts, the parser, the retry and time budget and the sampling settings (see
  [`llm/README.md`](../llm/README.md)); versions before 2026-11-13 covered only the prompts.

[`hand-record-example.json`](hand-record-example.json) is a real record from a local table running the mock models,
with its prompts.

## Reading a record

- `parsed` is what we read from the model's reply; `applied` is what the engine did. `parsed.amount` is the size of a
  bet or raise and 0 on every other move (before 2026-11-13 a fold, call or all-in kept whatever number the reply wrote).
- `status` is `ok` when the two are the same decision. Otherwise `applied` is a fallback (`CHECK` when legal, else
  `FOLD`) and the status says why: `unparseable` (no readable ACTION) and `illegal` (a move the rules do not allow) are
  the model's own miss; `timeout` and `api_error` mean its provider failed (network, 429, 5xx, empty reply, out of
  time); `service_error` means the LLM service itself was unreachable. Leave all of them out of playing-style
  statistics; count only the first two against the model.
- An `unparseable` or `illegal` reply is retried once, with the model's own reply, the reason and the legal actions as
  a follow-up message, and `retried` is true. `parsed` is then the retry's reply, `raw_reply` holds both separated by
  `--- retry ---`, and `retry_prompt` is the follow-up. Provider failures are retried within the turn's time budget
  and do not count as a retry.
- A hand in which no call succeeded (no action `ok`, at least one `timeout`, `api_error` or `service_error`) is an
  outage, not a hand: it is never saved, every stack and the button go back to where they were before the blinds, and
  the table waits 5 minutes ("The models can't be reached…") before dealing again. Hand numbers skip it.
- `model` and `upstream_provider` on an action are what OpenRouter reported serving the call; `reasoning_tokens` is
  its count of thinking tokens. Records from before the prompts moved to the LLM service have none of the three, and
  no per-action `prompt_version`.
- `result.net` is each seat's chips won or lost and sums to zero.
- Amounts on `BET`, `RAISE` and `ALL_IN` are the player's total for that street; on `CALL` they are the chips added.
- A call that covers the player's stack is offered as `call all-in N` and may come back as `call` or `all-in`:
  `parsed` keeps the model's word, `applied` is `ALL_IN` with the street total. Facing a lone all-in the legal
  actions are fold and call only.

## Where hands are saved

With `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` set, the engine saves to Supabase through the `save_hand` function.
Without them it appends to `hands.jsonl` and `prompts.jsonl` in `HAND_LOG_DIR` (default `data`). Hands played by the
mock models are never sent to Supabase.

If a save fails, the table waits and retries (2 s, doubling to 60 s) until it succeeds, and viewers see a "saving"
notice meanwhile. A hand counts in the stats only once it is saved.

`hands_voided` and `decision_prompts_voided` hold the 71 hands saved between 2026-11-04 and 2026-11-09 in which every
call failed at the provider: outages, not poker. Stats and the dataset read `hands` only. To restore one, insert its
rows back into `hands` and `decision_prompts`, naming the columns (the voided tables have the columns of that time;
`decision_prompts_voided` has no `retry_prompt`).
