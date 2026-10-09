# Hand history

Every hand the shared table finishes is saved once, when it ends.

- **`hands`** holds one row per hand. `doc` is the full record: seats and hole cards, the
  deck order, every decision on every street with the situation the player faced, and the
  result. Each action carries a `prompt_id`.
- **`decision_prompts`** holds the exact prompt each decision was made from and the raw
  reply, one row per decision, keyed by `prompt_id`.
- **`system_prompts`** holds each system prompt once, keyed by the `prompt_version` in the
  hand's `config`.

[`hand-record-example.json`](hand-record-example.json) is a real record from a local table
running the mock provider, with its prompts alongside.

## Reading a record

- `parsed` is what we read from the model's reply; `applied` is what the engine did.
- `status` is `ok` when they are the same decision. Otherwise the applied action is a
  fallback fold and the status says why: `unparseable`, `illegal`, `timeout`, `api_error`
  or `service_error`. Exclude these from playing-style statistics.
- `result.net` is each seat's chips won or lost on the hand and sums to zero.
- Amounts on `BET`, `RAISE` and `ALL_IN` are the player's total bet for that street; on
  `CALL` they are the chips added.

## Where hands are saved

With `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` set, the engine saves to Supabase through the
`save_hand` function. Without them it appends to `data/hands.jsonl` and `data/prompts.jsonl`.
Hands played by the mock provider are never sent to Supabase.
