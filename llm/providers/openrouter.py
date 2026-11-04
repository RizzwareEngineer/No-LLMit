"""OpenRouter chat completions client. One key, every model in registry.py."""

import os
import time

import requests

from parsing import parse_response
from prompts import system_prompt
from registry import get_model_id

API_URL = "https://openrouter.ai/api/v1/chat/completions"
TIMEOUT_SECONDS = 25  # the engine gives up at 30
# Sent explicitly so every host samples the same way instead of using its own default.
TEMPERATURE = 0.7


def get_decision(player_name: str, prompt: str, valid_actions: list[dict], retry_note: str | None = None) -> dict:
    """
    Ask the seat's model for its action given the current hand.
    retry_note, when set, tells the model why its previous reply was rejected.
    """
    model_id = get_model_id(player_name)
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": prompt},
    ]
    if retry_note:
        messages.append({
            "role": "user",
            "content": f"Your previous reply was invalid: {retry_note}\nReply again in the required format.",
        })

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
            # Room for models that think before answering; the reply itself is ~80 tokens.
            "max_tokens": 2048,
            "usage": {"include": True},
        },
        timeout=TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    body = response.json()
    if "error" in body:
        raise RuntimeError(f"{model_id}: {body['error'].get('message', body['error'])}")

    choice = body["choices"][0]
    message = choice.get("message") or {}
    finish_reason = choice.get("finish_reason")
    raw_text = message.get("content") or ""
    if not raw_text.strip() and finish_reason != "length":
        raise RuntimeError(f"{model_id} returned an empty reply")

    result = parse_response(raw_text)
    # Ran out of max_tokens (usually while thinking) before giving a usable answer.
    if finish_reason == "length" and result["status"] == "unparseable":
        result["status"] = "truncated"

    usage = body.get("usage") or {}
    result.update(
        model=model_id,
        usage=usage,
        reasoning=message.get("reasoning") or None,
        reasoning_tokens=(usage.get("completion_tokens_details") or {}).get("reasoning_tokens"),
        finish_reason=finish_reason,
        upstream_provider=body.get("provider"),
        generation_id=body.get("id"),
        temperature=TEMPERATURE,
    )
    return result


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
        value = {"used_usd": used, "limit_usd": limit, "limit_reset": data.get("limit_reset")}
    except Exception:
        value = None

    _spend_cache.update(at=time.time(), value=value)
    return value
