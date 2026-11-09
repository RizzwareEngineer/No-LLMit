"""Turns an LLM's raw text reply into an action the engine understands."""

import re

# "ALL_IN", "ALL-IN", "ALL IN" and "ALLIN" are all the same action.
ACTION_WORD = r"ALL[ _-]?IN|\w+"
ACTION_RE = re.compile(rf"ACTION:\s*({ACTION_WORD})", re.I)
AMOUNT_RE = re.compile(r"AMOUNT:\s*\$?([\d,]+)", re.I)
# REASON can be multiline: everything up to a blank line or another field.
REASON_RE = re.compile(r"REASON:\s*(.+?)(?=\n\n|ACTION:|AMOUNT:|$)", re.I | re.S)


def strip_markdown(text: str) -> str:
    """Drop fences, emphasis, inline code and list bullets so "**ACTION:** `CALL`" reads as "ACTION: CALL"."""
    text = re.sub(r"^```\w*\s*$", "", text, flags=re.M)
    text = re.sub(r"[*_`#]+", "", text)
    text = re.sub(r"^\s*[-•]\s+", "", text, flags=re.M)
    return text


def parse_response(text: str) -> dict:
    """Parse LLM response into structured action."""
    result = {"action": "FOLD", "amount": 0, "reason": "", "raw": text, "status": "ok"}
    clean = strip_markdown(text)
    found_action = False

    # The last ACTION line is the answer: a model that thinks out loud may write earlier ones.
    actions = list(ACTION_RE.finditer(clean))
    if actions:
        result["action"] = actions[-1].group(1)
        found_action = True
        # AMOUNT and REASON belong to that last ACTION; fall back to anywhere in the reply.
        tail = clean[actions[-1].end():]
        amount = AMOUNT_RE.search(tail) or AMOUNT_RE.search(clean)
        reason = REASON_RE.search(tail) or REASON_RE.search(clean)
    else:
        amount = AMOUNT_RE.search(clean)
        reason = REASON_RE.search(clean)
    if amount:
        result["amount"] = int(amount.group(1).replace(",", ""))
    # No REASON stays empty: never put words in the model's mouth.
    if reason:
        result["reason"] = reason.group(1).strip()

    # Handle alternate format: "RAISE: 150" (action as line prefix)
    if not found_action:
        for action in ["FOLD", "CHECK", "CALL", "BET", "RAISE", "ALL[ _-]?IN"]:
            if match := re.search(rf"^({action})[:\s]*([\d,]*)", clean, re.I | re.M):
                result["action"] = match.group(1)
                found_action = True
                if match.group(2):
                    result["amount"] = int(match.group(2).replace(",", ""))
                break

    # Normalize action variants
    action = re.sub(r"[ _-]", "", result["action"].upper())
    if action == "ALLIN":
        result["action"] = "ALL_IN"
    elif action == "BET":
        result["action"] = "RAISE"
    elif action in ["FOLD", "CHECK", "CALL", "RAISE"]:
        result["action"] = action
    else:
        result["action"] = "FOLD"
        found_action = False

    # The fold above is our fallback, not the model's choice
    if not found_action:
        result["status"] = "unparseable"

    return result
