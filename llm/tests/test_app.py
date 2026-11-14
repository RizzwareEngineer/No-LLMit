import pytest
import requests
import urllib3
from fastapi.testclient import TestClient

import app
from conftest import preflop_request
from prompts import prompt_version
from providers import openrouter


@pytest.fixture
def client():
    return TestClient(app.app)


def test_usage_is_provider_and_spend(client):
    assert client.get("/usage").json() == {"provider": "mock", "spend": None}


def test_prompt_endpoint(client):
    body = client.get("/prompt").json()
    assert body["prompt_version"] == prompt_version
    assert body["system_prompt"].startswith("You are an expert No-Limit Texas Hold'em player")


def test_decide_with_mock(client):
    body = client.post("/decide", json=preflop_request().model_dump()).json()
    assert body["action"] in ("FOLD", "CALL", "RAISE", "ALL_IN")
    assert body["status"] == "ok" and body["retried"] is False
    assert body["provider"] == "mock" and body["model"] == "mock"
    assert body["prompt_version"] == prompt_version
    assert body["prompt"].startswith("Blinds 5/10")
    for field in ("reasoning_tokens", "upstream_provider", "error"):
        assert body[field] is None


def test_decide_rejects_the_old_request_shape(client):
    assert client.post("/decide", json={"player_name": "Phi-4", "prompt": "Your turn."}).status_code == 422


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
            "model": "microsoft/phi-4",
            "choices": [{"finish_reason": finish_reason, "message": {"content": content, "reasoning": "Thinking..."}}],
            "usage": {"prompt_tokens": 500, "completion_tokens": 1536, "completion_tokens_details": {"reasoning_tokens": 1500}},
        })

    monkeypatch.setattr(openrouter.requests, "post", post)


def test_openrouter_reply_and_metadata(monkeypatch):
    sent = {}
    openrouter_reply(monkeypatch, "ACTION: ALL IN\nAMOUNT: 0", "stop", sent)
    result = openrouter.complete(preflop_request(), [{"role": "user", "content": "x"}], 7)
    assert result["raw"] == "ACTION: ALL IN\nAMOUNT: 0"
    assert result["reasoning_tokens"] == 1500 and result["finish_reason"] == "stop"
    assert result["upstream_provider"] == "DeepInfra" and result["model"] == "microsoft/phi-4"
    assert sent["model"] == "microsoft/phi-4"
    assert (sent["temperature"], sent["max_tokens"], sent["reasoning"]) == (0.7, 1536, {"max_tokens": 1024})


def test_openrouter_truncated_think_is_a_reply(monkeypatch):
    openrouter_reply(monkeypatch, "", "length")
    assert openrouter.complete(preflop_request(), [], 7)["raw"] == ""


def test_openrouter_empty_reply_is_a_provider_error(monkeypatch):
    openrouter_reply(monkeypatch, "", "stop")
    with pytest.raises(openrouter.ProviderError):
        openrouter.complete(preflop_request(), [], 7)


def test_openrouter_http_error_is_a_provider_error(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "test")

    def post(url, headers, json, timeout):
        raise requests.ConnectionError("boom")

    monkeypatch.setattr(openrouter.requests, "post", post)
    with pytest.raises(openrouter.ProviderError):
        openrouter.complete(preflop_request(), [], 7)


def test_openrouter_malformed_body_is_a_provider_error(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "test")
    html = requests.Response()
    html.status_code, html._content = 200, b"<html>Bad gateway</html>"
    for response in (html, FakeResponse({"error": "rate limited"}), FakeResponse({"choices": [None]}),
                     FakeResponse({"choices": [{"message": {"content": ["x"]}}]}), FakeResponse(None)):
        monkeypatch.setattr(openrouter.requests, "post", lambda url, headers, json, timeout: response)
        with pytest.raises(openrouter.ProviderError):
            openrouter.complete(preflop_request(), [], 7)


def test_openrouter_body_read_stall_is_a_read_timeout(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "test")
    stall = urllib3.exceptions.ReadTimeoutError(None, None, "Read timed out.")

    def post(url, headers, json, timeout):
        raise requests.ConnectionError(stall)  # what requests raises when the body stops arriving

    monkeypatch.setattr(openrouter.requests, "post", post)
    with pytest.raises(requests.ReadTimeout):
        openrouter.complete(preflop_request(), [], 7)


def test_openrouter_spend(monkeypatch):
    monkeypatch.setenv("OPENROUTER_API_KEY", "test")
    monkeypatch.setattr(openrouter, "_spend_cache", {"at": 0.0, "value": None})
    monkeypatch.setattr(openrouter.requests, "get", lambda url, headers, timeout: FakeResponse({"data": {"limit": 10, "limit_remaining": 7.5}}))
    assert openrouter.get_spend() == {"used_usd": 2.5, "limit_usd": 10}
