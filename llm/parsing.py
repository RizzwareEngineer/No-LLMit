"""Turns an LLM's raw text reply into an action the engine understands."""

import re

# "ALL_IN", "ALL-IN", "ALL IN" and "ALLIN" are all the same action.
ACTION_WORD = r"ALL[ _-]?IN|\w+"


def parse_response(text: str) -> dict:
    """Parse LLM response into structured action."""
    result = {"action": "FOLD", "amount": 0, "reason": "", "raw": text, "status": "ok"}
    found_action = False

    # Extract standard fields (ACTION: X, AMOUNT: N, REASON: ...)
    if match := re.search(rf"ACTION:\s*({ACTION_WORD})", text, re.I):
        result["action"] = match.group(1)
        found_action = True
    if match := re.search(r"AMOUNT:\s*(\d+)", text, re.I):
        result["amount"] = int(match.group(1))

    # REASON can be multiline, so grab everything after REASON: up to a blank line or another field.
    # No REASON stays empty: never put words in the model's mouth.
    if match := re.search(r"REASON:\s*(.+?)(?=\n\n|ACTION:|AMOUNT:|$)", text, re.I | re.S):
        result["reason"] = match.group(1).strip()

    # Handle alternate format: "RAISE: 150" (action as line prefix)
    if not found_action:
        for action in ["FOLD", "CHECK", "CALL", "BET", "RAISE", "ALL[ _-]?IN"]:
            if match := re.search(rf"^({action})[:\s]*(\d*)", text, re.I | re.M):
                result["action"] = match.group(1)
                found_action = True
                if match.group(2):
                    result["amount"] = int(match.group(2))
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
