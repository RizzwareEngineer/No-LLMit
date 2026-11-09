"""The two prompts every model receives: the system prompt (fixed) and the user prompt
rendered from the game state the engine sends for each turn, in hand-history style. No
model name appears in either; players are "Player N (POS)" where N is the seat number.

The About page shows copies from web/src/lib/systemPrompt.ts; tests/test_prompts.py keeps
them equal to what this file produces.
"""

import hashlib
from pathlib import Path

from schemas import DecisionRequest, StreetAction

system_prompt = """You are an expert No-Limit Texas Hold'em player in a 9-handed cash game.

Each message is one decision. It gives you, in order:
1. The blinds and your opponents' stacks
2. Your stack, your position and your hand
3. The action so far, street by street, with the pot after each
4. Your legal actions

Reply in exactly three plain-text lines, no markdown:
ACTION: fold, check, call, bet, raise or all-in
AMOUNT: for bet or raise, the total you make it; otherwise 0
REASON: one or two sentences"""

STREET_TITLES = {"preflop": "Preflop", "flop": "Flop", "turn": "Turn", "river": "River"}


def _n(chips: int) -> str:
    return f"{chips:,}"


def _bb(chips: int, big_blind: int) -> str:
    """Chips in big blinds, one decimal at most: 15 -> 1.5, 20 -> 2."""
    return f"{chips / big_blind:.1f}".rstrip("0").rstrip(".")


def _stack(chips: int, big_blind: int) -> str:
    return f"{_n(chips)} ({_bb(chips, big_blind)} BB)"


def _player(seat: int, position: str) -> str:
    return f"Player {seat + 1} ({position})"


def _street_bet(actions: list[StreetAction]) -> int:
    """The largest bet on the street so far: blinds, bets, raises and all-ins count, calls do not."""
    return max((a.amount for a in actions if a.action in ("post", "raise", "all_in")), default=0)


def bet_word(r: DecisionRequest) -> str:
    """"bet" when nothing has been bet on the current street, else "raise" (the blinds count,
    so the big blind's preflop option raises, as the action line says)."""
    return "bet" if _street_bet(r.streets[-1].actions) == 0 else "raise"


def render_legal_actions(r: DecisionRequest) -> str:
    """One line in a fixed order: fold, check, call N, bet N–M or raise to N–M, then the
    all-in. "call N" is chips added; bet, raise and all-in amounts are street totals. When
    the bet covers the stack, the call and the all-in are the same move: "call all-in N",
    N being the whole stack."""
    legal = {a.type.replace("-", "_"): a for a in r.legal_actions}
    word, covered = bet_word(r), r.to_call >= r.stack
    parts = []
    if "FOLD" in legal:
        parts.append("fold")
    if "CHECK" in legal:
        parts.append("check")
    if "CALL" in legal and not covered:
        parts.append(f"call {_n(legal['CALL'].amount)}")
    if sizing := legal.get("BET") or legal.get("RAISE"):
        parts.append(f"{word}{' to' if word == 'raise' else ''} {_n(sizing.min)}–{_n(sizing.max)}")
    if "ALL_IN" in legal:
        parts.append(f"call all-in {_n(r.stack)}" if covered else f"{word} all-in {_n(legal['ALL_IN'].amount)}")
    return ", ".join(parts)


def render_user_prompt(r: DecisionRequest) -> str:
    bb = r.big_blind
    pos = {s.seat: s.position for s in r.seats}
    lines = [f"Blinds {_n(r.small_blind)}/{_n(bb)}.", "", "Opponents:"]
    lines += [f"{_player(s.seat, s.position)}: {_stack(s.stack, bb)}" for s in r.seats if s.seat != r.seat]
    lines += ["", f"You are {_player(r.seat, r.position)}, {_stack(r.stack, bb)}, holding {' '.join(r.hole_cards)}.", ""]

    for i, st in enumerate(r.streets):
        title = STREET_TITLES.get(st.street, st.street)
        if i > 0:  # the cards dealt on this street
            title += f" [{' '.join(st.board[len(r.streets[i - 1].board):])}]"
        parts, street_bet = [], 0
        for a in st.actions:
            who = _player(a.seat, pos.get(a.seat, "?"))
            if a.action == "post":
                parts.append(f"{who} posts {_n(a.amount)}")
            elif a.action == "fold":
                parts.append(f"{who} folds")
            elif a.action == "check":
                parts.append(f"{who} checks")
            elif a.action == "call":
                parts.append(f"{who} calls {_n(a.amount)}")
            elif a.action == "raise":
                parts.append(f"{who} {'bets' if street_bet == 0 else 'raises to'} {_n(a.amount)}")
            elif a.action == "all_in":
                parts.append(f"{who} all-in for {_n(a.amount)}")
            if a.action != "call":
                street_bet = max(street_bet, a.amount)
        # The pot after this street's actions so far: the next street's starting pot, or the current pot.
        pot = r.streets[i + 1].pot if i + 1 < len(r.streets) else r.pot
        lines.append(f"{title}: {', '.join(parts) if parts else 'no action yet'}. Pot {_n(pot)}.")

    lines += ["", f"Legal actions: {render_legal_actions(r)}."]
    return "\n".join(lines)


def render_retry_prompt(problem: str, request: DecisionRequest) -> str:
    """The one follow-up message after an invalid reply."""
    return (f"That reply wasn't legal: {problem}. "
            f"Reply again in the three-line format with one of: {render_legal_actions(request)}.")


# One version for the system prompt, the user prompt template (this file) and the parser.
# Any change to either file starts a new version; hands record it on every decision.
_here = Path(__file__).parent
prompt_version = hashlib.sha256(
    (_here / "prompts.py").read_bytes() + (_here / "parsing.py").read_bytes()
).hexdigest()[:7]
