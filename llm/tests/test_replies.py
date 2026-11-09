"""Replies through the whole turn. The contract: a reply is read as the move it states or
as a miss that gets the one retry, never as a different move, and the service never
answers 500 for one. The format is held strictly (three reviews on 2026-11-09 each found
looser parsers playing moves the model did not make); only dress is forgiven."""
import random
import time

import pytest
from fastapi.testclient import TestClient

import app
import decide
import parsing
from conftest import short_raise_request, short_stack_request, turn_check_request, turn_request, with_
from providers import mock

CALL = "ACTION: call\nAMOUNT: 0\nREASON: Odds."
CHECK = "ACTION: check\nAMOUNT: 0\nREASON: Free card."
FACING = turn_request()  # fold, call 100, raise to 200–1,130, raise all-in 1,130
OPEN = turn_check_request()  # fold, check, bet 10–1,930, bet all-in 1,930
COVERED = short_stack_request()  # fold, call all-in 60


def said(*replies, finish_reason="stop"):
    calls = []

    def complete(request, messages, timeout):
        calls.append(list(messages))
        return {"raw": replies[len(calls) - 1], "model": "m", "usage": {}, "finish_reason": finish_reason}

    complete.calls = calls
    return complete


def play(request, reply, **kw):
    """(action, amount) when the reply was played as given; fails if it needed the retry."""
    out = decide.decide(request, said(reply, **kw))
    assert (out["status"], out["retried"]) == ("ok", False), f"{reply!r}: {out['status']}, {out['retry_prompt']}"
    return out["action"], out["amount"]


def missed(request, reply, why, **kw):
    """The reply is a miss with `why` in the retry message, and the retry's reply is then played."""
    out = decide.decide(request, said(reply, CHECK if request is OPEN else CALL, **kw))
    assert out["retried"], f"{reply!r} was played as {out['action']} {out['amount']}"
    assert why in out["retry_prompt"], out["retry_prompt"]
    assert (out["action"], out["status"]) == ("CHECK" if request is OPEN else "CALL", "ok")


# --- The format, in any dress

@pytest.mark.parametrize("reply", [
    "ACTION: raise\nAMOUNT: 300\nREASON: Value.",
    "action: raise\namount: 300\nreason: value",
    "**ACTION:** raise\n**AMOUNT:** 300\n**REASON:** Value.",
    "```\nACTION: `RAISE`\n- AMOUNT: 300\n* REASON: _Value_ bet.\n```",
    "1. ACTION: raise\n2. AMOUNT: 300\n3. REASON: value",
    "> ACTION: raise\n> AMOUNT: 300",
    "ACTION : raise\r\nAMOUNT : 300\r\nREASON : value\r\n",
    "ACTION: raise | AMOUNT: 300 | REASON: Value.",
    "ACTION: raise, AMOUNT: 300, REASON: value",
    "{ACTION: raise, AMOUNT: 300, REASON: value}",
    "ACTION: raise<br>AMOUNT: 300<br>REASON: Value.",
    "ACTION: raise,\nAMOUNT: 300,\nREASON: value",
    "ACTION:\nraise\nAMOUNT:\n300\nREASON:\nValue.",
    "ACTION: \"raise\"\nAMOUNT: \"300\"",
    "Let me think. He bets small, so a raise for value is right.\n\nACTION: raise\nAMOUNT: 300\nREASON: Value.\n\nGood luck!",
    "ACTION: raise\nAMOUNT: 300 | REASON: Value.",
    "REASON: Value.\nAMOUNT: 300\nACTION: raise",
    "AMOUNT: 300\nACTION: raise\nREASON: value",
    "ACTION: raise \u2014 AMOUNT: 300 \u2014 REASON: fold equity",
    "\U0001f525 ACTION: raise \U0001f525\nAMOUNT: 300 \U0001f4b0\nREASON: Value.",
    "ACTION:\u00a0raise\u200b\nAMOUNT:\u00a0300\x00\nREASON:\u00a0Odds.",
    "\ufeffACTION: raise\u3002\nAMOUNT: 300\u3002",
])
def test_the_three_fields_in_any_dress(reply):
    assert play(FACING, reply) == ("RAISE", 300)


