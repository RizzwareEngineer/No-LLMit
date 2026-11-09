"""Game states the engine would send, as the tests' fixtures."""

import os

os.environ["LLM_PROVIDER"] = "mock"

from schemas import DecisionRequest

SEATS = [
    {"seat": 7, "position": "SB", "stack": 1953},
    {"seat": 8, "position": "BB", "stack": 1990},
    {"seat": 0, "position": "UTG", "stack": 2057},
    {"seat": 1, "position": "UTG+1", "stack": 2000},
    {"seat": 2, "position": "MP", "stack": 2000},
    {"seat": 3, "position": "MP+1", "stack": 2000},
    {"seat": 4, "position": "HJ", "stack": 2000},
    {"seat": 5, "position": "CO", "stack": 1990},
    {"seat": 6, "position": "BTN", "stack": 1995},
]
BLINDS = [{"seat": 7, "action": "post", "amount": 5}, {"seat": 8, "action": "post", "amount": 10}]


def with_(r: DecisionRequest, **over) -> DecisionRequest:
    """r with fields replaced, validated."""
    return DecisionRequest.model_validate({**r.model_dump(), **over})


def preflop_request(**over) -> DecisionRequest:
    """UTG to act first in, 9-handed 5/10."""
    fields = {
        "player_name": "Phi-4", "small_blind": 5, "big_blind": 10, "seats": SEATS,
        "streets": [{"street": "preflop", "actions": BLINDS}],
        "seat": 0, "position": "UTG", "hole_cards": ["Ks", "4d"], "pot": 15, "to_call": 10, "stack": 2057,
        "legal_actions": [
            {"type": "FOLD"}, {"type": "CALL", "amount": 10}, {"type": "RAISE", "min": 20, "max": 2057},
            {"type": "ALL-IN", "amount": 2057},
        ],
    }
    fields.update(over)
    return DecisionRequest(**fields)


def flop_request() -> DecisionRequest:
    """BB facing a flop bet after a three-way preflop pot."""
    seats = [dict(s) for s in SEATS]
    for s in seats:
        s["stack"] = {7: 1930, 8: 1970, 6: 1925}.get(s["seat"], s["stack"])
    return DecisionRequest(
        player_name="Phi-4", small_blind=5, big_blind=10, seats=seats,
        streets=[
            {"street": "preflop", "actions": BLINDS + [
                {"seat": 0, "action": "fold"}, {"seat": 1, "action": "fold"}, {"seat": 2, "action": "fold"},
                {"seat": 3, "action": "fold"}, {"seat": 4, "action": "fold"}, {"seat": 5, "action": "fold"},
                {"seat": 6, "action": "raise", "amount": 30}, {"seat": 7, "action": "call", "amount": 25},
                {"seat": 8, "action": "call", "amount": 20},
            ]},
            {"street": "flop", "board": ["Ah", "7d", "2c"], "pot": 90, "actions": [
                {"seat": 7, "action": "check"}, {"seat": 8, "action": "check"}, {"seat": 6, "action": "raise", "amount": 40},
                {"seat": 7, "action": "fold"},
            ]},
        ],
        seat=8, position="BB", hole_cards=["Ad", "Tc"], pot=130, to_call=40, stack=1970,
        legal_actions=[
            {"type": "FOLD"}, {"type": "CALL", "amount": 40}, {"type": "RAISE", "min": 80, "max": 1970},
            {"type": "ALL-IN", "amount": 1970},
        ],
    )


def turn_check_request() -> DecisionRequest:
    """The flop hand one street on: BB called the 40 and is first to act on an unopened turn."""
    r = flop_request()
    streets = r.model_dump()["streets"]
    streets[1]["actions"].append({"seat": 8, "action": "call", "amount": 40})
    streets.append({"street": "turn", "board": ["Ah", "7d", "2c", "Kc"], "pot": 170})
    return with_(r, streets=streets, pot=170, to_call=0, stack=1930, legal_actions=[
        {"type": "FOLD"}, {"type": "CHECK"}, {"type": "BET", "min": 10, "max": 1930}, {"type": "ALL-IN", "amount": 1930},
    ])


def turn_request() -> DecisionRequest:
    """UTG+1 with As Kd facing a turn bet from the small blind heads-up: the About page's example."""
    positions = ["SB", "BB", "UTG", "UTG+1", "MP", "MP+1", "HJ", "CO", "BTN"]
    stacks = [1075, 970, 1500, 1130, 1000, 1000, 1000, 1000, 870]
    return DecisionRequest(
        player_name="Phi-4", small_blind=5, big_blind=10,
        seats=[{"seat": i, "position": p, "stack": s} for i, (p, s) in enumerate(zip(positions, stacks))],
        streets=[
            {"street": "preflop", "actions": [
                {"seat": 0, "action": "post", "amount": 5}, {"seat": 1, "action": "post", "amount": 10},
                {"seat": 2, "action": "fold"}, {"seat": 3, "action": "raise", "amount": 30},
                {"seat": 4, "action": "fold"}, {"seat": 5, "action": "fold"}, {"seat": 6, "action": "fold"},
                {"seat": 7, "action": "fold"}, {"seat": 8, "action": "fold"},
                {"seat": 0, "action": "call", "amount": 25}, {"seat": 1, "action": "fold"},
            ]},
            {"street": "flop", "board": ["Qh", "7s", "2c"], "pot": 70, "actions": [
                {"seat": 0, "action": "check"}, {"seat": 3, "action": "raise", "amount": 40}, {"seat": 0, "action": "call", "amount": 40},
            ]},
            {"street": "turn", "board": ["Qh", "7s", "2c", "9d"], "pot": 150, "actions": [
                {"seat": 0, "action": "raise", "amount": 100},
            ]},
        ],
        seat=3, position="UTG+1", hole_cards=["As", "Kd"], pot=250, to_call=100, stack=1130,
        legal_actions=[
            {"type": "FOLD"}, {"type": "CALL", "amount": 100}, {"type": "RAISE", "min": 200, "max": 1130},
            {"type": "ALL-IN", "amount": 1130},
        ],
    )


def short_stack_request() -> DecisionRequest:
    """A 60-chip stack facing a 200 raise: calling is all-in. The engine lists CALL (the last
    60 chips) beside the ALL-IN (65, the street total)."""
    seats = [dict(s) for s in SEATS]
    for s in seats:
        s["stack"] = {7: 1953, 8: 1990, 0: 60, 1: 1800}.get(s["seat"], s["stack"])
    return DecisionRequest(
        player_name="Phi-4", small_blind=5, big_blind=10, seats=seats,
        streets=[{"street": "preflop", "actions": BLINDS + [
            {"seat": 0, "action": "fold"}, {"seat": 1, "action": "raise", "amount": 200},
            {"seat": 2, "action": "fold"}, {"seat": 3, "action": "fold"}, {"seat": 4, "action": "fold"},
            {"seat": 5, "action": "fold"}, {"seat": 6, "action": "fold"},
        ]}],
        seat=7, position="SB", hole_cards=["Qh", "Qs"], pot=215, to_call=195, stack=60,
        legal_actions=[{"type": "FOLD"}, {"type": "CALL", "amount": 60}, {"type": "ALL-IN", "amount": 65}],
    )


def short_raise_request() -> DecisionRequest:
    """150 behind facing a raise to 100 with 50 more to call: too short to min-raise, so the only
    raise is the all-in."""
    return with_(preflop_request(), stack=150, to_call=100, legal_actions=[
        {"type": "FOLD"}, {"type": "CALL", "amount": 100}, {"type": "ALL-IN", "amount": 150},
    ])
