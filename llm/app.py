"""FastAPI server for querying LLM APIs for their decisions/action given the current game state."""

import os
import json
import time
import logging
from datetime import datetime
from pathlib import Path
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from schemas import DecisionRequest, DecisionResponse
from prompts import system_prompt
from usage import tracker

load_dotenv()

# LLM_PROVIDER=openrouter calls real models and needs OPENROUTER_API_KEY.
# LLM_PROVIDER=mock (the default) plays random legal actions without calling any model.
PROVIDER = os.getenv("LLM_PROVIDER", "mock")
if PROVIDER == "openrouter":
    from providers.openrouter import get_decision
elif PROVIDER == "mock":
    from providers.mock import get_decision
else:
    raise RuntimeError(f"Unknown LLM_PROVIDER: {PROVIDER}")

# Every prompt and response is appended here, one JSON object per line.
DECISION_LOG = Path(__file__).parent / "logs" / "decisions.jsonl"


def log_decision(record: dict):
    DECISION_LOG.parent.mkdir(exist_ok=True)
    with DECISION_LOG.open("a") as f:
        f.write(json.dumps(record) + "\n")

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

app = FastAPI(title="No-LLMit LLM Service")

# Allow frontend to call /usage directly
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:3100"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    """Verify API key is configured."""
    if PROVIDER == "openrouter" and not os.getenv("OPENROUTER_API_KEY"):
        raise HTTPException(status_code=503, detail="OPENROUTER_API_KEY not configured")
    return {"status": "ok", "provider": PROVIDER}


@app.get("/usage")
def get_usage():
    """Get usage stats (monthly tokens + daily requests)."""
    return tracker.get_summary()


@app.post("/usage/reset")
def reset_usage():
    """Manually reset all usage stats."""
    tracker.reset()
    return {"status": "reset", "usage": tracker.get_summary()}


@app.post("/decide", response_model=DecisionResponse)
def decide(request: DecisionRequest):
    """Get LLM decision for the current game state."""
    logger.info("")
    logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    logger.info(f"🎯 {request.player_name}")
    
    start = time.time()
    
    # Estimate input tokens (~4 chars per token)
    est_input = (len(system_prompt) + len(request.prompt)) // 4
    
    try:
        result = get_decision(request.player_name, request.prompt, request.valid_actions)
    except Exception as e:
        logger.error(f"❌ Error: {e}")
        return DecisionResponse(
            action="FOLD",
            amount=0,
            reason=f"Error: {str(e)}",
            raw="",
            latency_ms=int((time.time() - start) * 1000),
        )
    
    latency_ms = int((time.time() - start) * 1000)
    est_output = len(result.get("raw", "")) // 4
    
    # Track usage
    tracker.record(est_input, est_output)

    log_decision({
        "time": datetime.now().isoformat(timespec="seconds"),
        "provider": PROVIDER,
        "model": result.get("model"),
        "usage": result.get("usage"),
        "player": request.player_name,
        "prompt": request.prompt,
        "raw": result["raw"],
        "action": result["action"],
        "amount": result["amount"],
        "reason": result["reason"],
        "latency_ms": latency_ms,
    })
    
    # Log result
    emoji = {"FOLD": "🃏", "CHECK": "✋", "CALL": "📞", "RAISE": "⬆️", "ALL_IN": "🔥"}.get(result["action"], "❓")
    logger.info(f"{emoji} {result['action']}" + (f" ¤{result['amount']}" if result["amount"] else ""))
    logger.info(f"   {result['reason']}")
    logger.info(f"   ⏱️ {latency_ms}ms | 📊 ~{est_input + est_output} tok | 📅 {tracker.daily_requests}/day {tracker.monthly_requests}/mo")
    logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    
    return DecisionResponse(
        action=result["action"],
        amount=result["amount"],
        reason=result["reason"],
        raw=result["raw"],
        latency_ms=latency_ms,
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=int(os.getenv("PORT", "5001")))
