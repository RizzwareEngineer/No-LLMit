"""HuggingFace Inference API client."""

import os
import re
import json
from dotenv import load_dotenv
from huggingface_hub import InferenceClient

from prompts import system_prompt
from registry import get_model_id

load_dotenv()

client = InferenceClient(token=os.getenv("HF_API_KEY"))


def get_decision(player_name: str, payload: dict) -> dict:
    """
    Ask LLM for their decision/action given the current game state.
    """
    model_id = get_model_id(player_name)
    
    messages = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": json.dumps(payload, indent=2)},
    ]
    
    response = client.chat_completion(
        model=model_id,
        messages=messages,
        max_tokens=512,
    )
    
    raw_text = response.choices[0].message.content
    result = parse_response(raw_text)
    
    return result


def parse_response(text: str) -> dict:
    """Parse LLM response into structured action."""
    result = {"action": "FOLD", "amount": 0, "reason": "", "raw": text}
    
    # Extract standard fields (ACTION: X, AMOUNT: N, REASON: ...)
    if match := re.search(r"ACTION:\s*(\w+)", text, re.I):
        result["action"] = match.group(1).upper()
    if match := re.search(r"AMOUNT:\s*(\d+)", text, re.I):
        result["amount"] = int(match.group(1))
    if match := re.search(r"REASON:\s*(.+)", text, re.I):
        result["reason"] = match.group(1).strip()
    
    # Handle alternate format: "RAISE: 150" (action as line prefix)
    if result["action"] == "FOLD" and not re.search(r"ACTION:", text, re.I):
        for action in ["FOLD", "CHECK", "CALL", "BET", "RAISE", "ALL_IN", "ALL-IN", "ALLIN"]:
            if match := re.search(rf"^{action}[:\s]*(\d*)", text, re.I | re.M):
                result["action"] = action.replace("-", "_").upper()
                if match.group(1):
                    result["amount"] = int(match.group(1))
                break
    
    # Normalize action variants
    action = result["action"].replace("-", "_")
    if action in ["ALL_IN", "ALLIN"]:
        result["action"] = "ALL_IN"
    elif action == "BET":
        result["action"] = "RAISE"
    elif action not in ["FOLD", "CHECK", "CALL", "RAISE", "ALL_IN"]:
        result["action"] = "FOLD"
    
    return result