def test_the_reason_is_kept_whole():
    out = decide.decide(FACING, said("ACTION: call\nAMOUNT: 0\nREASON: His likely reaction: fold to more pressure,\nso I keep the pot small.\n\nThanks."))
    assert out["reason"] == "His likely reaction: fold to more pressure,\nso I keep the pot small."
    assert decide.decide(FACING, said("ACTION: fold | AMOUNT: 0 | REASON: Not calling a raise with K4."))["reason"] == "Not calling a raise with K4."
    assert decide.decide(FACING, said("ACTION: call"))["reason"] == ""  # never words in the model's mouth


# --- The ACTION line is only the move

@pytest.mark.parametrize("line,want", [
    ("call", ("CALL", 0)), ("Call.", ("CALL", 0)), ("CALL!", ("CALL", 0)), ("call 100", ("CALL", 0)), ("call the all-in", ("CALL", 0)),
    ("call all-in", ("CALL", 0)), ("fold", ("FOLD", 0)), ("Fold.", ("FOLD", 0)),
    ("raise to 300", ("RAISE", 300)), ("raise 300", ("RAISE", 300)), ("RAISE: 300", ("RAISE", 300)), ("raise to $300", ("RAISE", 300)),
    ("raise to 300 chips", ("RAISE", 300)), ("raise to 300 (3x)", ("RAISE", 300)), ("bet 300", ("RAISE", 300)),
    ("all-in", ("ALL_IN", 0)), ("all in", ("ALL_IN", 0)), ("ALL_IN", ("ALL_IN", 0)), ("allin", ("ALL_IN", 0)), ("ALLIN!!", ("ALL_IN", 0)),
    ("all‑in", ("ALL_IN", 0)), ("all–in", ("ALL_IN", 0)), ("all in", ("ALL_IN", 0)),
    ("raise all-in", ("ALL_IN", 0)), ("bet all in 1,130", ("ALL_IN", 0)), ("go all-in", ("ALL_IN", 0)), ("going all in", ("ALL_IN", 0)),
    ("raise to all-in", ("ALL_IN", 0)), ("raise (all-in)", ("ALL_IN", 0)), ("all-in for 1,130 chips", ("ALL_IN", 0)), ("all in (1,130)", ("ALL_IN", 0)),
])
def test_a_move_and_its_wordings(line, want):
    assert play(FACING, f"ACTION: {line}\nREASON: x") == want


@pytest.mark.parametrize("line", [
    # another word for it
    "calling", "Calling 100", "calls", "shove", "jam", "re-raise to 300", "I call", "check/fold",
    # the move, then words
    "call in position", "call instantly", "call the raise", "fold to his bet", "Fold, calling is too loose here",
    "call (not all-in)", "fold (not calling an all-in with this)", "all-in for value", "all-in, he is capped",
    # the move, then a different one
    "call would be too loose here, so I fold.", "all in all, calling is fine", "all-in call", "Fold? No. Call.",
    "fold, check, call, bet, raise or all-in", "check or bet small", "raise to 300 is tempting, but I will just call.",
    "call - actually all-in", "call, or rather shove", "call, no wait, folding", "call? no.", "call (no)",
    "Call it a bluff catch; I'm folding", "fold... actually calling", "Fold equity makes this a shove",
    # a size that is not one number of chips right after the word
    "raise 200 more", "raise +200", "raise -300", "raise 300k", "bet 50 percent of the pot", "bet 12 times the big blind",
    "raise to 200–1,130", "raise (min 200) to 300",
    # far too long to be a move
    "call because " + "the pot odds are 3.5 to 1 and his range is polar, " * 7 + "so in the end I fold.",
])
def test_anything_else_on_the_action_line_is_a_miss(line):
    missed(FACING, f"ACTION: {line}\nAMOUNT: 300\nREASON: x", "the ACTION line must be only the move")


