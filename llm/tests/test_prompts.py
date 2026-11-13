import hashlib
import re
from pathlib import Path

from conftest import (
    preflop_request, short_raise_request, short_stack_request, turn_check_request, turn_request, with_,
)
from prompts import prompt_version, render_legal_actions, render_retry_prompt, render_user_prompt, system_prompt
from registry import MODELS

WEB_PROMPTS = Path(__file__).resolve().parents[2] / "web" / "src" / "lib" / "systemPrompt.ts"

PREFLOP = """Blinds 5/10.

Opponents:
Player 8 (SB): 1,953 (195.3 BB)
Player 9 (BB): 1,990 (199 BB)
Player 2 (UTG+1): 2,000 (200 BB)
Player 3 (MP): 2,000 (200 BB)
Player 4 (MP+1): 2,000 (200 BB)
Player 5 (HJ): 2,000 (200 BB)
Player 6 (CO): 1,990 (199 BB)
Player 7 (BTN): 1,995 (199.5 BB)

You are Player 1 (UTG), 2,057 (205.7 BB), holding Ks 4d.

Preflop: Player 8 (SB) posts 5, Player 9 (BB) posts 10. Pot 15.

Legal actions: fold, call 10, raise to 20–2,057, raise all-in 2,057."""

# The owner's spec example, word for word.
TURN = """Blinds 5/10.

Opponents:
Player 1 (SB): 1,075 (107.5 BB)
Player 2 (BB): 970 (97 BB)
Player 3 (UTG): 1,500 (150 BB)
Player 5 (MP): 1,000 (100 BB)
Player 6 (MP+1): 1,000 (100 BB)
Player 7 (HJ): 1,000 (100 BB)
Player 8 (CO): 1,000 (100 BB)
Player 9 (BTN): 870 (87 BB)

You are Player 4 (UTG+1), 1,130 (113 BB), holding As Kd.

Preflop: Player 1 (SB) posts 5, Player 2 (BB) posts 10, Player 3 (UTG) folds, Player 4 (UTG+1) raises to 30, Player 5 (MP) folds, Player 6 (MP+1) folds, Player 7 (HJ) folds, Player 8 (CO) folds, Player 9 (BTN) folds, Player 1 (SB) calls 25, Player 2 (BB) folds. Pot 70.
Flop [Qh 7s 2c]: Player 1 (SB) checks, Player 4 (UTG+1) bets 40, Player 1 (SB) calls 40. Pot 150.
Turn [Qh 7s 2c] [9d]: Player 1 (SB) bets 100. Pot 250.

Legal actions: fold, call 100, raise to 200–1,130, raise all-in 1,130."""


def test_preflop_golden():
    assert render_user_prompt(preflop_request()) == PREFLOP


def test_turn_golden():
    assert render_user_prompt(turn_request()) == TURN


def test_unopened_street_has_no_action_yet_and_bets():
    prompt = render_user_prompt(turn_check_request())
    assert "Player 9 (BB) calls 40. Pot 170.\nTurn [Ah 7d 2c] [Kc]: no action yet. Pot 170.\n" in prompt
    assert prompt.endswith("Legal actions: fold, check, bet 10–1,930, bet all-in 1,930.")
    assert "You are Player 9 (BB), 1,930 (193 BB), holding Ad Tc." in prompt


def test_street_lines_show_the_board_so_far_then_the_new_card():
    r = turn_check_request()
    r = with_(r, streets=r.model_dump()["streets"] + [{"street": "river", "board": ["Ah", "7d", "2c", "Kc", "2s"], "pot": 170}])
    assert "\nFlop [Ah 7d 2c]: " in render_user_prompt(r)
    assert "\nTurn [Ah 7d 2c] [Kc]: no action yet. Pot 170.\nRiver [Ah 7d 2c Kc] [2s]: no action yet. Pot 170.\n" in render_user_prompt(r)


