"""Turns an LLM's raw text reply into an action the engine understands.

A reply is read as the move it states or as a miss ("unparseable", which gets the one
retry); never as a different move. Prose that merely mentions an action is not an answer.
"""

import re

# A number and, when the model gave one, a unit that is not chips ("20 BB", "3x", "75%").
NUMBER = r"(\d[\d,]*)(?:[ \t]*(BB\b|big[ \t]+blinds?\b|x\b|%))?"
# The ACTION line, up to the end of the line or the next field ("ACTION: fold | AMOUNT: 0").
# \b on every label: "reaction:" inside a reason is not a field.
ACTION_RE = re.compile(r"\bACTION:[ \t]*(.*?)(?=[ \t]*\W*\b(?:AMOUNT|REASON):|$)", re.I | re.M)
# The first number on the AMOUNT line: "200", "$1,130", "raise to 200" all give it.
AMOUNT_RE = re.compile(rf"\bAMOUNT:[^\n\d]*{NUMBER}", re.I)
# REASON can be multiline: everything up to a blank line or another field.
REASON_RE = re.compile(r"\bREASON:\s*(.+?)(?=\n\n|\bACTION:|\bAMOUNT:|$)", re.I | re.S)
# "all-in", "all in", "allin", "ALL_IN", with any hyphen or space a model may emit.
ALL_IN = r"all[ _\-‐-―−  ]?in"
# What an answer starts with: one of the five words, or the all-in. "raise all-in" and "bet
# all-in" are the all-in. "call all-in" is a call: decide.check_legal makes it the all-in
# when the bet covers the stack, so "call the all-in" never shoves over a smaller bet.
WORD_RE = re.compile(rf"\W*(?:(?:(?:raise|bet)\s+)?({ALL_IN})|(fold|check|call|bet|raise))\b", re.I)
# The label-less form: a first line that is the action alone ("RAISE: 150", "all in").
BARE_RE = re.compile(rf"\W*((?:fold|check|call|bet|raise|{ALL_IN})\b)[:\s]*(?:{NUMBER})?\W*", re.I)

MAX_AMOUNT = 2_000_000_000  # fits the engine's integer whatever a model writes


def strip_markdown(text: str) -> str:
    """Drop fences, emphasis, inline code and list bullets so "**ACTION:** `CALL`" reads as "ACTION: CALL"."""
    text = re.sub(r"^```\w*\s*$", "", text, flags=re.M)
    text = re.sub(r"[*_`#]+", "", text)
    text = re.sub(r"^\s*[-•]\s+", "", text, flags=re.M)
    return text


def _number(match: re.Match, group: int) -> tuple[int, str]:
    """The number at `group` and its unit ("" for chips)."""
    return min(int(match.group(group).replace(",", "")), MAX_AMOUNT), (match.group(group + 1) or "").lower()


def parse_response(text: str) -> dict:
    """Parse LLM response into structured action. `unit` is set when the amount was given in
    something other than chips; `problem` says why an unparseable reply could not be read."""
    result = {"action": "FOLD", "amount": 0, "unit": "", "reason": "", "raw": text, "status": "ok", "problem": ""}
    clean = strip_markdown(text)

    actions = list(ACTION_RE.finditer(clean))
    if actions:
        # The last ACTION line is the answer: a model that thinks out loud may write earlier ones.
        said = actions[-1].group(1)
        tail = clean[actions[-1].end():]
        alone = len(actions) == 1
        # Its AMOUNT follows it, or is on the ACTION line itself ("raise to 200"). A lone ACTION
        # line may also come after its AMOUNT and REASON; an earlier draft's are never borrowed.
        amount = AMOUNT_RE.search(tail) or re.search(NUMBER, said, re.I) or (AMOUNT_RE.search(clean) if alone else None)
        reason = REASON_RE.search(tail) or (REASON_RE.search(clean) if alone else None)
        if amount:
            result["amount"], result["unit"] = _number(amount, 1)
    else:
        # No label: only a first line that is the action alone counts.
        first = next((line for line in clean.splitlines() if line.strip()), "")
        bare = BARE_RE.fullmatch(first)
        said = bare.group(1) if bare else ""
        reason = REASON_RE.search(clean)
        if bare and bare.group(2):
            result["amount"], result["unit"] = _number(bare, 2)
        elif amount := AMOUNT_RE.search(clean):
            result["amount"], result["unit"] = _number(amount, 1)
    # No REASON stays empty: never put words in the model's mouth.
    if reason:
        result["reason"] = reason.group(1).strip()

    word = WORD_RE.match(said)
    if not word:
        # The FOLD above is our placeholder, not the model's choice.
        result["status"] = "unparseable"
        result["problem"] = ("the ACTION line did not say fold, check, call, bet, raise or all-in" if actions
                             else "no ACTION line was found")
    elif word.group(1):
        result["action"] = "ALL_IN"
    else:
        action = word.group(2).upper()
        result["action"] = "RAISE" if action == "BET" else action
    return result
