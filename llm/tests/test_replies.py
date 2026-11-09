"""Sloppy replies through the whole turn: each is read as the move it states or as a miss
that gets the retry, never as a different move. (Found by the 2026-11-09 review.)"""
import random

import pytest
from fastapi.testclient import TestClient

import app
import decide
import parsing
from conftest import short_stack_request, turn_check_request, turn_request, with_
from providers import mock

CALL = "ACTION: call\nAMOUNT: 0\nREASON: Odds."


def said(*replies, finish_reason="stop"):
    calls = []

    def complete(request, messages, timeout):
        calls.append(list(messages))
        return {"raw": replies[len(calls) - 1], "model": "m", "usage": {}, "finish_reason": finish_reason}

    complete.calls = calls
    return complete


def play(request, *replies, **kw):
    out = decide.decide(request, said(*replies, **kw))
    return out["action"], out["amount"], out["status"], out["retried"]


def no_raise_request():
    """Facing a 100 all-in with nobody left to respond: fold or call."""
    return with_(turn_request(), legal_actions=[{"type": "FOLD"}, {"type": "CALL", "amount": 100}])


# turn_request(): fold, call 100, raise to 200–1,130, raise all-in 1,130.
@pytest.mark.parametrize("line", ["call (not all-in)", "call the all-in", "call in position", "call instantly", "Call."])
def test_a_call_is_never_a_shove(line):
    assert play(turn_request(), f"ACTION: {line}\nAMOUNT: 0\nREASON: Odds.") == ("CALL", 0, "ok", False)
    assert play(no_raise_request(), f"ACTION: {line}\nAMOUNT: 0\nREASON: Odds.") == ("CALL", 0, "ok", False)


@pytest.mark.parametrize("line", ["calling", "Calling 100", "calls", "shove", "re-raise to 300", "I call"])
def test_other_words_are_a_miss_with_a_true_message(line):
    out = decide.decide(turn_request(), said(f"ACTION: {line}\nAMOUNT: 0\nREASON: x", CALL))
    assert (out["action"], out["status"], out["retried"]) == ("CALL", "ok", True)
    assert "the ACTION line did not say fold, check, call, bet, raise or all-in" in out["retry_prompt"]


@pytest.mark.parametrize("reply", [
    "ACTION: fold (not calling an all-in with this)\nAMOUNT: 0\nREASON: Too weak.",
    "ACTION: fold AMOUNT: 0 REASON: I can't call an all-in with Q-high.",
    "ACTION: fold. AMOUNT: 0. REASON: no all in call here.",
    "ACTION: fold | AMOUNT: 0 | REASON: Not calling a raise with K4 offsuit.",
    "ACTION: Fold, calling is too loose here\nAMOUNT: 0",
])
def test_a_fold_stays_a_fold(reply):
    assert play(short_stack_request(), reply)[::2] == ("FOLD", "ok")  # legal: fold, call all-in 60


def test_one_line_reply_keeps_its_fields():
    out = decide.decide(turn_request(), said("ACTION: raise | AMOUNT: 300 | REASON: Value."))
    assert (out["action"], out["amount"], out["reason"], out["status"]) == ("RAISE", 300, "Value.", "ok")


def test_call_all_in_is_the_all_in_only_when_the_bet_covers_the_stack():
    covered = with_(short_stack_request(), legal_actions=[{"type": "FOLD"}, {"type": "ALL-IN", "amount": 65}])
    assert play(covered, "ACTION: call all-in\nAMOUNT: 60")[::2] == ("ALL_IN", "ok")
    assert play(short_stack_request(), "ACTION: call all-in\nAMOUNT: 60")[2] == "ok"  # the engine lists CALL too
    assert play(turn_request(), "ACTION: call all-in\nAMOUNT: 100")[::2] == ("CALL", "ok")  # calling someone's all-in


@pytest.mark.parametrize("line", ["all-in", "all in", "ALL_IN", "allin", "all‑in", "all–in", "all in", "raise all-in", "bet all in 1,130"])
def test_all_in_spellings(line):
    assert play(turn_request(), f"ACTION: {line}\nAMOUNT: 0")[::2] == ("ALL_IN", "ok")


@pytest.mark.parametrize("amount", ["n/a, just calling", "none, I am calling", "-, not a raise", "zero, nothing to add"])
def test_amount_line_without_a_number(amount):
    assert play(turn_request(), f"ACTION: call\nAMOUNT: {amount}\nREASON: Odds.") == ("CALL", 0, "ok", False)


