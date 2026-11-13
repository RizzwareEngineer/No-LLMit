"""One turn: render the prompts, ask the model, parse and check the reply, retry once on
the model's own miss, retry provider failures while time remains, then fall back."""

import logging
import time

import requests

from parsing import parse_response
from prompts import render_retry_prompt, render_user_prompt, system_prompt
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
    is the source of truth; the engine checks the move again before applying it. A raise
    to the all-in total when no raise is legal is rewritten to ALL_IN. A "call" for the
    whole stack needs no rewrite: the engine lists CALL there and plays it as the all-in."""
    if parsed["status"] == "unparseable":
        return parsed.get("problem") or "no ACTION line was found"
    legal = {a.type.replace("-", "_"): a for a in request.legal_actions}
    action, amount, all_in = parsed["action"], parsed["amount"], legal.get("ALL_IN")
    if action == "RAISE":
        sizing = legal.get("BET") or legal.get("RAISE")
        if not sizing:
            if all_in and amount == all_in.amount and not parsed.get("size_problem"):
                parsed["action"] = "ALL_IN"
                return ""
            if all_in and request.to_call < request.stack:
                return f"the only bet or raise here is all-in {all_in.amount:,}"
            return "no bet or raise is legal here"
        if parsed.get("size_problem"):
            # "30 BB" played as 30 chips, or the first number of a sum, would not be the model's bet.
            return parsed["size_problem"]
        said = f"raise to {amount:,}" if sizing.type == "RAISE" else f"bet {amount:,}"
        if amount < sizing.min:
            return f"{said} is below the minimum {sizing.min:,}"
        if amount > sizing.max:
            return f"{said} is above the maximum {sizing.max:,}"
        return ""
    if action in legal:
        return ""
    if action == "CHECK":
        return f"there is {min(request.to_call, request.stack):,} to call, so check is not legal"
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
        except requests.ReadTimeout:
            raise  # the model got the request and is billed for it in full; a retry would get less time
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
        except Exception as e:  # our bug, not the model's miss: never a 500, never charged to the model
            log.exception("the parser failed on a reply")
            out.update(status="service_error", error=f"parser: {e}")
            break
        # A reply the token limit cut off before the end of its answer (the REASON comes last)
        # is not an answer: "bet 12" may be half of 120.
        if reply.get("finish_reason") == "length" and not parsed.get("complete"):
            parsed.update(action="FOLD", amount=0, status="unparseable", problem="the reply was cut off before it finished")
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
    for k in ("model", "upstream_provider"):
        if reply.get(k) is not None:
            out[k] = reply[k]
