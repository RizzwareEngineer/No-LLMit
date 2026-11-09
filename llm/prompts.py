"""The two prompts every model receives: the system prompt (fixed) and the user prompt
rendered from the game state the engine sends for each turn. No model name appears in
either; players are "Player N (POS)" where N is the seat number.

The About page shows copies from web/src/lib/systemPrompt.ts; tests/test_prompts.py keeps
them equal to what this file produces.
"""

import hashlib
from pathlib import Path

from schemas import DecisionRequest, LegalAction

system_prompt = """You are playing No-Limit Texas Hold'em, a 9-handed cash game.

RULES
- Amounts are chips, with big blinds (BB) in parentheses.
- Cards: rank 2-9, T, J, Q, K, A, then suit h, d, c, s.
- Seats are listed clockwise from the small blind.
- Pot includes this street's bets.
- "calls N" = chips added; "bets N", "raises to N", "all-in for N" = that player's street total.
- A raise must be at least the size of the last bet or raise.
- Short of a full call, CALL is all-in; you win from each opponent at most what you put in.
- You see only this hand: no earlier hands, opponent notes or earlier reasoning.
- An invalid reply comes back to you once with the reason; after a second, you check if free, else fold.

Reply in exactly three plain-text lines, no markdown:
ACTION: one legal action (FOLD, CHECK, CALL, BET, RAISE, ALL_IN)
AMOUNT: for BET or RAISE, your street total in chips, digits only; else 0
REASON: one or two sentences"""

STREET_TITLES = {"preflop": "Preflop", "flop": "Flop", "turn": "Turn", "river": "River"}


def _bb(chips: int, big_blind: int) -> str:
    """Chips in big blinds, one decimal at most: 15 -> 1.5, 20 -> 2."""
    return f"{chips / big_blind:.1f}".rstrip("0").rstrip(".")


def _amt(chips: int, big_blind: int) -> str:
    return f"{chips} ({_bb(chips, big_blind)} BB)"


def _player(seat: int, position: str) -> str:
    return f"Player {seat + 1} ({position})"


def render_legal_action(a: LegalAction, request: DecisionRequest) -> str:
    bb = request.big_blind
    kind = a.type.replace("-", "_")
    if kind == "CALL":
        all_in = ", all-in" if a.amount >= request.stack else ""
        return f"CALL {_amt(a.amount, bb)}{all_in}"
    if kind in ("BET", "RAISE"):
        return f"{kind} {a.min} to {a.max} ({_bb(a.min, bb)} to {_bb(a.max, bb)} BB)"
    return kind


def render_user_prompt(r: DecisionRequest) -> str:
    bb = r.big_blind
    pos = {s.seat: s.position for s in r.seats}
    lines = [f"Blinds {r.small_blind}/{bb} (1 BB = {bb} chips).", "", "Seats, current stacks:"]
    lines += [f"{_player(s.seat, s.position)}: {_amt(s.stack, bb)}" for s in r.seats]
    lines.append("")

    for st in r.streets:
        title = STREET_TITLES.get(st.street, st.street)
        if st.street != "preflop":
            title += f" [{' '.join(st.board)}], pot {_amt(st.pot, bb)}"
        parts, street_bet, posted = [], 0, 0
        for a in st.actions:
            who = _player(a.seat, pos.get(a.seat, "?"))
            if a.action == "post":
                blind = "small blind" if posted == 0 else "big blind"
                posted += 1
                parts.append(f"{who} posts {blind} {_amt(a.amount, bb)}")
            elif a.action == "fold":
                parts.append(f"{who} folds")
            elif a.action == "check":
                parts.append(f"{who} checks")
            elif a.action == "call":
                parts.append(f"{who} calls {_amt(a.amount, bb)}")
            elif a.action == "raise":
                verb = "bets" if street_bet == 0 else "raises to"
                parts.append(f"{who} {verb} {_amt(a.amount, bb)}")
            elif a.action == "all_in":
                parts.append(f"{who} all-in for {_amt(a.amount, bb)}")
            if a.action != "call":
                street_bet = max(street_bet, a.amount)
        lines.append(f"{title}: {', '.join(parts) if parts else 'no action yet'}")
    lines.append("")

    lines.append(f"You are {_player(r.seat, r.position)}. Your hole cards: {' '.join(r.hole_cards)}.")
    lines.append(f"Pot: {_amt(r.pot, bb)}. To call: {_amt(r.to_call, bb)}. Your stack: {_amt(r.stack, bb)}.")
    lines += ["", "Legal actions:"]
    lines += [f"- {render_legal_action(a, r)}" for a in r.legal_actions]
    return "\n".join(lines)


def render_retry_prompt(problem: str, request: DecisionRequest) -> str:
    """The one follow-up message after an invalid reply."""
    legal = "\n".join(f"- {render_legal_action(a, request)}" for a in request.legal_actions)
    return f"Your reply was invalid: {problem}.\nReply again in the three-line format, choosing one of:\n{legal}"


# One version for the system prompt, the user prompt template (this file) and the parser.
# Any change to either file starts a new version; hands record it on every decision.
_here = Path(__file__).parent
prompt_version = hashlib.sha256(
    (_here / "prompts.py").read_bytes() + (_here / "parsing.py").read_bytes()
).hexdigest()[:7]
