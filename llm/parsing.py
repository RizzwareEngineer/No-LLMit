"""Turns an LLM's raw text reply into an action the engine understands.

The reply format is three lines: ACTION, AMOUNT, REASON. The parser holds a reply to that
format and is lenient only about dress (markdown, case, list numbers, quotes, spellings of
the all-in, commas in numbers). A reply is read as the move it states or as a miss that
gets the one retry; never as a different move. Every leniency beyond dress has turned out
to play some reply as a move its author did not make, so:

- a label counts only at the start of a line, and a reply holds one answer: two ACTION
  lines that differ are a miss (a draft and a plan look the same from here);
- the ACTION line is only the move, with a size if it is a bet or raise: "call - actually
  all-in", "call the raise" and "fold (too weak)" are misses;
- a size is one whole number of chips, on the AMOUNT line or right after the word; big
  blinds, multiples, percentages, signs, decimals, arithmetic and two sizes that differ
  are a miss.
"""

import re

MAX_REPLY = 20_000  # characters: far more than the token limit lets a reply hold
MAX_VALUE = 300  # characters of a field that are matched, so no reply can make a regex slow
MAX_AMOUNT = 2_000_000_000  # fits the engine's integer whatever a model writes

# Why a reply is a miss, in words the retry message can show the model.
NO_ACTION = "no ACTION line was found"
ONLY_THE_MOVE = "the ACTION line must be only the move: fold, check, call, bet, raise or all-in (a bet or raise may carry its size)"
ONE_ACTION = "the reply must hold one ACTION line"
TOO_LONG = "the reply must be three short lines"
NO_SIZE = "a bet or raise needs its size on the AMOUNT line"
ONE_NUMBER = "AMOUNT must be one whole number of chips"
NOT_CHIPS = "AMOUNT must be in chips, not big blinds, a multiple or a percentage"
TWO_SIZES = "ACTION and AMOUNT give two different sizes"

# "all-in", "all in", "allin", "ALL_IN", with any hyphen or space a model may emit: the
# Unicode hyphens and dashes (U+2010 to U+2015), the minus sign and the no-break spaces.
JOINERS = "".join(map(chr, [*range(0x2010, 0x2016), 0x2212, 0x00A0, 0x202F]))
ALL_IN = rf"all[ _\-{JOINERS}]?in"
# A number of chips, and what may follow it that makes it something else ("12 BB", "3x", "75%").
SIZE = (r"(?P<int>\d{1,3}(?:,\d{3})+|\d+)(?P<frac>\.\d+)?"
        r"(?:[ \t]*[x×*]?[ \t]*(?P<unit>BB'?s?\b|(?:big[ \t-]+)?blinds?\b|x\b|×|%))?")
ANY_NUMBER = r"\$?\d[\d,]*(?:\.\d+)?"
# Dress around a value: symbols before it (quotes, brackets, emoji; never a sign or a "$",
# which belong to the number); after it "chips" or "total", a parenthetical that holds only
# a size ("(1,130)", "(3x)", "(30 BB)"), and symbols again.
OPEN = rf"[^\w\n+\-{chr(0x2212)}$]*"
NOTE = rf"\((?:[\d,.$%×x \t]|chips?|BBs?|total|{ALL_IN})*\)"
END = rf"(?:[ \t]*(?:chips?|total|in[ \t]+total)\b)*(?:[ \t]*{NOTE})?[^\w\n]*"
# A field label at the start of a line, after list or quote marks: "ACTION: ...", "2. AMOUNT: ...".
LABEL_RE = re.compile(r"[^\w\n]*(?:\d+[.)][ \t]*)?(ACTION|AMOUNT|REASON)[ \t]*:[ \t]*(.*)", re.I)
# The whole ACTION value. "raise all-in", "bet all-in", "raise to all-in" and "go all-in" are
# the all-in. "call all-in" is a call: decide.check_legal makes it the all-in when the bet
# covers the stack, so "call the all-in" never shoves over a smaller bet.
ACTION_RE = re.compile(
    OPEN + r"(?:"
    rf"(?P<shove>(?:(?:raise|bet)[ \t]+(?:to[ \t]+)?\(?[ \t]*|go(?:ing)?[ \t]+)?{ALL_IN}\b\)?)(?:[ \t]+(?:for|to|of)\b)?(?:[ \t:=]*{ANY_NUMBER})?"
    rf"|(?P<call>call)\b(?:[ \t]+(?:(?:the|his|her|this|that)[ \t]+)?{ALL_IN}\b)?(?:[ \t:=]*{ANY_NUMBER})?"
    r"|(?P<passive>fold|check)\b(?:[ \t:=]*\$?0\b)?"
    rf"|(?P<sized>bet|raise)\b(?:[ \t:=]*(?:to\b[ \t]*)?\$?{SIZE})?"
    r")" + END, re.I)
