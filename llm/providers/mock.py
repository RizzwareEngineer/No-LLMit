"""Stand-in provider for local development. Calls no model and costs nothing.

Picks a random legal action so the engine, prompts and frontend can be exercised
without an API key. Its output says nothing about how any real model plays.
"""

import random

REASON = "Mock provider: random legal action, no model was called."


def get_decision(player_name: str, prompt: str, valid_actions: list[dict]) -> dict:
    by_type = {a["type"]: a for a in valid_actions}
    sizing = by_type.get("BET") or by_type.get("RAISE")

    if "CHECK" in by_type:
        choices, weights = ["CHECK", "BET"], [70, 30]
    else:
        choices, weights = ["FOLD", "CALL", "RAISE"], [55, 33, 12]

    action = random.choices(choices, weights)[0]
    if action in ("BET", "RAISE") and not sizing:
        action = "CHECK" if "CHECK" in by_type else "FOLD"
    if action == "CALL" and "CALL" not in by_type:
        action = "ALL_IN" if random.random() < 0.2 else "FOLD"

    amount = 0
    if action in ("BET", "RAISE"):
        low, high = sizing["min"], sizing["max"]
        amount = random.randint(low, min(high, low * 3))

    raw = f"ACTION: {action}\nAMOUNT: {amount}\nREASON: {REASON}"
    return {"action": "RAISE" if action == "BET" else action, "amount": amount, "reason": REASON, "raw": raw, "model": "mock"}


def get_spend() -> dict | None:
    """The mock provider costs nothing."""
    return None
