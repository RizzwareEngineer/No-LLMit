"""OpenRouter chat completions client. One key, every model in registry.py."""

import os

import requests

from parsing import parse_response
from prompts import system_prompt
from registry import get_model_id

API_URL = "https://openrouter.ai/api/v1/chat/completions"
TIMEOUT_SECONDS = 25  # the engine gives up at 30


def get_decision(player_name: str, prompt: str, valid_actions: list[dict]) -> dict:
    """
    Ask the seat's model for its action given the current hand.
    """
    model_id = get_model_id(player_name)

    response = requests.post(
        API_URL,
        headers={
            "Authorization": f"Bearer {os.environ['OPENROUTER_API_KEY']}",
            "HTTP-Referer": "https://nollmit.vercel.app",
            "X-Title": "No-LLMit",
        },
        json={
            "model": model_id,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt},
            ],
            # Room for models that think before answering; the reply itself is ~80 tokens.
            "max_tokens": 1024,
            "usage": {"include": True},
        },
        timeout=TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    body = response.json()
    if "error" in body:
        raise RuntimeError(f"{model_id}: {body['error'].get('message', body['error'])}")

    raw_text = body["choices"][0]["message"].get("content") or ""
    if not raw_text.strip():
        raise RuntimeError(f"{model_id} returned an empty reply")

    result = parse_response(raw_text)
    result["model"] = model_id
    result["usage"] = body.get("usage") or {}
    return result
