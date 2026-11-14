"""OpenRouter chat completions client. One key, every model in registry.py."""

import os
import time

import requests
import urllib3

from registry import MODELS
from schemas import DecisionRequest

API_URL = "https://openrouter.ai/api/v1/chat/completions"
# Sent explicitly so every host samples the same way instead of using its own default.
TEMPERATURE = 0.7
# One budget for every model. Reasoning tokens count against max_tokens on most providers,
# so the reply (three lines, ~60 tokens) keeps 512 tokens of room after a full think.
# Anthropic needs reasoning.max_tokens >= 1024 and max_tokens above it; effort-only models
# (OpenAI, xAI) get the effort OpenRouter derives from the budget (1024/1536 ~ medium-high);
# models without reasoning ignore the parameter. https://openrouter.ai/docs/use-cases/reasoning-tokens
MAX_TOKENS = 1536
REASONING_TOKENS = 1024


class ProviderError(Exception):
    """The provider, not the model, failed: network, HTTP error, empty body."""


def complete(request: DecisionRequest, messages: list[dict], timeout: float) -> dict:
    """One chat completion for the seat's model. Raises ProviderError (or requests.Timeout)
    when no reply came back; a reply that is only reasoning cut short counts as a reply."""
    model_id = MODELS[request.player_name]
    try:
        response = requests.post(
            API_URL,
            headers={
                "Authorization": f"Bearer {os.environ['OPENROUTER_API_KEY']}",
                "HTTP-Referer": "https://nollmit.vercel.app",
                "X-Title": "No-LLMit",
            },
            json={
                "model": model_id,
                "messages": messages,
                "temperature": TEMPERATURE,
                "max_tokens": MAX_TOKENS,
                "reasoning": {"max_tokens": REASONING_TOKENS},
                "usage": {"include": True},
            },
            timeout=timeout,
        )
        response.raise_for_status()
        body = response.json()
        if "error" in body:
            raise ProviderError(f"{model_id}: {body['error'].get('message', body['error'])}")

        choice = (body.get("choices") or [{}])[0]
        message = choice.get("message") or {}
        finish_reason = choice.get("finish_reason")
        raw = message.get("content") or ""
        if not raw.strip() and finish_reason != "length":
            raise ProviderError(f"{model_id} returned an empty reply")

        usage = body.get("usage") or {}
        return {
            "raw": raw,
            "model": body.get("model") or model_id,
            "usage": usage,
            "reasoning": message.get("reasoning") or None,
            "reasoning_tokens": (usage.get("completion_tokens_details") or {}).get("reasoning_tokens"),
            "finish_reason": finish_reason,
            "upstream_provider": body.get("provider"),
            "generation_id": body.get("id"),
            "temperature": TEMPERATURE,
        }
    except requests.Timeout:
        raise
    except requests.ConnectionError as e:
        # requests reports a stall while reading the body (the model is slow) as a ConnectionError.
        if e.args and isinstance(e.args[0], urllib3.exceptions.ReadTimeoutError):
            raise requests.ReadTimeout(e) from e
        raise ProviderError(f"{model_id}: {e}") from e
    except requests.RequestException as e:
        raise ProviderError(f"{model_id}: {e}") from e
    except (ValueError, AttributeError, TypeError, LookupError) as e:  # not JSON, or not OpenRouter's documented shape
        raise ProviderError(f"{model_id}: malformed reply: {e}") from e

KEY_URL = "https://openrouter.ai/api/v1/key"
_spend_cache = {"at": 0.0, "value": None}


def get_spend() -> dict | None:
    """
    What this API key has spent against its credit limit, in USD. Cached for a minute.
    Returns None if OpenRouter cannot be reached.
    """
    if time.time() - _spend_cache["at"] < 60:
        return _spend_cache["value"]

    value = None
    try:
        response = requests.get(
            KEY_URL,
            headers={"Authorization": f"Bearer {os.environ['OPENROUTER_API_KEY']}"},
            timeout=5,
        )
        response.raise_for_status()
        data = response.json()["data"]
        limit = data.get("limit")
        remaining = data.get("limit_remaining")
        used = limit - remaining if limit is not None and remaining is not None else data.get("usage")
        value = {"used_usd": used, "limit_usd": limit}
    except Exception:
        value = None

    _spend_cache.update(at=time.time(), value=value)
    return value
