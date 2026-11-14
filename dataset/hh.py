"""PokerStars-format text hand histories from No-LLMit hand records.

Usage: python hh.py hands.jsonl > hands.txt   (one hand doc per line)

The output follows the PokerStars play-money cash game format closely enough for
PokerTracker, Hold'em Manager and Hand2Note to import it. Where it differs:

- Every player's hole cards appear as "Dealt to" lines (a full-information history).
- Hand numbers are <table hex as integer> * 1000000 + hand_number for a 6-digit table hex,
  and crc32(table id) * 1000000 + hand_number for longer ids; the table name is the session id.
- "shows [..]" lines carry no hand description.
- Side pots are not itemized: each winner gets one "collected N from pot" line with their total.
- Uncalled bets are derived from the actions, as PokerStars prints them.
- Before 2026-11-09 a short all-in could win unmatched chips; those hands follow the engine's
  payout and end with a "#note <hand_id>: ..." line.
- A hand that cannot be written is left out and named on stderr.
"""

import json
import sys
import zlib
from datetime import datetime
from zoneinfo import ZoneInfo

ET = ZoneInfo("America/New_York")
STREETS = ["preflop", "flop", "turn", "river"]
STREET_TITLE = {"flop": "Flop", "turn": "Turn", "river": "River"}


def stars_hand_number(hand: dict) -> int:
    """A numeric, stable hand number. PokerStars numbers are integers, our ids are
    tbl_<hex>-<hand number>. A 6-digit table hex becomes the high digits; longer ids (16 hex)
    and anything else use a 32-bit crc, so the result always fits a signed 64-bit integer."""
    suffix = hand["table_id"].removeprefix("tbl_")
    try:
        if len(suffix) > 6:
            raise ValueError
        table = int(suffix, 16)
    except ValueError:
        table = zlib.crc32(hand["table_id"].encode())
    return table * 1_000_000 + hand["hand_number"]


def _when(iso: str) -> str:
    t = datetime.fromisoformat(iso).astimezone(ET)
    return f"{t:%Y/%m/%d} {t.hour}:{t:%M:%S} ET"


def _cards(cards: list) -> str:
    return "[" + " ".join(cards) + "]"


def render(hand: dict) -> tuple:
    """(PokerStars text, total pot, note). The pot is every chip put in, less uncalled bets
    returned. note is set when the engine's payout differs from poker rules; the text then
    follows the engine, since that is how the chips actually moved."""
    seats = {s["seat"]: s for s in hand["seats"]}
    name = {s: v["name"] for s, v in seats.items()}
    pos = {s: v["position"] for s, v in seats.items()}
    cfg = hand["config"]
    board = hand["board"]
    out = [
        f"PokerStars Hand #{stars_hand_number(hand)}:  Hold'em No Limit "
        f"({cfg['small_blind']}/{cfg['big_blind']}) - {_when(hand['started_at'])}",
        f"Table '{hand['table_id']}' 9-max (Play Money) Seat #{hand['button_seat'] + 1} is the button",
    ]
    for s in sorted(seats):
        out.append(f"Seat {s + 1}: {name[s]} ({seats[s]['stack_start']} in chips)")

    contrib = {s: 0 for s in seats}  # chips put in over the whole hand
    street_in = {s: 0 for s in seats}  # chips put in on the current street
    stack = {s: seats[s]["stack_start"] for s in seats}
    folded_on = {}
    returned = {}
    uncalled_lines = []

    def put(s, chips):
        contrib[s] += chips
        street_in[s] += chips
        stack[s] -= chips

    for b in sorted(hand["blinds"], key=lambda b: pos[b["seat"]] != "SB"):
        kind = "small" if pos[b["seat"]] == "SB" else "big"
        put(b["seat"], b["amount"])
        allin = " and is all-in" if stack[b["seat"]] == 0 else ""
        out.append(f"{name[b['seat']]}: posts {kind} blind {b['amount']}{allin}")

    out.append("*** HOLE CARDS ***")
    for s in sorted(seats):
        out.append(f"Dealt to {name[s]} {_cards(seats[s]['hole_cards'])}")

    def return_uncalled():
        # A bet nobody matched goes back to the bettor before the next street.
        top, second = sorted(street_in.values(), reverse=True)[:2]
        if top > second:
            s = next(s for s, v in street_in.items() if v == top)
            put(s, second - top)
            returned[s] = returned.get(s, 0) + top - second
            uncalled_lines.append(len(out))
            out.append(f"Uncalled bet ({top - second}) returned to {name[s]}")

    by_street = {st: [a for a in hand["actions"] if a["street"] == st] for st in STREETS}
    showdown = hand["result"]["showdown"]
    for i, st in enumerate(STREETS):
        if i:
            shown = 2 + i  # cards on the board from this street on
            if len(board) < shown:
                break
            if not by_street[st] and not showdown:
                break
            street_in = {s: 0 for s in seats}
            prev = f"{_cards(board[:shown - 1])} " if i > 1 else ""
            out.append(f"*** {st.upper()} *** {prev}{_cards(board[shown - 1:shown] if i > 1 else board[:3])}")
        for a in by_street[st]:
            out.append(_action_line(a, name[a["seat"]], street_in, put, stack))
            if a["applied"]["type"] == "FOLD":
                folded_on[a["seat"]] = st
        return_uncalled()

    # What each seat took from the pot follows from its net result and what it put in.
    net = {int(k): v for k, v in hand["result"]["net"].items()}
    note = None
    collected = {s: net.get(s, 0) + contrib[s] for s in seats if net.get(s, 0) + contrib[s] > 0}
    if sum(collected.values()) != sum(contrib.values()):
        # The engine pays a short all-in that everyone folded to the whole pot, unmatched
        # chips included, instead of returning them. Follow the engine.
        for i in reversed(uncalled_lines):
            del out[i]
        for s, chips in returned.items():
            contrib[s] += chips
        collected = {s: net.get(s, 0) + contrib[s] for s in seats if net.get(s, 0) + contrib[s] > 0}
        note = (f"engine payout: uncalled chips ({sum(returned.values())}) were not returned; "
                f"collected amounts follow the engine")
        if sum(collected.values()) != sum(contrib.values()):
            note = f"net results do not balance: collected {sum(collected.values())}, put in {sum(contrib.values())}"
    total = sum(contrib.values())

    if showdown:
        out.append("*** SHOW DOWN ***")
        for sd in showdown:
            out.append(f"{name[sd['seat']]}: shows {_cards(sd['hole_cards'])}")
    for s in sorted(collected, key=lambda s: -collected[s]):
        out.append(f"{name[s]} collected {collected[s]} from pot")
    if not showdown:
        for s in collected:
            out.append(f"{name[s]}: doesn't show hand")

    out.append("*** SUMMARY ***")
    out.append(f"Total pot {total} | Rake 0")
    if board:
        out.append(f"Board {_cards(board)}")
    shown = {sd["seat"] for sd in showdown}
    for s in sorted(seats):
        tag = {"BTN": " (button)", "SB": " (small blind)", "BB": " (big blind)"}.get(pos[s], "")
        if s == hand["button_seat"] and pos[s] != "BTN":
            tag = " (button)" + tag
        line = f"Seat {s + 1}: {name[s]}{tag} "
        if s in folded_on:
            st = folded_on[s]
            line += "folded before Flop" if st == "preflop" else f"folded on the {STREET_TITLE[st]}"
            if contrib[s] == 0:
                line += " (didn't bet)"
        elif s in shown:
            hole = _cards(seats[s]["hole_cards"])
            line += f"showed {hole} and won ({collected[s]})" if s in collected else f"showed {hole} and lost"
        elif s in collected:
            line += f"collected ({collected[s]})"
        else:
            line += "mucked"
        out.append(line)
    if note:
        out.append(f"#note {hand['hand_id']}: {note}")
    return "\n".join(out), total, note