def test_call_all_in_is_the_all_in_only_when_the_bet_covers_the_stack():
    covered = with_(COVERED, legal_actions=[{"type": "FOLD"}, {"type": "ALL-IN", "amount": 65}])
    assert play(covered, "ACTION: call all-in\nAMOUNT: 60") == ("ALL_IN", 60)
    assert play(covered, "ACTION: call")[0] == "ALL_IN"
    assert play(COVERED, "ACTION: call all-in\nAMOUNT: 60")[0] in ("CALL", "ALL_IN")  # the engine lists CALL too
    assert play(FACING, "ACTION: call the all-in\nAMOUNT: 100") == ("CALL", 100)  # calling someone else's all-in
    no_raise = with_(FACING, legal_actions=[{"type": "FOLD"}, {"type": "CALL", "amount": 100}])
    assert play(no_raise, "ACTION: call all-in")[0] == "CALL"


# --- One answer, and labels only at the start of a line

@pytest.mark.parametrize("request_,reply,want", [
    (FACING, "ACTION: fold\nAMOUNT: 0\nREASON: Facing this action: raise to 300 from a tight player, my hand is too weak.", ("FOLD", 0)),
    (FACING, "ACTION: call\nAMOUNT: 0\nREASON: Odds.\nALTERNATIVE ACTION: raise to 300", ("CALL", 0)),
    (FACING, "ACTION: fold\nAMOUNT: 0\nREASON: Weak.\n\nPlayer 1 (SB): ACTION: raise to 400", ("FOLD", 0)),
    (OPEN, "ACTION: check\nAMOUNT: 0\nREASON: Pot control after the flop action: bet 40, call.", ("CHECK", 0)),
    (FACING, "ACTION: fold\nAMOUNT: 0\nREASON: Q-high cannot continue.\n\nSummary:\n- Villain action: all-in\n- My equity: about 20%", ("FOLD", 0)),
    (COVERED, "ACTION: fold\nAMOUNT: 0\nREASON: Q-high cannot continue.\n\nSummary:\n- Villain action: all-in", ("FOLD", 0)),
    (FACING, "ACTION: raise\nAMOUNT: 300\nREASON: Value. If he shoves, next action: fold.", ("RAISE", 300)),
    (FACING, "ACTION: raise to 300\nREASON: The call amount: 250 is poor value, so I raise instead.", ("RAISE", 300)),
    (FACING, "Thinking: ACTION: CALL would be fine but I prefer pressure.\n\nACTION: RAISE\nAMOUNT: 300\nREASON: Take it down now.", ("RAISE", 300)),
    (FACING, "ACTION: call\nAMOUNT: 0\nREASON: Odds.\n\nSo, to repeat:\nACTION: call", ("CALL", 0)),
])
def test_a_label_counts_only_at_the_start_of_a_line(request_, reply, want):
    assert play(request_, reply) == want


@pytest.mark.parametrize("request_,reply", [
    (FACING, "ACTION: raise\nAMOUNT: 600\nREASON: Big.\n\nOn reflection that is too much.\nACTION: raise to 250"),  # a draft
    (FACING, "ACTION: fold\nAMOUNT: 0\nREASON: Considered alternatives.\n- Action: call (too loose)"),  # a note
    (FACING, "ACTION: fold\nAMOUNT: 0\nREASON: Weak.\n> ACTION: call\n> (what a looser player would do)"),  # a quote
    (OPEN, "ACTION: check\nAMOUNT: 0\nREASON: Pot control.\n\nIf he bets 100:\nACTION: call\nAMOUNT: 0"),  # a plan
    (FACING, "ACTION: raise\nAMOUNT: 300\nREASON: Value.\n\nIf he shoves:\nACTION: fold"),
    (FACING, "ACTION: call\nAMOUNT: 0\nREASON: Odds.\n\nPlayer 1 (SB) checks the river.\nACTION: bet\nAMOUNT: 200"),  # the hand, continued
    (FACING, "ACTION: call\nAMOUNT: 0\nREASON: Odds.\n\nExample of a bad reply:\nACTION: raise to 300"),
    (FACING, "ACTION: call\nAMOUNT: 0\n\nPrevious streets:\n- ACTION: raise 30 (me, preflop)\n- ACTION: call 40 (me, flop)"),
])
def test_two_action_lines_that_differ_are_a_miss(request_, reply):
    missed(request_, reply, "the reply must hold one ACTION line")


