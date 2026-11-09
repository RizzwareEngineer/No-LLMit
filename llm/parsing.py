"""Turns an LLM's raw text reply into an action the engine understands.

The reply format is three lines: ACTION, AMOUNT, REASON. The parser is strict about that
structure and lenient only about dress (markdown, case, spellings of the all-in, commas in
numbers). A reply is read as the move it states or as a miss that gets the one retry
("unparseable", or a bet whose size cannot be used); never as a different move. So:

- a label counts only at the start of a line: prose that says "the next action: fold" is
  not an answer;
- the ACTION line holds one move: "call would be too loose, so I fold" is a miss;
- a bet or raise takes its size from a clean AMOUNT line or from right after the word
  ("raise to 300"): arithmetic, two numbers, big blinds, multiples and percentages are a miss.
"""

import re

MAX_REPLY = 20_000  # characters read: far more than the token limit lets a reply hold
MAX_VALUE = 300  # characters of a field that are matched, so no reply can make a regex slow
MAX_AMOUNT = 2_000_000_000  # fits the engine's integer whatever a model writes

NO_ACTION = "no ACTION line was found"
NOT_A_MOVE = "the ACTION line did not say fold, check, call, bet, raise or all-in"
ONE_MOVE = "the ACTION line must hold one move and nothing that names another"
NO_SIZE = "a bet or raise needs its size on the AMOUNT line"
ONE_NUMBER = "AMOUNT must be one whole number of chips"
NOT_CHIPS = "AMOUNT must be in chips, not big blinds, a multiple or a percentage"

MOVES = "fold|check|call|bet|raise"
# "all-in", "all in", "allin", "ALL_IN", with any hyphen or space a model may emit.
ALL_IN = r"all[ _\-‐-―−  ]?in"
PARENS = r"\([^()\n]*\)"
# A number, and what may follow it that makes it something other than whole chips.
NUMBER = (r"(?P<int>\d{1,3}(?:,\d{3})+|\d+)(?P<frac>\.\d+)?"
          r"(?:[ \t]*[x×*]?[ \t]*(?P<unit>BB'?s?\b|(?:big[ \t-]+)?blinds?\b|x\b|×|%))?")
# A field label at the start of a line, after list or quote marks: "ACTION: ...", "2. AMOUNT: ...".
LABEL_RE = re.compile(r"[^\w\n]*(?:\d+[.)][ \t]*)?(ACTION|AMOUNT|REASON)[ \t]*:[ \t]*(.*)", re.I)
# What an answer starts with. "raise all-in", "bet all-in", "raise to all-in" and "go all-in"
# are the all-in. "call all-in" is a call: decide.check_legal makes it the all-in when the
# bet covers the stack, so "call the all-in" never shoves over a smaller bet.
MOVE_RE = re.compile(
    rf"[^\w\n]*(?:(?P<shove>(?:(?:raise|bet)[ \t]+(?:to[ \t]+)?\(?[ \t]*|go(?:ing)?[ \t]+)?{ALL_IN}\b\)?)"
    rf"|(?P<word>{MOVES})\b)", re.I)
# After the all-in only its size may follow: "all in all, calling is fine" is not a shove.
SHOVE_REST_RE = re.compile(r"[^\w\n$]*(?:(?:for|to|of)\b[^\w\n$]*)?(?:\$?\d[\d,]*(?:[ \t]*chips?\b)?)?[^\w\n]*", re.I)
# The size right after the word on the ACTION line: "raise to 300", "bet $40", "RAISE: 150".
SIZE_RE = re.compile(rf"[^\w\n$]*(?:to\b[^\w\n$]*)?\$?{NUMBER}", re.I)
# The AMOUNT line of a bet or raise: one number, as "300", "$1,130", "raise to 300", "300 chips (3x)".
AMOUNT_RE = re.compile(
    rf"[^\w\n$]*(?:(?:raise|bet)[ \t]+)?(?:to[ \t]+)?\$?{NUMBER}(?:[ \t]*(?:chips?|total|in[ \t]+total)\b)*"
    rf"[^\w\n]*(?:{PARENS}[^\w\n]*)?", re.I)
AMOUNT_ALL_IN_RE = re.compile(rf"[^\w\n]*{ALL_IN}\b[^\w\n]*(?:{PARENS}[^\w\n]*)?", re.I)


def strip_markdown(text: str) -> str:
    """Drop fences, emphasis, inline code and list bullets so "**ACTION:** `CALL`" reads as
    "ACTION: CALL". A * between two digits is arithmetic and stays ("2*60" is not 260)."""
    def emphasis(m: re.Match) -> str:
        between_digits = m.start() > 0 and text[m.start() - 1].isdigit() and text[m.end():m.end() + 1].isdigit()
        return m.group(0) if between_digits and "*" in m.group(0) else ""

    text = re.sub(r"<br[ \t]*/?>", "\n", text, flags=re.I)
    text = re.sub(r"^```\w*[ \t]*$", "", text, flags=re.M)
    text = re.sub(r"[*_`#]+", emphasis, text)
    return re.sub(r"^[ \t]*[-•][ \t]+", "", text, flags=re.M)


def _size(m: re.Match) -> tuple[int, str]:
    """The chips a number stands for, or why it is not a whole number of chips."""
    digits = m.group("int").replace(",", "")
    if m.group("unit"):
        return 0, NOT_CHIPS
    if (m.group("frac") or "").strip(".0"):
        return 0, ONE_NUMBER  # "12.5"
    return (int(digits) if len(digits) <= 15 else MAX_AMOUNT), ""


