import requests

import decide
from conftest import flop_request, preflop_request, short_stack_request, with_
from providers.openrouter import ProviderError


def scripted(*replies):
    """A provider that returns each reply in turn (a string) or raises it (an exception),
    recording the messages it was sent."""
    calls = []

    def complete(request, messages, timeout):
        calls.append({"messages": list(messages), "timeout": timeout})
        reply = replies[len(calls) - 1]
        if isinstance(reply, Exception):
            raise reply
        return {"raw": reply, "model": "m", "usage": {"prompt_tokens": 100, "completion_tokens": 10, "cost": 0.001},
                "upstream_provider": "Host", "finish_reason": "stop"}

    complete.calls = calls
    return complete


def test_legal_reply_is_played(monkeypatch):
    monkeypatch.setattr(decide.time, "sleep", lambda s: None)
    complete = scripted("ACTION: RAISE\nAMOUNT: 30\nREASON: Open.")
    out = decide.decide(preflop_request(), complete)
    assert (out["action"], out["amount"], out["reason"], out["status"], out["retried"]) == ("RAISE", 30, "Open.", "ok", False)
    assert out["model"] == "m" and out["upstream_provider"] == "Host"
    assert complete.calls[0]["messages"][0]["role"] == "system"
    assert complete.calls[0]["messages"][1]["content"] == out["prompt"]
    assert complete.calls[0]["timeout"] <= decide.REQUEST_TIMEOUT


def test_illegal_reply_is_retried_once_then_played():
    complete = scripted("ACTION: CHECK\nAMOUNT: 0\nREASON: Free card.", "ACTION: CALL\nAMOUNT: 0\nREASON: Fine, call.")
    out = decide.decide(preflop_request(), complete)
    assert (out["action"], out["status"], out["retried"]) == ("CALL", "ok", True)
    retry = complete.calls[1]["messages"]
    assert retry[2] == {"role": "assistant", "content": "ACTION: CHECK\nAMOUNT: 0\nREASON: Free card."}
    assert retry[3]["content"].startswith("Your reply was invalid: CHECK is not legal here: there is 10 to call.")
    assert out["retry_prompt"] == retry[3]["content"]
    assert "--- retry ---" in out["raw"]
    assert out["usage"] == {"prompt_tokens": 200, "completion_tokens": 20, "cost": 0.002}


def test_two_illegal_replies_fall_back_to_fold():
    complete = scripted("ACTION: RAISE\nAMOUNT: 15\nREASON: Min.", "ACTION: RAISE\nAMOUNT: 9999\nREASON: Max.")
    out = decide.decide(preflop_request(), complete)
    assert (out["action"], out["amount"], out["status"], out["retried"]) == ("RAISE", 9999, "illegal", True)
    assert out["reason"] == "Max."  # the model's words stay its own; the engine plays the fallback
    assert "below the minimum 20" in complete.calls[1]["messages"][3]["content"]


def test_two_unreadable_replies_are_unparseable():
    r = with_(flop_request(), to_call=0, legal_actions=[{"type": "FOLD"}, {"type": "CHECK"}, {"type": "BET", "min": 10, "max": 1970}])
    out = decide.decide(r, scripted("hmm", "I would like to think about it"))
    assert (out["action"], out["status"], out["retried"]) == ("FOLD", "unparseable", True)


def test_all_in_call_and_bet_naming():
    out = decide.decide(short_stack_request(), scripted("ACTION: CALL\nAMOUNT: 0\nREASON: Queens."))
    assert (out["action"], out["status"]) == ("CALL", "ok")
    r = with_(flop_request(), to_call=0, legal_actions=[{"type": "FOLD"}, {"type": "CHECK"}, {"type": "BET", "min": 10, "max": 1970}])
    assert decide.check_legal({"status": "ok", "action": "RAISE", "amount": 5}, r) == "BET 5 is below the minimum 10"
    assert decide.check_legal({"status": "ok", "action": "CALL", "amount": 0}, r) == "CALL is not legal here: there is nothing to call"


def test_provider_failures_retry_then_fall_back(monkeypatch):
    slept = []
    monkeypatch.setattr(decide.time, "sleep", slept.append)
    complete = scripted(ProviderError("429"), ProviderError("502"), "ACTION: CALL\nAMOUNT: 0\nREASON: Ok.")
    out = decide.decide(preflop_request(), complete)
    assert (out["action"], out["status"], out["retried"]) == ("CALL", "ok", False)
    assert slept == [1.0, 2.0]

    complete = scripted(ProviderError("a"), ProviderError("b"), ProviderError("c"))
    out = decide.decide(preflop_request(), complete)
    assert (out["action"], out["status"], out["retried"], out["error"]) == ("FOLD", "api_error", False, "c")
    assert out["raw"] == "" and out["reason"] == ""


def test_timeout_has_its_own_status(monkeypatch):
    monkeypatch.setattr(decide.time, "sleep", lambda s: None)
    out = decide.decide(preflop_request(), scripted(requests.Timeout("t"), requests.Timeout("t"), requests.Timeout("t")))
    assert (out["action"], out["status"]) == ("FOLD", "timeout")


def test_provider_failure_on_the_retry_is_not_the_models_miss(monkeypatch):
    monkeypatch.setattr(decide.time, "sleep", lambda s: None)
    complete = scripted("ACTION: CHECK", ProviderError("x"), ProviderError("x"), ProviderError("x"))
    out = decide.decide(preflop_request(), complete)
    assert (out["status"], out["retried"], out["action"]) == ("api_error", True, "CHECK")


def test_no_time_left_skips_the_call(monkeypatch):
    monkeypatch.setattr(decide, "TURN_BUDGET", 1.0)
    complete = scripted("ACTION: CHECK")
    out = decide.decide(preflop_request(), complete)
    assert (out["status"], complete.calls) == ("timeout", [])
