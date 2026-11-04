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
    assert parse_response(f"{spelling}\nShove.")["action"] == "ALL_IN"


def test_bet_is_raise():
    assert parse_response("ACTION: BET\nAMOUNT: 40")["action"] == "RAISE"


@pytest.mark.parametrize("text", ["", "I think I will wait.", "ACTION: DANCE"])
def test_unparseable_folds(text):
    result = parse_response(text)
    assert (result["action"], result["status"]) == ("FOLD", "unparseable")