def _text(lines: list[str], field: tuple[str, str, int] | None) -> str | None:
    """A field's value; a label alone on its line takes the next line that has text."""
    if field is None:
        return None
    _, value, at = field
    if not value.strip():
        value = next((line for line in lines[at + 1:] if line.strip()), "")
        if LABEL_RE.match(value):
            return ""
    return value


def _reason(lines: list[str], field: tuple[str, str, int]) -> str:
    """REASON can be multiline: everything up to a blank line or another field."""
    out = [field[1]]
    for line in lines[field[2] + 1:]:
        if not line.strip() or LABEL_RE.match(line):
            break
        out.append(line)
    return "\n".join(out).strip()


def parse_response(text: str) -> dict:
    """Parse LLM response into structured action.

    `problem` says why an unparseable reply could not be read; `size_problem` why a bet or
    raise has no usable size (decide.check_legal reports it as illegal); `complete` is
    whether the answer ends with its REASON (a reply the token limit cut off does not)."""
    result = {"action": "FOLD", "amount": 0, "reason": "", "raw": text, "status": "ok",
              "problem": "", "size_problem": "", "complete": False}
    lines = strip_markdown(text[:MAX_REPLY]).splitlines()
    fields = [(m.group(1).upper(), m.group(2), i) for i, line in enumerate(lines) if (m := LABEL_RE.match(line))]
    actions = [f for f in fields if f[0] == "ACTION"]
    amount_text = None

    def field(label: str, after: int, anywhere: bool):
        """The answer's own field: the first one after its ACTION; a lone answer may also follow its fields."""
        found = next((f for f in fields if f[0] == label and f[2] > after), None)
        return found or (next((f for f in fields if f[0] == label), None) if anywhere else None)

    if actions:
        # The last ACTION line is the answer: a model that thinks out loud may write earlier
        # ones. An earlier draft's AMOUNT and REASON are never borrowed.
        at, alone = actions[-1][2], len(actions) == 1
        said = _text(lines, actions[-1]) or ""
        # The one-line reply: "ACTION: fold | AMOUNT: 0 | REASON: why".
        inline_reason = None
        if m := re.search(r"\bREASON[ \t]*:", said, re.I):
            said, inline_reason = said[:m.start()], said[m.end():].strip()
        if m := re.search(r"\bAMOUNT[ \t]*:", said, re.I):
            said, amount_text = said[:m.start()], said[m.end():]
        if amount_text is None:
            amount_text = _text(lines, field("AMOUNT", at, alone))
        reason_field = field("REASON", at, alone)
        if inline_reason is not None:
            result["reason"], result["complete"] = inline_reason, True
        elif reason_field:
            result["reason"], result["complete"] = _reason(lines, reason_field), reason_field[2] > at
    else:
        # No label: only a first line that is the move alone counts ("RAISE: 150", "all in").
        said = next((line for line in lines if line.strip()), "")
        amount_text = _text(lines, field("AMOUNT", -1, False))
        if reason_field := field("REASON", -1, False):
            result["reason"], result["complete"] = _reason(lines, reason_field), True

    def miss(problem: str) -> dict:
        # The FOLD is our placeholder, not the model's choice.
        result.update(action="FOLD", amount=0, status="unparseable", problem=problem)
        return result

    said = said[:MAX_VALUE]
    not_a_move, one_move = (NOT_A_MOVE, ONE_MOVE) if actions else (NO_ACTION, NO_ACTION)
    move = MOVE_RE.match(said)
    if not move:
        return miss(not_a_move)
    rest = said[move.end():]
    outside = re.sub(PARENS, " ", rest)  # what the line goes on to say, parentheses aside
    size = SIZE_RE.match(rest)
    if move.group("shove"):
        if not SHOVE_REST_RE.fullmatch(outside):
            return miss(one_move)
        action = "ALL_IN"
    else:
        if re.search(rf"\b(?:{MOVES})\b", outside, re.I):
            return miss(one_move)  # "call would be too loose here, so I fold"
        action = "RAISE" if move.group("word").upper() in ("BET", "RAISE") else move.group("word").upper()
        if not actions and not re.fullmatch(r"(?:[ \t]*chips?\b)?[^\w\n]*", rest[size.end():] if size else rest):
            return miss(NO_ACTION)  # "Call. The pot odds are good." is prose, not the label-less form

    amount_text = (amount_text or "")[:MAX_VALUE]
    if action == "RAISE":
        if amount_text.strip():
            if AMOUNT_ALL_IN_RE.fullmatch(amount_text):
                action = "ALL_IN"  # "ACTION: raise / AMOUNT: all-in"
            elif stated := AMOUNT_RE.fullmatch(amount_text):
                result["amount"], result["size_problem"] = _size(stated)
            else:
                result["size_problem"] = ONE_NUMBER  # "2*60 = 120", "200 more, 300 total"
        elif size and not re.search(r"\d", re.sub(PARENS, " ", rest[size.end():])):
            result["amount"], result["size_problem"] = _size(size)
        else:
            result["size_problem"] = ONE_NUMBER if size else NO_SIZE  # "raise to 200–1,130"
    elif stated := re.match(r"[^\w\n$]*\$?(\d[\d,]*)", amount_text):
        # A fold, check, call or all-in has no size to get wrong; the number is kept as written.
        digits = stated.group(1).replace(",", "")
        result["amount"] = min(int(digits), MAX_AMOUNT) if len(digits) <= 15 else MAX_AMOUNT
    result["action"] = action
    result["amount"] = min(result["amount"], MAX_AMOUNT)
    return result
