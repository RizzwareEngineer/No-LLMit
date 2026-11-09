import pytest

from parsing import parse_response


def test_missing_reason_stays_empty():
    result = parse_response("ACTION: CALL\nAMOUNT: 0")
    assert result["action"] == "CALL"
    assert result["reason"] == ""
    assert result["status"] == "ok"


def test_reason_is_kept():
    result = parse_response("ACTION: RAISE\nAMOUNT: 150\nREASON: Strong hand in position.")
    assert (result["action"], result["amount"], result["reason"]) == ("RAISE", 150, "Strong hand in position.")


@pytest.mark.parametrize("spelling", ["ALL_IN", "ALL-IN", "ALL IN", "ALLIN", "all-in", "All In"])
def test_all_in_spellings(spelling):
    assert parse_response(f"ACTION: {spelling}\nAMOUNT: 0\nREASON: Shove.")["action"] == "ALL_IN"
    assert parse_response(spelling)["action"] == "ALL_IN"  # the label-less form: the move alone


def test_bet_is_raise():
    assert parse_response("ACTION: BET\nAMOUNT: 40")["action"] == "RAISE"


@pytest.mark.parametrize("text", ["", "I think I will wait.", "ACTION: DANCE"])
def test_unparseable_folds(text):
    result = parse_response(text)
    assert (result["action"], result["status"]) == ("FOLD", "unparseable")


def test_markdown_is_stripped():
    text = "```\n**ACTION:** `RAISE`\n- **AMOUNT:** 1,200\n* REASON: _Value_ bet.\n```"
    result = parse_response(text)
    assert (result["action"], result["amount"], result["reason"], result["status"]) == ("RAISE", 1200, "Value bet.", "ok")


def test_last_action_line_wins():
    text = ("Thinking: ACTION: CALL would be fine but I prefer pressure.\nAMOUNT: 0\n\n"
            "ACTION: RAISE\nAMOUNT: 60\nREASON: Take it down now.")
    result = parse_response(text)
    assert (result["action"], result["amount"], result["reason"]) == ("RAISE", 60, "Take it down now.")


def test_commas_and_currency_in_amounts():
    assert parse_response("ACTION: RAISE\nAMOUNT: $2,057")["amount"] == 2057
    assert parse_response("RAISE: 1,500")["amount"] == 1500


@pytest.mark.parametrize("line,action", [
    ("raise all-in", "ALL_IN"), ("call all-in", "CALL"), ("bet all in", "ALL_IN"), ("Raise to 200", "RAISE"),
    ("call", "CALL"), ("Check.", "CHECK"), ("fold!", "FOLD"),
])
def test_action_line_wording(line, action):
    assert parse_response(f"ACTION: {line}\nAMOUNT: 0")["action"] == action


def test_amount_line_wording():
    assert parse_response("ACTION: raise\nAMOUNT: raise to 1,130")["amount"] == 1130
    assert parse_response("ACTION: raise\nAMOUNT: 200 chips")["amount"] == 200
    assert parse_response("ACTION: call\nAMOUNT: 0 (a call)")["amount"] == 0
