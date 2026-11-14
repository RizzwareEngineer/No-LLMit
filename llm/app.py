"""FastAPI server: the engine posts the game state, the service asks the seat's model and
returns the move. All prompt, parsing and retry logic lives here (decide.py)."""

import os
import time
import logging
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException

from schemas import DecisionRequest, DecisionResponse
from prompts import system_prompt, prompt_version
import decide
import registry

load_dotenv()

# LLM_PROVIDER=openrouter calls real models and needs OPENROUTER_API_KEY.
# LLM_PROVIDER=mock plays random legal actions without calling any model.
# Unset or "auto" picks openrouter when a key is configured and mock otherwise.
PROVIDER = os.getenv("LLM_PROVIDER", "auto")
if PROVIDER == "auto":
    PROVIDER = "openrouter" if os.getenv("OPENROUTER_API_KEY") else "mock"
if PROVIDER == "openrouter":
    from providers.openrouter import complete, get_spend
elif PROVIDER == "mock":
    from providers.mock import complete, get_spend
else:
    raise RuntimeError(f"Unknown LLM_PROVIDER: {PROVIDER}")

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

app = FastAPI(title="No-LLMit LLM Service")


@app.get("/health")
def health():
    """Verify API key is configured."""
    if PROVIDER == "openrouter" and not os.getenv("OPENROUTER_API_KEY"):
        raise HTTPException(status_code=503, detail="OPENROUTER_API_KEY not configured")
    return {"status": "ok", "provider": PROVIDER}


@app.get("/usage")
def get_usage():
    """Provider and what it has spent."""
    return {"provider": PROVIDER, "spend": get_spend()}


@app.get("/prompt")
def get_prompt():
    """The system prompt every model receives, and the version that identifies it."""
    return {"prompt_version": prompt_version, "system_prompt": system_prompt}


@app.get("/models")
def get_models(session: int = 0):
    """The seated names and the seconds a turn may take (the engine's shot clock). With the mock provider the lineup rotates by session index so every
    roster model gets hands locally; otherwise it is LINEUP (the default nine when unset)."""
    seated = registry.rotated_lineup(session) if PROVIDER == "mock" else registry.LINEUP
    return {"provider": PROVIDER, "seated": seated, "turn_budget_s": decide.TURN_BUDGET}


@app.post("/decide", response_model=DecisionResponse)
def decide_turn(request: DecisionRequest):
    """The seat's move for the game state sent."""
    logger.info("")
    logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    logger.info(f"🎯 {request.player_name} (Player {request.seat + 1}, {request.position})")

    start = time.time()
    result = decide.decide(request, complete)
    latency_ms = int((time.time() - start) * 1000)
    usage = result.pop("usage")
    response = DecisionResponse(
        **result,
        latency_ms=latency_ms,
        provider=PROVIDER,
        tokens_in=usage.get("prompt_tokens"),
        tokens_out=usage.get("completion_tokens"),
        cost_usd=usage.get("cost"),
        reasoning_tokens=usage.get("reasoning_tokens"),
        prompt_version=prompt_version,
    )

    if response.status != "ok":
        logger.warning(f"⚠️ {response.status}: {response.error or 'fell back to ' + response.action}")
    emoji = {"FOLD": "🃏", "CHECK": "✋", "CALL": "📞", "RAISE": "⬆️", "ALL_IN": "🔥"}.get(response.action, "❓")
    logger.info(f"{emoji} {response.action}" + (f" ¤{response.amount}" if response.amount else ""))
    logger.info(f"   {response.reason}")
    logger.info(f"   ⏱️ {latency_ms}ms | 📊 {(usage.get('prompt_tokens') or 0) + (usage.get('completion_tokens') or 0)} tok")
    logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    return response

