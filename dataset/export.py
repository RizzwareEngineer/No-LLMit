"""Export No-LLMit hand history to an open dataset.

  python export.py --out out --day 2026-11-03            # from Supabase (SUPABASE_URL, SUPABASE_SERVICE_KEY)
  python export.py --out out --from-jsonl hands.jsonl prompts.jsonl

Writes, per day (America/New_York date the hand started, so one table day is one partition):
  out/day=YYYY-MM-DD/hands.jsonl        raw hand docs
  out/day=YYYY-MM-DD/hands.parquet      one row per hand
  out/day=YYYY-MM-DD/seats.parquet      one row per seat dealt in
  out/day=YYYY-MM-DD/decisions.parquet  one row per decision, with its prompt and raw reply
  out/day=YYYY-MM-DD/pokerstars.txt     PokerStars-format hand histories
and for the whole output dir:
  out/system_prompts.jsonl              one row per prompt_version
  out/README.md                         dataset card, built from every day in out/
"""

import argparse
import glob
import json
import os
import sys
import urllib.parse
import urllib.request
from collections import defaultdict
from datetime import date, datetime, time, timedelta, timezone

import pyarrow as pa
import pyarrow.parquet as pq

import hh

PAGE = 500  # rows per Supabase request
EXPORTED = ".exported-days"  # the days the last export wrote

TS = pa.timestamp("us", tz="UTC")
HANDS = pa.schema([
    ("hand_id", pa.string()), ("session", pa.string()), ("hand_number", pa.int32()),
    ("day", pa.string()), ("started_at", TS), ("ended_at", TS), ("schema", pa.int16()),
    ("small_blind", pa.int32()), ("big_blind", pa.int32()), ("provider", pa.string()),
    ("prompt_version", pa.string()), ("memory", pa.string()), ("button_seat", pa.int8()),
    ("n_players", pa.int8()), ("board", pa.list_(pa.string())), ("deck", pa.list_(pa.string())),
    ("n_decisions", pa.int16()), ("pot", pa.int64()), ("showdown", pa.bool_()),
])
SEATS = pa.schema([
    ("hand_id", pa.string()), ("session", pa.string()), ("day", pa.string()),
    ("seat", pa.int8()), ("name", pa.string()), ("model", pa.string()), ("position", pa.string()),
    ("stack_start", pa.int64()), ("hole_cards", pa.list_(pa.string())), ("rebought", pa.bool_()),
    ("showdown", pa.bool_()), ("net", pa.int64()),
])
LEGAL = pa.struct([("type", pa.string()), ("amount", pa.int64()), ("min", pa.int64()), ("max", pa.int64())])
DECISIONS = pa.schema([
    ("hand_id", pa.string()), ("session", pa.string()), ("day", pa.string()), ("n", pa.int16()),
    ("street", pa.string()), ("seat", pa.int8()), ("player", pa.string()), ("model", pa.string()),
    ("position", pa.string()), ("prompt_version", pa.string()), ("pot_before", pa.int64()),
    ("to_call", pa.int64()), ("stack_before", pa.int64()), ("legal_actions", pa.list_(LEGAL)),
    ("parsed_action", pa.string()), ("parsed_amount", pa.int64()), ("parsed_reason", pa.string()),
    ("status", pa.string()), ("retried", pa.bool_()), ("applied_action", pa.string()),
    ("applied_amount", pa.int64()), ("latency_ms", pa.int64()), ("tokens_in", pa.int64()),
    ("tokens_out", pa.int64()), ("cost_usd", pa.float64()), ("prompt_id", pa.string()),
    ("prompt", pa.string()), ("raw_reply", pa.string()),
])


# ---- sources ----

def _read_jsonl(path):
    with open(path) as f:
        return [json.loads(line) for line in f if line.strip()]


def load_jsonl(hands_path, prompts_path):
    """The engine's local files (data/hands.jsonl, data/prompts.jsonl). They hold no system prompts."""
    return _read_jsonl(hands_path), _read_jsonl(prompts_path), []


