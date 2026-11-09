"""One turn: render the prompts, ask the model, parse and check the reply, retry once on
the model's own miss, retry provider failures while time remains, then fall back."""

import logging
import time

import requests

from parsing import parse_response
from prompts import bet_word, render_retry_prompt, render_user_prompt, system_prompt
from providers.openrouter import ProviderError
from schemas import DecisionRequest

# Time budget for the whole turn, every call included; the engine waits TURN_BUDGET + 5s.
TURN_BUDGET = 45.0
# One request: a 1024-token think plus the reply at ~50 tok/s on a slow host.
REQUEST_TIMEOUT = 25.0
# Pauses before retrying a provider failure (network, 429, 5xx, empty); the last one
# only happens when the budget still has room for a full request.
BACKOFF = (1.0, 2.0)
MIN_REQUEST = 3.0  # not worth asking with less time than this left

SUM_FIELDS = ("prompt_tokens", "completion_tokens", "cost", "reasoning_tokens")

log = logging.getLogger(__name__)


def check_legal(parsed: dict, request: DecisionRequest) -> str:
    """Why the parsed reply cannot be played, or "" when it can. The engine's legal list
    is the source of truth; the engine checks the move again before applying it. A reply
    that names the same move as a legal all-in is rewritten to ALL_IN: "call" when the
    bet covers the stack, or a raise to the all-in total when no raise is legal."""
    if parsed["status"] == "unparseable":
        return parsed.get("problem") or "no ACTION line was found"
    legal = {a.type.replace("-", "_"): a for a in request.legal_actions}
    action, amount, all_in = parsed["action"], parsed["amount"], legal.get("ALL_IN")
    if action == "RAISE":
        sizing, word = legal.get("BET") or legal.get("RAISE"), bet_word(request)
        if parsed.get("unit"):
            # "30 BB" played as 30 chips would be a different move from the one the model made.
            return "AMOUNT must be in chips, not big blinds, a multiple or a percentage"
        if not sizing:
            if all_in and amount == all_in.amount:
                parsed["action"] = "ALL_IN"
                return ""
            if all_in and request.to_call < request.stack:
                return f"the only {word} here is all-in {all_in.amount:,}"
            return f"no {word} is legal here"
        said = f"{word} to {amount:,}" if word == "raise" else f"{word} {amount:,}"
        if amount < sizing.min:
            return f"{said} is below the minimum {sizing.min:,}"
        if amount > sizing.max:
            return f"{said} is above the maximum {sizing.max:,}"
        return ""
    if action in legal:
        return ""
    if action == "CALL" and all_in and request.to_call >= request.stack:
        parsed["action"] = "ALL_IN"  # a call for the whole stack is the all-in
        return ""
    if action == "CHECK":
        return f"there is {request.to_call:,} to call, so check is not legal"
    if action == "CALL":
        return "there is nothing to call"
    return f"{action.lower().replace('_', '-')} is not legal here"


def ask(complete, request: DecisionRequest, messages: list[dict], deadline: float) -> dict:
    """complete() with provider failures retried while the budget allows. Raises the last
    failure (requests.Timeout or ProviderError) when it gives up."""
    tries = 0
    while True:
        remaining = deadline - time.monotonic()
        if remaining < MIN_REQUEST:
            raise requests.Timeout("turn budget used up")
        try:
            return complete(request, messages, min(REQUEST_TIMEOUT, remaining))
        except (requests.Timeout, ProviderError):
            if tries >= len(BACKOFF) or deadline - time.monotonic() < BACKOFF[tries] + MIN_REQUEST:
                raise
            time.sleep(BACKOFF[tries])
            tries += 1


def decide(request: DecisionRequest, complete) -> dict:
    """The decision for one turn. complete(request, messages, timeout) is the provider."""
    deadline = time.monotonic() + TURN_BUDGET
    prompt = render_user_prompt(request)
    messages = [{"role": "system", "content": system_prompt}, {"role": "user", "content": prompt}]
    # action/amount stay the model's last parsed reply (FOLD 0 when there was none); when
    # status is not ok the engine, the source of truth, plays its own fallback.
    out = {
        "action": "FOLD", "amount": 0, "reason": "", "raw": "", "status": "ok",
        "retried": False, "error": None, "prompt": prompt, "retry_prompt": None,
        "model": None, "usage": {},
    }
    raws = []
    for attempt in range(2):
        try:
            reply = ask(complete, request, messages, deadline)
        except (requests.Timeout, ProviderError) as e:
            out["status"] = "timeout" if isinstance(e, requests.Timeout) else "api_error"
            out["error"] = str(e)
            break
        raws.append(reply["raw"])
        _merge(out, reply)
        try:
            parsed = parse_response(reply["raw"])
        except Exception:  # a reply the parser cannot read is the model's miss, never a 500
            log.exception("the parser failed on a reply")
            parsed = {"action": "FOLD", "amount": 0, "reason": "", "status": "unparseable",
                      "problem": "the reply could not be read"}
        # A reply the token limit cut off before its REASON is not an answer: "bet 12" may be half of 120.
        if parsed["status"] == "ok" and reply.get("finish_reason") == "length" and not parsed["reason"]:
            parsed["status"], parsed["problem"] = "unparseable", "the reply was cut off before it finished"
        out["reason"] = parsed["reason"]
        problem = check_legal(parsed, request)
        out.update(action=parsed["action"], amount=parsed["amount"])
        if not problem:
            out["status"] = "ok"
            break
        out["status"] = "unparseable" if parsed["status"] == "unparseable" else "illegal"
        if attempt == 0:
            out["retried"] = True
            out["retry_prompt"] = render_retry_prompt(problem, request)
            messages += [{"role": "assistant", "content": reply["raw"]}, {"role": "user", "content": out["retry_prompt"]}]
    out["raw"] = "\n\n--- retry ---\n".join(raws)
    return out


def _merge(out: dict, reply: dict):
    """Keep the latest reply's metadata and sum token counts and cost over the turn."""
    usage = reply.get("usage") or {}
    for k in SUM_FIELDS:
        v = usage.get(k) if k != "reasoning_tokens" else reply.get("reasoning_tokens")
        if v is not None:
            out["usage"][k] = out["usage"].get(k, 0) + v
    for k in ("model", "reasoning", "finish_reason", "upstream_provider", "generation_id", "temperature"):
        if reply.get(k) is not None:
            out[k] = reply[k]
