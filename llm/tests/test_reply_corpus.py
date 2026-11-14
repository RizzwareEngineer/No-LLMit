"""The parser's contract, over 1,935 replies written to break it and five legal sets
(9,675 decisions): no reply is ever played, with status ok, as a move other than the one
its author meant; nothing raises; and a well-formed three-line reply in ordinary dress is
always read. A reply the parser will not read is a miss with a retry, which is allowed."""
import decide
from conftest import short_raise_request, short_stack_request, turn_check_request, turn_request, with_
from reply_corpus.second_round import CORPUS
from reply_corpus.third_round import CORPUS3
from reply_corpus.well_formed import CORPUS4

SETS = {
    "facing a bet": turn_request(),  # fold, call 100, raise to 200–1,130, raise all-in 1,130
    "nothing to call": turn_check_request(),  # fold, check, bet 10–1,930, bet all-in 1,930
    "covered": short_stack_request(),  # fold, call all-in 60
    "no raise": with_(turn_request(), legal_actions=[{"type": "FOLD"}, {"type": "CALL", "amount": 100}]),
    "only the all-in raise": short_raise_request(),  # fold, call 100, all-in 150
}
ALL_IN = {"facing a bet": 1130, "nothing to call": 1930, "covered": 65, "only the all-in raise": 150}
LEGAL = {"facing a bet": "FCRA", "nothing to call": "FXRA", "covered": "FCA", "no raise": "FC", "only the all-in raise": "FCA"}
SIZES = {"facing a bet": (200, 1130), "nothing to call": (10, 1930)}
# Annotated as a shove, but the reply says "raise 1,130", and where 1,130 is not the whole
# stack that is the move to play.
SAYS_RAISE_1130 = {"ACTION: raise\nAMOUNT: 1,130\nREASON: Shove.", "ACTION: raise\nAMOUNT: 1130 (all-in)\nREASON: Shove.",
                   "ACTION: raise\nAMOUNT: 1,130 (all-in)\nREASON: Shove."}


def meant(intent, name):
    """The move the author meant, as the engine would play it in that set; None when it is not legal there."""
    if intent == "N":
        return None
    if not isinstance(intent, str):
        n = intent[1]
        if name in SIZES and SIZES[name][0] <= n <= SIZES[name][1]:
            return ("ALL_IN",) if n == ALL_IN[name] else ("RAISE", n)
        return ("ALL_IN",) if name == "only the all-in raise" and n == 150 else None
    if intent == "A":
        return ("ALL_IN",) if "A" in LEGAL[name] else None
    if intent == "C":
        return ("ALL_IN",) if name == "covered" else ("CALL",) if "C" in LEGAL[name] else None
    if intent == "X":
        return ("CHECK",) if "X" in LEGAL[name] else None
    return ("FOLD",)


def play(request, reply, name):
    """The move played for the first reply with status ok, or None when it was a miss."""
    calls = []

    def complete(r, messages, timeout):
        calls.append(1)
        return {"raw": reply if len(calls) == 1 else "(no answer)", "model": "m", "usage": {}, "finish_reason": "stop"}

    out = decide.decide(request, complete)
    if out["status"] != "ok" or out["retried"]:
        return None
    if out["action"] == "RAISE":
        return ("ALL_IN",) if out["amount"] == ALL_IN.get(name) else ("RAISE", out["amount"])
    return ("ALL_IN",) if out["action"] == "CALL" and name == "covered" else (out["action"],)


def test_no_reply_is_played_as_another_move():
    wrong = []
    for _, reply, intent in CORPUS + CORPUS3 + CORPUS4:
        for name, request in SETS.items():
            got = play(request, reply, name)
            if got is not None and got != meant(intent, name) and not (reply in SAYS_RAISE_1130 and name == "nothing to call"):
                wrong.append((reply, name, got))
    assert not wrong, f"{len(wrong)} played as another move, e.g. {wrong[:3]}"


def test_a_well_formed_reply_is_always_read():
    unread = [(reply, name) for style, reply, intent in CORPUS4 if style == "ord" for name, request in SETS.items()
              if meant(intent, name) is not None and play(request, reply, name) != meant(intent, name)]
    assert not unread, f"{len(unread)} well-formed replies not read, e.g. {unread[:3]}"