# The whole AMOUNT value of a bet or raise: "300", "$1,130", "raise to 300", "300 chips (3x)".
AMOUNT_RE = re.compile(OPEN + r"(?:(?:raise|bet)[ \t]+)?(?:to[ \t]+)?\$?" + SIZE + END, re.I)
AMOUNT_ALL_IN_RE = re.compile(OPEN + ALL_IN + r"\b" + END, re.I)
INLINE_REASON_RE = re.compile(r"\bREASON[ \t]*:", re.I)
INLINE_AMOUNT_RE = re.compile(r"\bAMOUNT[ \t]*:", re.I)


# Characters that are no part of the text: NUL, the byte-order mark and zero-width marks go;
# the no-break and ideographic spaces are spaces.
INVISIBLE = {0: None, 0xFEFF: None, 0x200B: None, 0x200C: None, 0x200D: None, 0x2060: None, 0xA0: " ", 0x202F: " ", 0x3000: " "}


def strip_markdown(text: str) -> str:
    """Drop fences, emphasis, inline code, list bullets and invisible characters so
    "**ACTION:** `CALL`" reads as "ACTION: CALL". A * between two digits is arithmetic and
    stays ("2*60" is not 260)."""
    def emphasis(m: re.Match) -> str:
        between_digits = m.start() > 0 and text[m.start() - 1].isdigit() and text[m.end():m.end() + 1].isdigit()
        return m.group(0) if between_digits and "*" in m.group(0) else ""

    text = text.translate(INVISIBLE)
    text = re.sub(r"<br[ \t]*/?>", "\n", text, flags=re.I)
    text = re.sub(r"^```\w*[ \t]*$", "", text, flags=re.M)
    text = re.sub(r"[*_`#]+", emphasis, text)
    return re.sub(r"^[ \t]*[-•][ \t]+", "", text, flags=re.M)


def _move(said: str) -> tuple[str, re.Match] | None:
    """The move an ACTION value is, or None when it is anything but a move."""
    m = ACTION_RE.fullmatch(said) if len(said) <= MAX_VALUE else None
    if not m:
        return None
    if m.group("shove"):
        return "ALL_IN", m
    if m.group("call"):
        return "CALL", m
    return (m.group("passive").upper() if m.group("passive") else "RAISE"), m


def _size(m: re.Match) -> tuple[int, str]:
    """The chips a number stands for, or why it is not a whole number of chips."""
    digits = m.group("int").replace(",", "")
    if m.group("unit"):
        return 0, NOT_CHIPS
    if not re.fullmatch(r"(?:\.0{1,2})?", m.group("frac") or ""):
        return 0, ONE_NUMBER  # "12.5"; "20.000" may be twenty or twenty thousand
    return (int(digits) if len(digits) <= 15 else MAX_AMOUNT), ""


def _text(lines: list[str], field: tuple[str, str, int]) -> str:
    """A field's value; a label alone on its line takes the next line that has text."""
    _, value, at = field
    if not value.strip():
        value = next((line for line in lines[at + 1:] if line.strip()), "")
        if LABEL_RE.match(value):
            return ""
    return value


def _reason_lines(lines: list[str], at: int) -> list[int]:
    """The lines a REASON at `at` runs on to: up to a blank line or another field."""
    out = []
    for i in range(at + 1, len(lines)):
        if not lines[i].strip() or LABEL_RE.match(lines[i]):
            break
        out.append(i)
    return out


