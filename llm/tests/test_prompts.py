import re
from pathlib import Path

from conftest import flop_request, preflop_request, short_stack_request, with_
from prompts import prompt_version, render_retry_prompt, render_user_prompt, system_prompt
from registry import MODELS

WEB_PROMPTS = Path(__file__).resolve().parents[2] / "web" / "src" / "lib" / "systemPrompt.ts"

PREFLOP = """Blinds 5/10 (1 BB = 10 chips).

Seats, current stacks:
Player 8 (SB): 1953 (195.3 BB)
Player 9 (BB): 1990 (199 BB)
Player 1 (UTG): 2057 (205.7 BB)
Player 2 (UTG+1): 2000 (200 BB)
Player 3 (MP): 2000 (200 BB)
Player 4 (MP+1): 2000 (200 BB)
Player 5 (HJ): 2000 (200 BB)
Player 6 (CO): 1990 (199 BB)
Player 7 (BTN): 1995 (199.5 BB)

Preflop: Player 8 (SB) posts small blind 5 (0.5 BB), Player 9 (BB) posts big blind 10 (1 BB)

You are Player 1 (UTG). Your hole cards: Ks 4d.
Pot: 15 (1.5 BB). To call: 10 (1 BB). Your stack: 2057 (205.7 BB).

Legal actions:
- FOLD
- CALL 10 (1 BB)
- RAISE 20 to 2057 (2 to 205.7 BB)
- ALL_IN"""

FLOP_TAIL = """Preflop: Player 8 (SB) posts small blind 5 (0.5 BB), Player 9 (BB) posts big blind 10 (1 BB), Player 1 (UTG) folds, Player 2 (UTG+1) folds, Player 3 (MP) folds, Player 4 (MP+1) folds, Player 5 (HJ) folds, Player 6 (CO) folds, Player 7 (BTN) raises to 30 (3 BB), Player 8 (SB) calls 25 (2.5 BB), Player 9 (BB) calls 20 (2 BB)
Flop [Ah 7d 2c], pot 90 (9 BB): Player 8 (SB) checks, Player 9 (BB) checks, Player 7 (BTN) bets 40 (4 BB), Player 8 (SB) folds

You are Player 9 (BB). Your hole cards: Ad Tc.
Pot: 130 (13 BB). To call: 40 (4 BB). Your stack: 1970 (197 BB).

Legal actions:
- FOLD
- CALL 40 (4 BB)
- RAISE 80 to 1970 (8 to 197 BB)
- ALL_IN"""


def test_preflop_golden():
    assert render_user_prompt(preflop_request()) == PREFLOP


def test_flop_golden():
    prompt = render_user_prompt(flop_request())
    assert prompt.endswith(FLOP_TAIL)
    assert "Player 8 (SB): 1930 (193 BB)" in prompt  # current stack, not the hand's start


def test_all_in_call_is_marked():
    prompt = render_user_prompt(short_stack_request())
    assert "- CALL 60 (6 BB), all-in" in prompt
    assert "Your stack: 60 (6 BB)" in prompt


def test_postflop_first_bet_street_has_no_action_yet():
    r = flop_request()
    r = with_(r, streets=r.model_dump()["streets"] + [{"street": "turn", "board": ["Ah", "7d", "2c", "Kc"], "pot": 170}])
    assert "\nTurn [Ah 7d 2c Kc], pot 170 (17 BB): no action yet\n" in render_user_prompt(r)


def test_no_model_name_or_hand_number_anywhere():
    for text in (system_prompt, render_user_prompt(preflop_request()), render_user_prompt(flop_request())):
        assert "Hand #" not in text and "Still in the hand" not in text
        for name, slug in MODELS.items():
            assert name not in text and slug not in text
        for word in ("GPT", "Claude", "Gemma", "Llama", "Mistral", "DeepSeek", "Phi", "Qwen", "Cohere"):
            assert word not in text


def test_retry_prompt_names_the_problem_and_the_legal_list():
    text = render_retry_prompt("CHECK is not legal here: there is 10 to call", preflop_request())
    assert text.startswith("Your reply was invalid: CHECK is not legal here: there is 10 to call.")
    assert "- CALL 10 (1 BB)\n- RAISE 20 to 2057 (2 to 205.7 BB)\n- ALL_IN" in text


def test_version_is_a_short_hash():
    assert re.fullmatch(r"[0-9a-f]{7}", prompt_version)


def _web_export(name: str) -> str:
    src = WEB_PROMPTS.read_text()
    match = re.search(rf"export const {name} = `(.*?)`;", src, re.S)
    assert match, f"{name} not found in {WEB_PROMPTS}"
    return match.group(1)


def test_web_copies_match():
    """The About page shows these; they must be what the models really get."""
    assert _web_export("SYSTEM_PROMPT") == system_prompt
    assert _web_export("EXAMPLE_USER_PROMPT") == render_user_prompt(flop_request())
    assert _web_export("EXAMPLE_REPLY").startswith("ACTION: ")
