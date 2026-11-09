"""Stand-in provider for local development. Calls no model and costs nothing.

Picks a random legal action so the engine, prompts and frontend can be exercised
without an API key. Its output says nothing about how any real model plays.
"""

import random

from schemas import DecisionRequest

REASON = "Mock provider: random legal action, no model was called."


def complete(request: DecisionRequest, messages: list[dict], timeout: float) -> dict:
    by_type = {a.type.replace("-", "_"): a for a in request.legal_actions}
    sizing = by_type.get("BET") or by_type.get("RAISE")

    if "CHECK" in by_type:
        choices, weights = ["CHECK", "BET"], [70, 30]
    else:
        # A rare shove, so all-in spots (and all-in EV) show up in local data.
        choices, weights = ["FOLD", "CALL", "RAISE", "ALL_IN"], [53, 32, 12, 3]

    action = random.choices(choices, weights)[0]
    if action in ("BET", "RAISE") and not sizing:
        action = "CHECK" if "CHECK" in by_type else "FOLD"
    if action == "CALL" and "CALL" not in by_type:
        action = "ALL_IN" if random.random() < 0.2 else "FOLD"

    amount = 0
    if action in ("BET", "RAISE"):
        low, high = sizing.min, sizing.max
        amount = random.randint(low, min(high, low * 3))

    return {"raw": f"ACTION: {action}\nAMOUNT: {amount}\nREASON: {REASON}", "model": "mock", "usage": {}}


def get_spend() -> dict | None:
    """The mock provider costs nothing."""
    return None