# --- Sizes

@pytest.mark.parametrize("amount,chips", [
    ("300", 300), ("$1,130", 1130), ("raise to 300", 300), ("300 chips", 300), ("300 total", 300), ("300.", 300),
    ("300.00", 300), ("300 (3x)", 300), ("300 (30 BB)", 300), ("300,", 300), ("(300)", 300), ("~300", 300), ("300 \U0001f4b0", 300),
])
def test_a_plain_size_is_read(amount, chips):
    assert play(FACING, f"ACTION: raise\nAMOUNT: {amount}\nREASON: Value.") == ("RAISE", chips)


@pytest.mark.parametrize("amount", [
    "30 BB", "30bb", "30 big blinds", "12.5 BB", "22.5BB", "12 BBs", "12bbs", "15 big-blinds", "30 blinds", "3x", "12×BB = 120",
    "75% pot, 130", "2.5x = 250", "2*60 = 120", "2*60", "170 * 0.7 = 119", "pot is 170, so 113 (two thirds)", "half pot (85)",
    "112,5", "1 200", "20.000", "200 more, 300 total", "200 more", "+200", "-300", "\u2212300", "300k", "300 USD", "about 300", "300 (3x the bet)",
    "120 " * 80,
])
def test_a_size_that_is_not_one_number_of_chips_is_a_miss(amount):
    missed(OPEN, f"ACTION: bet\nAMOUNT: {amount}\nREASON: Value.", "AMOUNT must be")


def test_two_sizes_must_agree():
    assert play(FACING, "ACTION: raise to 300\nAMOUNT: 300") == ("RAISE", 300)
    missed(FACING, "ACTION: raise to 300\nAMOUNT: 200\nREASON: That is 200 more than his bet.", "two different sizes")
    missed(FACING, "ACTION: raise\nAMOUNT: 300\nAMOUNT: 400", "two different sizes")
    missed(FACING, "ACTION: raise to 300\nAMOUNT: all-in", "two different sizes")


def test_a_bet_needs_a_size():
    missed(FACING, "ACTION: raise\nREASON: The amount: 300 gives him 2 to 1.", "needs its size on the AMOUNT line")
    assert play(FACING, "ACTION: raise\nAMOUNT: all-in\nREASON: Max pressure.")[0] == "ALL_IN"
    assert play(FACING, "ACTION: raise\nAMOUNT: all-in (1,130)")[0] == "ALL_IN"


@pytest.mark.parametrize("amount", ["n/a, just calling", "none, I am calling", "-, not a raise", "zero, nothing to add", "10 BB", ""])
def test_a_call_has_no_size_to_get_wrong(amount):
    assert play(FACING, f"ACTION: call\nAMOUNT: {amount}\nREASON: Odds.")[0] == "CALL"


def test_an_absurd_number_fits_the_engine():
    assert play(FACING, "ACTION: call\nAMOUNT: 99999999999999999999999") == ("CALL", parsing.MAX_AMOUNT)
    missed(FACING, "ACTION: raise\nAMOUNT: 99999999999999999999999", "above the maximum")


# --- Without labels

def test_a_bare_move_is_an_answer_only_alone():
    assert play(FACING, "Call") == ("CALL", 0)
    assert play(FACING, "RAISE: 300") == ("RAISE", 300)
    assert play(FACING, "all in\n") == ("ALL_IN", 0)
    assert play(FACING, "Call 100\nREASON: Odds.") == ("CALL", 0)
    for reply in ["Call. The pot odds are good.", "Fold - too weak to continue.", "Call.\n\nActually no, fold.", "Fold?\nNo - call.",
                  "RAISE: 300\nValue.", "Call\n\nFolding would be a mistake at these odds.", "Folding is too weak here, so I call.",
                  "Options:\n- Fold: too tight\n- Call: good odds\n\nI call.", "All-in would be reckless here.\nI fold.",
                  "Checking the pot odds first.\nI bet 120.", "Call me crazy but I am folding.", "", "   \n\n", "?!"]:
        missed(FACING, reply, "no ACTION line was found")