def test_covered_call_is_one_move():
    """Whether the engine lists CALL beside the ALL-IN or the ALL-IN alone, the line reads the same."""
    r = short_stack_request()
    assert render_legal_actions(r) == "fold, call all-in 60"
    assert render_legal_actions(with_(r, legal_actions=[{"type": "FOLD"}, {"type": "ALL-IN", "amount": 65}])) == "fold, call all-in 60"
    assert "You are Player 8 (SB), 60 (6 BB), holding Qh Qs." in render_user_prompt(r)


def test_all_in_alone_when_too_short_to_min_raise():
    assert render_legal_actions(short_raise_request()) == "fold, call 100, all-in 150"


def test_bet_or_raise_is_the_engines_name():
    """The word is the type the engine listed, not one worked out again from the street's actions."""
    r = turn_check_request()
    r = with_(r, legal_actions=[a if a["type"] != "BET" else {**a, "type": "RAISE"} for a in r.model_dump()["legal_actions"]])
    assert render_legal_actions(r) == "fold, check, raise to 10–1,930, raise all-in 1,930"


def test_big_blind_option_raises_rather_than_bets():
    """to_call is 0 but the blind is a bet: the engine lists the option as a RAISE."""
    actions = preflop_request().streets[0].actions + [{"seat": s, "action": "fold"} for s in range(7)] + [{"seat": 7, "action": "call", "amount": 5}]
    r = preflop_request(streets=[{"street": "preflop", "actions": actions}], seat=8, position="BB", hole_cards=["7h", "2d"],
                        pot=20, to_call=0, stack=1990,
                        legal_actions=[{"type": "FOLD"}, {"type": "CHECK"}, {"type": "RAISE", "min": 20, "max": 1990}, {"type": "ALL-IN", "amount": 1990}])
    assert render_legal_actions(r) == "fold, check, raise to 20–1,990, raise all-in 1,990"


def test_no_model_name_or_hand_number_anywhere():
    for text in (system_prompt, render_user_prompt(preflop_request()), render_user_prompt(turn_request())):
        assert "Hand #" not in text and "Still in the hand" not in text
        for name, slug in MODELS.items():
            assert name not in text and slug not in text
        for word in ("GPT", "Claude", "Gemma", "Llama", "Mistral", "DeepSeek", "Phi", "Qwen", "Cohere"):
            assert word not in text


def test_retry_prompt_names_the_problem_and_the_legal_line():
    text = render_retry_prompt("there is 10 to call, so check is not legal", preflop_request())
    assert text == ("That reply wasn't legal: there is 10 to call, so check is not legal. "
                    "Reply again in the three-line format with one of: fold, call 10, raise to 20–2,057, raise all-in 2,057.")


def test_version_is_a_short_hash():
    assert re.fullmatch(r"[0-9a-f]{7}", prompt_version)


def test_version_covers_the_legality_check_and_the_sampling_settings():
    # A new token budget or legality rule changes how models play, so it must start a new version.
    llm = Path(__file__).resolve().parents[1]
    files = ("prompts.py", "parsing.py", "decide.py", "providers/openrouter.py")
    assert prompt_version == hashlib.sha256(b"".join((llm / f).read_bytes() for f in files)).hexdigest()[:7]


def _web_export(name: str) -> str:
    src = WEB_PROMPTS.read_text()
    match = re.search(rf"export const {name} = `(.*?)`;", src, re.S)
    assert match, f"{name} not found in {WEB_PROMPTS}"
    return match.group(1)


def test_web_copies_match():
    """The About page shows these; they must be what the models really get."""
    assert _web_export("SYSTEM_PROMPT") == system_prompt
    assert _web_export("EXAMPLE_USER_PROMPT") == render_user_prompt(turn_request())
    assert re.fullmatch(r"ACTION: [a-z-]+\nAMOUNT: [\d,]+\nREASON: .+", _web_export("EXAMPLE_REPLY"))