def parse_response(text: str) -> dict:
    """Parse LLM response into structured action.

    `problem` says why an unparseable reply could not be read; `size_problem` why a bet or
    raise has no usable size (decide.check_legal reports it as illegal); `complete` is
    whether the answer ends with its REASON (a reply the token limit cut off does not)."""
    result = {"action": "FOLD", "amount": 0, "reason": "", "raw": text, "status": "ok",
              "problem": "", "size_problem": "", "complete": False}

    def miss(problem: str) -> dict:
        # The FOLD is our placeholder, not the model's choice.
        result.update(action="FOLD", amount=0, status="unparseable", problem=problem)
        return result

    if len(text) > MAX_REPLY:
        return miss(TOO_LONG)
    lines = strip_markdown(text).splitlines()
    fields = [(m.group(1).upper(), m.group(2), i) for i, line in enumerate(lines) if (m := LABEL_RE.match(line))]
    actions = [f for f in fields if f[0] == "ACTION"]
    amounts: list[str] = []  # every AMOUNT value that belongs to the answer
    reason_at = None  # the line the answer's REASON starts on

    if actions:
        # One answer. Several ACTION lines that say the same thing are a repeat; if they
        # differ, a draft before the answer and a plan after it cannot be told apart.
        values = []
        for f in actions:
            said = _text(lines, f)
            inline_reason = None
            if m := INLINE_REASON_RE.search(said):  # the one-line reply: "ACTION: fold | AMOUNT: 0 | REASON: why"
                said, inline_reason = said[:m.start()], said[m.end():].strip()
            inline_amount = None
            if m := INLINE_AMOUNT_RE.search(said):
                said, inline_amount = said[:m.start()], said[m.end():]
            values.append((said, inline_amount, inline_reason))
        moves = [_move(v[0]) for v in values]
        if len({(mv[0], mv[1].group("int")) if mv else v[0].strip().lower() for mv, v in zip(moves, values)}) > 1:
            return miss(ONE_ACTION)
        move, (_, inline_amount, inline_reason), at = moves[-1], values[-1], actions[-1][2]
        if inline_amount is not None:
            amounts.append(inline_amount)
        # Its fields follow it; a lone ACTION line may also come after a field it lacks below
        # ("AMOUNT: 300 / ACTION: raise"), but never takes both an earlier and a later one.
        own = [f for f in fields if f[2] > at]
        if len(actions) == 1:
            own += [f for f in fields if f[2] < at and f[0] not in {g[0] for g in own}]
        if inline_reason is not None:
            result["reason"], reason_at = inline_reason, at
    else:
        # No label: only a first line that is the move alone counts ("RAISE: 150", "all in"),
        # and nothing else may be said outside labelled fields ("Call. Actually no, fold.").
        at = next((i for i, line in enumerate(lines) if line.strip()), 0)
        move = _move(lines[at]) if lines else None
        own = fields
        accounted = {at} | {f[2] for f in fields} | {i for f in fields if f[0] == "REASON" for i in _reason_lines(lines, f[2])}
        if any(line.strip() and i not in accounted for i, line in enumerate(lines)):
            move = None
    if not move:
        return miss(ONLY_THE_MOVE if actions else NO_ACTION)
    action, said = move

    for f in own:
        value = _text(lines, f)
        if f[0] == "AMOUNT":
            if m := INLINE_REASON_RE.search(value):  # "AMOUNT: 300 | REASON: value"
                value, tail = value[:m.start()], value[m.end():].strip()
                if reason_at is None:
                    result["reason"], reason_at = tail, f[2]
            amounts.append(value)
        elif f[0] == "REASON" and reason_at is None:
            result["reason"] = "\n".join([f[1]] + [lines[i] for i in _reason_lines(lines, f[2])]).strip()
            reason_at = f[2]
    # No REASON stays empty: never put words in the model's mouth. The answer is complete
    # when it ends with its REASON: no field of the reply comes after it.
    result["complete"] = reason_at is not None and reason_at >= at and not any(f[2] > reason_at for f in fields)

    amounts = [a for a in amounts if a.strip()]
    if action == "RAISE":
        sizes, problems, shove = [], [], False
        if said.group("int"):
            sizes.append(_size(said))
        for value in amounts:
            if len(value) > MAX_VALUE:
                problems.append(ONE_NUMBER)
            elif AMOUNT_ALL_IN_RE.fullmatch(value):
                shove = True  # "ACTION: raise / AMOUNT: all-in"
            elif stated := AMOUNT_RE.fullmatch(value):
                sizes.append(_size(stated))
            else:
                problems.append(ONE_NUMBER)  # "2*60 = 120", "200 more", "+200"
        problems += [p for _, p in sizes if p]
        chips = {n for n, p in sizes if not p}
        if problems:
            result["size_problem"] = problems[0]
        elif shove and not chips:
            action = "ALL_IN"
        elif shove or len(chips) > 1:
            result["size_problem"] = TWO_SIZES
        elif not chips:
            result["size_problem"] = NO_SIZE
        else:
            result["amount"] = min(chips.pop(), MAX_AMOUNT)
    elif amounts and (stated := re.match(r"[^\w\n$]*\$?(\d[\d,]*)", amounts[0][:MAX_VALUE])):
        # A fold, check, call or all-in has no size to get wrong; the number is kept as written.
        digits = stated.group(1).replace(",", "")
        result["amount"] = min(int(digits), MAX_AMOUNT) if len(digits) <= 15 else MAX_AMOUNT
    result["action"] = action
    return result