# --- Cut off, too long, broken

def test_a_cut_off_reply_must_end_with_its_reason():
    for reply in ["Let me think it through. ACTION: fold would be too weak with top pair, so the better line is to raise to",
                  "ACTION: bet\nAMOUNT: 12", "REASON: Value bet.\nACTION: bet\nAMOUNT: 12", "ACTION: bet\nREASON: Value against worse.\nAMOUNT: 12",
                  "ACTION: bet | REASON: Value.\nAMOUNT: 12"]:
        missed(OPEN, reply, "the reply was cut off before it finished", finish_reason="length")
    whole = "ACTION: bet\nAMOUNT: 120\nREASON: Value, and the rest of this sentence was cu"
    assert play(OPEN, whole, finish_reason="length") == ("RAISE", 120)
    assert play(OPEN, "REASON: Value bet.\nACTION: bet\nAMOUNT: 12") == ("RAISE", 12)  # not cut off: a lone answer may follow its reason


def test_a_reply_too_long_to_be_three_lines_is_a_miss():
    filler = "The pot odds matter here. " * 800
    missed(OPEN, filler + "\nACTION: bet\nAMOUNT: 120\nREASON: Two thirds of the pot.", "the reply must be three short lines")


def test_the_service_never_answers_500_for_a_reply(tmp_path, monkeypatch):
    monkeypatch.setattr(app, "DECISION_LOG", tmp_path / "decisions.jsonl")
    monkeypatch.setattr(app, "complete", said("Call, the price is right.", CALL))
    res = TestClient(app.app, raise_server_exceptions=False).post("/decide", json=FACING.model_dump())
    assert (res.status_code, res.json()["status"], res.json()["retried"]) == (200, "ok", True)
    # A bug in the parser is ours: no 500, no retry, not the model's miss, and the paid reply is still logged.
    monkeypatch.setattr(app, "complete", said(CALL))
    monkeypatch.setattr(decide, "parse_response", lambda text: 1 / 0)
    res = TestClient(app.app, raise_server_exceptions=False).post("/decide", json=FACING.model_dump())
    assert (res.status_code, res.json()["status"], res.json()["retried"]) == (200, "service_error", False)
    assert (tmp_path / "decisions.jsonl").read_text().count("\n") == 2


def test_no_reply_makes_the_parser_slow():
    replies = ["ACTION: call" + " " * 19_000, "ACTION: call" + "\t" * 19_000 + "x", "\n" * 19_000, "call" + " " * 19_000 + "x",
               "ACTION: raise\nAMOUNT: " + "9" * 19_000, "ACTION: " + "(" * 19_000, "- " * 9_000, "ACTION: call " + "!- " * 6_000,
               "ACTION:" * 2_800, "REASON:" * 2_800, "*" * 19_000, "\r\n" * 9_000, "ACTION: raise to " + "1," * 140,
               "ACTION: all in" + " for" * 70, "AMOUNT: " + "(1,130) " * 30 + "\nACTION: raise", "x" * 100_000]
    for reply in replies:
        start = time.perf_counter()
        parsing.parse_response(reply)
        assert time.perf_counter() - start < 0.1, reply[:30]


# --- The retry message is true, and the mock is legal

def test_retry_messages_say_what_was_wrong():
    missed(COVERED, "ACTION: check", "there is 60 to call, so check is not legal")  # not the 195 it cannot call
    missed(OPEN, "ACTION: call", "there is nothing to call")
    missed(short_raise_request(), "ACTION: raise\nAMOUNT: 200", "the only raise here is all-in 150")
    missed(FACING, "ACTION: raise\nAMOUNT: 150", "raise to 150 is below the minimum 200")


@pytest.mark.parametrize("request_", [FACING, OPEN, COVERED, short_raise_request(),
                                      with_(FACING, legal_actions=[{"type": "FOLD"}, {"type": "CALL", "amount": 100}])])
def test_mock_only_picks_legal_actions(request_):
    random.seed(1)
    outs = [decide.decide(request_, mock.complete) for _ in range(400)]
    assert not [o for o in outs if o["retried"] or o["status"] != "ok"]