def test_the_service_never_answers_500_for_a_reply(tmp_path, monkeypatch):
    monkeypatch.setattr(app, "DECISION_LOG", tmp_path / "decisions.jsonl")
    monkeypatch.setattr(app, "complete", said("Call, the price is right.", CALL))
    res = TestClient(app.app, raise_server_exceptions=False).post("/decide", json=turn_request().model_dump())
    assert (res.status_code, res.json()["status"], res.json()["retried"]) == (200, "ok", True)
    # Even a parser bug is the reply's miss (one retry), and the paid reply is still logged.
    monkeypatch.setattr(app, "complete", said("ACTION: call", "ACTION: call"))
    monkeypatch.setattr(decide, "parse_response", lambda text: 1 / 0)
    res = TestClient(app.app, raise_server_exceptions=False).post("/decide", json=turn_request().model_dump())
    assert (res.status_code, res.json()["status"]) == (200, "unparseable")
    assert (tmp_path / "decisions.jsonl").read_text().count("\n") == 2


@pytest.mark.parametrize("reply", [
    "Folding is too weak here, so I call.",
    "Options:\n- Fold: too tight\n- Call: good odds\n- Raise: too thin\n\nI call.",
    "All-in would be reckless here.\nI fold.",
    "Checking the pot odds first: 170 in the middle.\nI bet 120.",
])
def test_prose_is_not_an_answer(reply):
    out = decide.decide(turn_request(), said(reply, CALL))
    assert (out["action"], out["status"], out["retried"]) == ("CALL", "ok", True)
    assert "no ACTION line was found" in out["retry_prompt"]


def test_a_bare_first_line_is_an_answer():
    assert play(turn_request(), "Call\n\nFolding would be a mistake at these odds.") == ("CALL", 0, "ok", False)
    assert play(turn_request(), "RAISE: 300\nValue.") == ("RAISE", 300, "ok", False)


def test_a_label_inside_a_word_is_not_a_field():
    reply = "ACTION: call\nAMOUNT: 0\nREASON: His likely reaction: fold to more pressure, so I keep the pot small."
    out = decide.decide(turn_request(), said(reply))
    assert (out["action"], out["status"]) == ("CALL", "ok")
    assert out["reason"] == "His likely reaction: fold to more pressure, so I keep the pot small."


def test_the_final_answer_never_borrows_from_a_draft():
    reply = "ACTION: raise\nAMOUNT: 600\nREASON: Big.\n\nOn reflection that is too much.\nACTION: raise to 250"
    out = decide.decide(turn_request(), said(reply))
    assert (out["action"], out["amount"], out["reason"], out["status"]) == ("RAISE", 250, "", "ok")


def test_the_size_on_the_action_line_is_read():
    assert play(turn_request(), "ACTION: raise to 300\nREASON: Value.") == ("RAISE", 300, "ok", False)


@pytest.mark.parametrize("amount", ["30 BB", "30bb", "30 big blinds", "3x", "75% pot, 130"])
def test_an_amount_that_is_not_chips_is_a_miss(amount):  # bet 10–1,930
    out = decide.decide(turn_check_request(), said(f"ACTION: bet\nAMOUNT: {amount}\nREASON: Value.", "ACTION: bet\nAMOUNT: 300"))
    assert (out["action"], out["amount"], out["status"], out["retried"]) == ("RAISE", 300, "ok", True)
    assert "AMOUNT must be in chips" in out["retry_prompt"]


def test_chips_with_a_note_are_chips():
    assert play(turn_check_request(), "ACTION: bet\nAMOUNT: 300 (30 BB)\nREASON: Value.") == ("RAISE", 300, "ok", False)
    assert play(turn_request(), "ACTION: call\nAMOUNT: 10 BB")[::2] == ("CALL", "ok")  # a call has no size to get wrong


def test_a_reply_cut_off_before_its_reason_is_a_miss():
    cut = "Let me think it through. ACTION: fold would be too weak with top pair, so the better line is to raise to"
    out = decide.decide(turn_request(), said(cut, CALL, finish_reason="length"))
    assert (out["action"], out["status"], out["retried"]) == ("CALL", "ok", True)  # the retry's reply has its reason
    assert "cut off" in out["retry_prompt"]
    assert play(turn_check_request(), "ACTION: bet\nAMOUNT: 12", "ACTION: bet\nAMOUNT: 12", finish_reason="length")[2] == "unparseable"
    whole = "ACTION: bet\nAMOUNT: 120\nREASON: Value, and the rest of this sentence was cu"
    assert play(turn_check_request(), whole, finish_reason="length") == ("RAISE", 120, "ok", False)


def test_an_absurd_number_fits_the_engine():
    assert play(turn_request(), "ACTION: call\nAMOUNT: 99999999999999999999999")[1] == parsing.MAX_AMOUNT


@pytest.mark.parametrize("request_", [no_raise_request(), short_stack_request(), turn_request(), turn_check_request()])
def test_mock_only_picks_legal_actions(request_):
    random.seed(1)
    outs = [decide.decide(request_, mock.complete) for _ in range(500)]
    assert not [o for o in outs if o["retried"] or o["status"] != "ok"]
