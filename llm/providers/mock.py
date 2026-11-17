"""Stand-in provider for local development. Calls no model and costs nothing.

Picks a random legal action so the engine, prompts and frontend can be exercised
without an API key. Its output says nothing about how any real model plays.
"""

import os
import random

from schemas import DecisionRequest

REASON = "Mock provider: random legal action, no model was called."

# Test fixtures only (web/scripts/fixture); production uses openrouter and never reads these.
# MOCK_SEED seeds the choices, so with the engine's FIXTURE_SEED a session replays the same hands.
# MOCK_BETS=big sizes every bet and raise at the maximum (big pots and stacks on screen).
# MOCK_REASON_REPEAT=N repeats the reason N times (a long reason that is still typing when a page loads).
_rng = random.Random(int(os.environ["MOCK_SEED"])) if os.getenv("MOCK_SEED") else random
_BIG = os.getenv("MOCK_BETS") == "big"
_REPEAT = max(1, int(os.getenv("MOCK_REASON_REPEAT") or 1))
if _REPEAT > 1:
    REASON = " ".join([REASON] * _REPEAT)


def complete(request: DecisionRequest, messages: list[dict], timeout: float) -> dict:
    by_type = {a.type.replace("-", "_"): a for a in request.legal_actions}
    sizing = by_type.get("BET") or by_type.get("RAISE")

    # Only moves the engine listed; a rare shove, so all-in spots (and all-in EV) show up in local data.
    options = [("CHECK", 70), ("BET", 30)] if "CHECK" in by_type else [("FOLD", 53), ("CALL", 32), ("RAISE", 12), ("ALL_IN", 3)]
    legal = [(a, w) for a, w in options if (sizing if a in ("BET", "RAISE") else a in by_type)]
    action = _rng.choices(*zip(*legal))[0] if legal else "FOLD"

    amount = 0
    if action in ("BET", "RAISE"):
        low, high = sizing.min, sizing.max
        amount = high if _BIG else _rng.randint(low, min(high, low * 3))

    return {"raw": f"ACTION: {action}\nAMOUNT: {amount}\nREASON: {REASON}", "model": "mock", "usage": {}}


def get_spend() -> dict | None:
    """The mock provider costs nothing."""
    return None