def _get(base, key, path, params):
    url = f"{base}/rest/v1/{path}?{urllib.parse.urlencode(params, safe='(),.:*')}"
    req = urllib.request.Request(url, headers={"apikey": key, "Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.load(r)


def _paged(base, key, path, params, order):
    rows, offset = [], 0
    while True:
        page = _get(base, key, path, {**params, "order": order, "limit": PAGE, "offset": offset})
        rows += page
        if len(page) < PAGE:
            return rows
        offset += PAGE


def load_supabase(base, key, day=None, back=0):
    """Hands (optionally only those that started on ET day `day` or the `back` days before it),
    their prompts, and all system prompts."""
    params = {"select": "doc"}
    if day:
        start, end = (datetime.combine(d, time(), hh.ET).astimezone(timezone.utc)
                      for d in (day - timedelta(days=back), day + timedelta(days=1)))
        params["and"] = f"(started_at.gte.{start.isoformat()},started_at.lt.{end.isoformat()})"
    hands = [r["doc"] for r in _paged(base, key, "hands", params, "hand_id")]
    prompts = []
    ids = [h["hand_id"] for h in hands]
    for i in range(0, len(ids), 50):  # keep the URL short
        chunk = ",".join(f'"{x}"' for x in ids[i:i + 50])
        prompts += _paged(base, key, "decision_prompts",
                          {"select": "prompt_id,n,prompt,raw_reply", "hand_id": f"in.({chunk})"}, "prompt_id")
    systems = _paged(base, key, "system_prompts", {"select": "prompt_version,system_prompt,created_at"}, "prompt_version")
    return hands, prompts, systems


# ---- flattening ----

def hand_day(hand) -> str:
    return datetime.fromisoformat(hand["started_at"]).astimezone(hh.ET).date().isoformat()


def _ts(iso):
    return datetime.fromisoformat(iso)


def _kind(action):
    """One spelling for all-in: the engine offers ALL-IN but applies ALL_IN."""
    return "ALL_IN" if action in ("ALL-IN", "all-in", "allin") else action


def _pot(hand):
    """Every chip put in, less uncalled bets returned. result.pots can miss a side pot the
    engine treated as an uncalled bet although it held dead money."""
    try:
        return hh.render(hand)[1]
    except Exception:  # noqa: BLE001 - a hand hh cannot replay keeps a null pot
        return None


def flatten(hands, prompts):
    """Rows for the three tables. Raises if a decision's prompt is missing."""
    by_id = {p["prompt_id"]: p for p in prompts}
    hand_rows, seat_rows, decision_rows = [], [], []
    for h in hands:
        cfg, res, day = h["config"], h["result"], hand_day(h)
        net = {int(k): v for k, v in res["net"].items()}
        shown = {s["seat"] for s in res["showdown"]}
        seats = {s["seat"]: s for s in h["seats"]}
        common = {"hand_id": h["hand_id"], "session": h["table_id"], "day": day}
        hand_rows.append({
            **common, "hand_number": h["hand_number"], "started_at": _ts(h["started_at"]),
            "ended_at": _ts(h["ended_at"]), "schema": h["schema"], "small_blind": cfg["small_blind"],
            "big_blind": cfg["big_blind"], "provider": cfg["provider"], "prompt_version": cfg["prompt_version"],
            "memory": cfg.get("memory"), "button_seat": h["button_seat"], "n_players": len(h["seats"]),
            "board": h["board"], "deck": h["deck"], "n_decisions": len(h["actions"]),
            "pot": _pot(h), "showdown": bool(shown),
        })
        for s in h["seats"]:
            seat_rows.append({
                **common, "seat": s["seat"], "name": s["name"], "model": s.get("model"),
                "position": s["position"], "stack_start": s["stack_start"], "hole_cards": s["hole_cards"],
                "rebought": s.get("rebought", False), "showdown": s["seat"] in shown, "net": net.get(s["seat"], 0),
            })
        for a in h["actions"]:
            p = by_id.get(a["prompt_id"])
            if p is None:
                raise ValueError(f"{h['hand_id']}: no prompt for {a['prompt_id']}")
            parsed, applied, seat = a["parsed"], a["applied"], seats[a["seat"]]
            decision_rows.append({
                **common, "n": a["n"], "street": a["street"], "seat": a["seat"], "player": a["player"],
                "model": seat.get("model"), "position": seat["position"], "prompt_version": cfg["prompt_version"],
                "pot_before": a["pot_before"], "to_call": a["to_call"], "stack_before": a["stack_before"],
                "legal_actions": [{**{k: la.get(k) for k in ("amount", "min", "max")}, "type": _kind(la["type"])}
                                  for la in a["legal_actions"]],
                "parsed_action": _kind(parsed.get("action")),
                # The engine stores 0 when a reply had no amount; only a raise or bet carries one.
                "parsed_amount": parsed.get("amount") if _kind(parsed.get("action")) in ("RAISE", "BET") else None,
                "parsed_reason": parsed.get("reason"), "status": a["status"], "retried": a.get("retried", False),
                "applied_action": applied["type"], "applied_amount": applied.get("amount"),
                "latency_ms": a.get("latency_ms"), "tokens_in": a.get("tokens_in"), "tokens_out": a.get("tokens_out"),
                "cost_usd": a.get("cost_usd"), "prompt_id": a["prompt_id"], "prompt": p["prompt"],
                "raw_reply": p["raw_reply"],
            })
    return hand_rows, seat_rows, decision_rows


# ---- writing ----

def export(hands, prompts, systems, out):
    """Writes one partition per day present in hands, replacing it if it exists, then the card."""
    os.makedirs(out, exist_ok=True)
    days, prompts_by_day = defaultdict(list), defaultdict(list)
    for h in hands:
        days[hand_day(h)].append(h)
    day_of = {h["hand_id"]: hand_day(h) for h in hands}
    for p in prompts:
        prompts_by_day[day_of.get(p["prompt_id"].rsplit("-", 1)[0])].append(p)
    for day, day_hands in sorted(days.items()):
        day_hands.sort(key=hh.start_order)
        day_prompts = prompts_by_day[day]
        rows = flatten(day_hands, day_prompts)  # raises before anything of the day is written
        d = os.path.join(out, f"day={day}")
        os.makedirs(d, exist_ok=True)
        with open(os.path.join(d, "hands.jsonl"), "w") as f:
            f.writelines(json.dumps(h, separators=(",", ":")) + "\n" for h in day_hands)
        for name, schema, table_rows in zip(("hands", "seats", "decisions"), (HANDS, SEATS, DECISIONS), rows):
            pq.write_table(pa.Table.from_pylist(table_rows, schema=schema), os.path.join(d, f"{name}.parquet"),
                           compression="zstd")
        with open(os.path.join(d, "pokerstars.txt"), "w") as f:
            f.write(hh.hands_to_text(day_hands))

    if systems:
        path = os.path.join(out, "system_prompts.jsonl")
        known = {s["prompt_version"]: s for s in (_read_jsonl(path) if os.path.exists(path) else [])}
        known.update({s["prompt_version"]: s for s in systems})
        with open(path, "w") as f:
            f.writelines(json.dumps(s) + "\n" for _, s in sorted(known.items()))
    write_card(out)
    with open(os.path.join(out, EXPORTED), "w") as f:  # read by upload.py for its commit message
        f.write("\n".join(sorted(days)) + "\n")
    return sorted(days)


def _read_all(out, name, columns):
    files = sorted(glob.glob(os.path.join(out, "day=*", f"{name}.parquet")))
    return pa.concat_tables([pq.read_table(f, columns=columns) for f in files]).to_pylist() if files else []


def _schema_md(schema, notes):
    rows = ["| column | type | notes |", "|---|---|---|"]
    rows += [f"| `{f.name}` | `{f.type}` | {notes.get(f.name, '')} |" for f in schema]
    return "\n".join(rows)


HAND_NOTES = {
    "session": "table id; a new one starts each time the engine restarts, with stacks reset to 2000",
    "day": "America/New_York date the hand started; the live table plays during its configured hours",
    "prompt_version": "hash of the system prompt; text in `system_prompts.jsonl`",
    "memory": "what models are told about earlier hands; `none` = nothing",
    "button_seat": "0-based seat index",
    "deck": "full shuffled deck in deal order",
    "pot": "every chip put in (blinds and actions) less uncalled bets returned; computed from the actions, not `result.pots`, which can omit a side pot holding dead money",
    "showdown": "the hand reached showdown",
}
SEAT_NOTES = {
    "model": "model id sent to the provider; null when the seat made no decision in the hand",
    "stack_start": "chips at the start of the hand, blinds included",
    "hole_cards": "every seat's cards, folded hands too",
    "rebought": "topped back up to 2000 after going broke",
    "net": "chips won or lost on the hand; sums to zero per hand",
}
DECISION_NOTES = {
    "n": "1-based decision number within the hand",
    "street": "preflop, flop, turn or river",
    "pot_before": "pot before this decision, all streets",
    "to_call": "chips needed to call",
    "legal_actions": "what the model was offered; all-in is spelled `ALL_IN` (the engine's raw records say `ALL-IN`)",
    "parsed_action": "what we read from the reply (`RAISE` also means a first bet); all-in normalised to `ALL_IN`",
    "parsed_amount": "the reply's amount for `RAISE`/`BET`; null otherwise (the engine stores 0 when there was none)",
    "status": "`ok`, or why the applied action is a fallback: `unparseable`, `illegal`, `timeout`, `api_error`, `service_error`",
    "retried": "the first reply was unparseable or illegal and the model was asked once more",
    "applied_action": "what the engine did: FOLD, CHECK, CALL, BET, RAISE, ALL_IN",
    "applied_amount": "chips added for CALL; total bet this street for BET, RAISE, ALL_IN",
    "tokens_in": "null when the provider did not report it (also tokens_out, cost_usd)",
    "prompt": "exact user prompt the model was sent",
    "raw_reply": "raw model reply; a retried decision holds both replies separated by `--- retry ---`",
}


def write_card(out):
    hands = _read_all(out, "hands", ["hand_id", "day", "prompt_version", "provider"])
    seats = _read_all(out, "seats", ["day", "name", "model"])
    days = sorted({h["day"] for h in hands})
    first_last = {}
    for s in seats:
        if not s["model"]:
            continue  # the seat made no decision in that hand
        k = (s["name"], s["model"])
        lo, hi = first_last.get(k, (s["day"], s["day"]))
        first_last[k] = (min(lo, s["day"]), max(hi, s["day"]))
    lineup = "\n".join(f"| {n} | `{m}` | {lo} | {hi} |" for (n, m), (lo, hi) in sorted(first_last.items()))
    versions = defaultdict(lambda: [None, None, 0])
    for h in hands:
        v = versions[h["prompt_version"]]
        v[0] = min(v[0] or h["day"], h["day"])
        v[1] = max(v[1] or h["day"], h["day"])
        v[2] += 1
    version_rows = "\n".join(f"| `{k}` | {lo} | {hi} | {n} |" for k, (lo, hi, n) in sorted(versions.items()))
    span = f"{days[0]} to {days[-1]}" if days else "no days yet"

    card = f"""---
license: cc-by-4.0
pretty_name: No-LLMit LLM poker hands
tags: [poker, llm, games, decision-making]
configs:
- config_name: decisions
  default: true
  data_files: "day=*/decisions.parquet"
- config_name: hands
  data_files: "day=*/hands.parquet"
- config_name: seats
  data_files: "day=*/seats.parquet"
---

# No-LLMit: LLMs playing No Limit Hold'em

Every hand from the shared 9-handed cash game at https://nollmit.vercel.app/, where LLMs play each other.
Code: https://github.com/RizzwareEngineer/No-LLMit
{len(hands)} hands over {len(days)} days ({span}).
Each decision row holds the exact prompt the model saw and its raw reply.

## Read this before computing playing-style stats

**Exclude decisions with `status != "ok"` from style stats** (VPIP, PFR, aggression and so on).
Those actions are engine fallbacks (check if free, else fold), not the model's choice.
`net` and the hand results still include them, since the chips really moved.

Models have no memory between hands; each prompt retells the current hand, including the model's own earlier actions.
The prompt names opponents by model, so a model may carry priors about the others.

## Files

One directory per day, `day=YYYY-MM-DD/` (America/New_York date the hand started):

- `decisions.parquet`: one row per decision, joined with its prompt and raw reply.
- `hands.parquet`: one row per hand.
- `seats.parquet`: one row per seat dealt into a hand.
- `hands.jsonl`: the full hand records (same content as the engine saved; key order may differ).
- `pokerstars.txt`: PokerStars-format hand histories for PokerTracker, Hold'em Manager or Hand2Note.

`system_prompts.jsonl` at the top level holds each system prompt once, keyed by `prompt_version`.

Join `decisions` and `seats` to `hands` on `hand_id`; `seats` to `decisions` on (`hand_id`, `seat`).

The PokerStars files are full-information histories: every player's hole cards are dealt face up
(`Dealt to` for all seats), folded hands included. A tracker will treat each player as the hero;
import with that in mind. Hand numbers are `<table hex as integer> * 1000000 + hand_number`;
the table name is the session id. Showdown hands are shown without a hand description,
and side pots are not itemized: each winner's `collected` line is their total from all pots.

## Lineup

| name | model | first day | last day |
|---|---|---|---|
{lineup}

## Prompt versions

`prompt_version` hashes the system prompt only; the per-decision prompt template is in the engine
and can change without a new version.

| prompt_version | first day | last day | hands |
|---|---|---|---|
{version_rows}

## Schema

### decisions

{_schema_md(DECISIONS, DECISION_NOTES)}

### hands

{_schema_md(HANDS, HAND_NOTES)}

### seats

{_schema_md(SEATS, SEAT_NOTES)}

## License

CC BY 4.0. Model replies are the output of the listed models, used under their providers' terms.

## Citation

```bibtex
@misc{{nollmit_hands,
  title  = {{No-LLMit: LLMs playing No Limit Hold'em}},
  author = {{RizzwareEngineer}},
  year   = {{{date.today().year}}},
  url    = {{https://github.com/RizzwareEngineer/No-LLMit}},
  note   = {{Live table: https://nollmit.vercel.app/}}
}}
```
"""
    with open(os.path.join(out, "README.md"), "w") as f:
        f.write(card)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--out", required=True)
    ap.add_argument("--from-jsonl", nargs=2, metavar=("HANDS", "PROMPTS"))
    ap.add_argument("--day", help="YYYY-MM-DD or 'yesterday' (ET); Supabase only, default all hands")
    ap.add_argument("--back", type=int, default=0,
                    help="also re-export this many days before --day (late or replayed hands)")
    args = ap.parse_args(argv)

    if args.from_jsonl:
        hands, prompts, systems = load_jsonl(*args.from_jsonl)
    else:
        base, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_KEY")
        if not base or not key:
            sys.exit("Set SUPABASE_URL and SUPABASE_SERVICE_KEY, or pass --from-jsonl.")
        day = None
        if args.day == "yesterday":
            day = datetime.now(hh.ET).date() - timedelta(days=1)
        elif args.day:
            day = date.fromisoformat(args.day)
        hands, prompts, systems = load_supabase(base.rstrip("/"), key, day, args.back)
    days = export(hands, prompts, systems, args.out)
    print(f"{len(hands)} hands, {len(prompts)} prompts -> {args.out} ({', '.join(days) or 'no days'})")


if __name__ == "__main__":
    main()