def _action_line(a: dict, who: str, street_in: dict, put, stack: dict) -> str:
    s = a["seat"]
    kind = a["applied"]["type"]
    amount = a["applied"].get("amount", 0)
    current = a["to_call"] + street_in[s]  # the bet this player faced
    if kind == "FOLD":
        return f"{who}: folds"
    if kind == "CHECK":
        return f"{who}: checks"
    if kind == "CALL":
        put(s, amount)
        allin = " and is all-in" if stack[s] == 0 else ""
        return f"{who}: calls {amount}{allin}"
    if kind in ("BET", "RAISE", "ALL_IN"):
        before = street_in[s]
        put(s, amount - before)  # amount is the player's total bet this street
        allin = " and is all-in" if kind == "ALL_IN" or stack[s] == 0 else ""
        if amount <= current:
            return f"{who}: calls {amount - before}{allin}"
        if current == 0:
            return f"{who}: bets {amount}{allin}"
        return f"{who}: raises {amount - current} to {amount}{allin}"
    raise ValueError(f"{a['prompt_id']}: unknown applied action {kind!r}")


def hands_to_text(hands: list) -> str:
    """One PokerStars file: hands in start order, separated by blank lines. Never raises on a
    hand: one that cannot be written is left out and reported on stderr."""
    texts, noted, skipped = [], 0, []
    for h in sorted(hands, key=start_order):
        try:
            text, _, note = render(h)
        except Exception as e:  # noqa: BLE001 - one bad hand must not stop the day's file
            skipped.append(f"{h.get('hand_id')}: {e!r}")
            continue
        noted += bool(note)
        texts.append(text)
    if noted:
        print(f"pokerstars: {noted} hand(s) carry a #note (engine payout differs from poker rules)", file=sys.stderr)
    for s in skipped:
        print(f"pokerstars: left out {s}", file=sys.stderr)
    return "\n\n\n".join(texts) + "\n\n\n" if texts else ""


def start_order(hand: dict):
    # Go trims trailing zeros in timestamps, so compare times, not strings.
    return datetime.fromisoformat(hand["started_at"]), hand["table_id"], hand["hand_number"]


if __name__ == "__main__":
    with open(sys.argv[1]) as f:
        sys.stdout.write(hands_to_text([json.loads(line) for line in f if line.strip()]))
