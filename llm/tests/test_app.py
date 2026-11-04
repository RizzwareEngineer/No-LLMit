import os

os.environ["LLM_PROVIDER"] = "mock"

import pytest
from fastapi.testclient import TestClient

import app
from providers import openrouter


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setattr(app, "DECISION_LOG", tmp_path / "decisions.jsonl")
    return TestClient(app.app)


def test_usage_is_provider_and_spend(client):
    assert client.get("/usage").json() == {"provider": "mock", "spend": None}


def test_decide_with_mock(client):
    body = client.post("/decide", json={
        "player_name": "Phi-4",
        "prompt": "Your turn.",
        "valid_actions": [{"type": "FOLD"}, {"type": "CALL", "amount": 20}, {"type": "RAISE", "min": 40, "max": 500}],
        "retry_note": "No ACTION line.",
    }).json()
    assert body["action"] in ("FOLD", "CALL", "RAISE", "ALL_IN")
    assert body["status"] == "ok"
    assert body["provider"] == "mock"
    for field in ("reasoning", "reasoning_tokens", "finish_reason", "upstream_provider", "generation_id", "temperature"):
        assert body[field] is None


class FakeResponse:
    def __init__(self, body):
        self.body = body

    def raise_for_status(self):
        pass

    def json(self):
        return self.body


def openrouter_reply(monkeypatch, content, finish_reason, sent=None):
    monkeypatch.setenv("OPENROUTER_API_KEY", "test")

    def post(url, headers, json, timeout):
        if sent is not None:
            sent.update(json)
        return FakeResponse({
            "id": "gen-123",
            "provider": "DeepInfra",
            "choices": [{"finish_reason": finish_reason, "message": {"content": content, "reasoning": "Thinking..."}}],
            "usage": {"prompt_tokens": 500, "completion_tokens": 2048, "completion_tokens_details": {"reasoning_tokens": 2000}},
        })

    monkeypatch.setattr(openrouter.requests, "post", post)


def test_openrouter_truncated(monkeypatch):
    openrouter_reply(monkeypatch, "", "length")
    result = openrouter.get_decision("Phi-4", "Your turn.", [])
    assert (result["action"], result["status"]) == ("FOLD", "truncated")
    assert result["reasoning"] == "Thinking..."
    assert result["reasoning_tokens"] == 2000
    assert result["upstream_provider"] == "DeepInfra"
    assert result["generation_id"] == "gen-123"


def test_openrouter_empty_reply_is_error(monkeypatch):
    openrouter_reply(monkeypatch, "", "stop")
    with pytest.raises(RuntimeError):
        openrouter.get_decision("Phi-4", "Your turn.", [])


def test_openrouter_sends_temperature_and_retry_note(monkeypatch):
    sent = {}
    openrouter_reply(monkeypatch, "ACTION: ALL IN\nAMOUNT: 0", "stop", sent)
    result = openrouter.get_decision("Phi-4", "Your turn.", [], retry_note="No ACTION line.")
    assert (result["action"], result["reason"], result["status"]) == ("ALL_IN", "", "ok")
    assert result["temperature"] == sent["temperature"] == 0.7
    assert sent["max_tokens"] == 2048
    assert sent["messages"][-1]["role"] == "user"
    assert sent["messages"][-1]["content"].startswith("Your previous reply was invalid: No ACTION line.")
