"""FastAPI server for querying LLM APIs for their decisions/action given the current game state."""

import os
import json
import time
import logging
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from schemas import DecisionRequest, DecisionResponse
from providers.huggingface import get_decision
from usage import tracker, SPECTATE_DAILY_REQUESTS

load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

app = FastAPI(title="No-LLMit LLM Service")

# Allow frontend to call /usage directly
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    """Verify API key is configured."""
    if not os.getenv("HF_API_KEY"):
        raise HTTPException(status_code=503, detail="HF_API_KEY not configured")
    return {"status": "ok"}


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
    
    mode = request.mode or "simulate"
    if mode == "simulate":
        daily_requests = tracker.daily_requests
        if daily_requests >= SPECTATE_DAILY_REQUESTS:
            logger.warning(f"⚠️ Daily API limit reached for spectate mode: {daily_requests}/{SPECTATE_DAILY_REQUESTS}")
            raise HTTPException(
                status_code=429,
                detail=f"Daily API limit reached for spectate mode ({SPECTATE_DAILY_REQUESTS} requests/day). Please try again tomorrow."
            )
    
    start = time.time()
    
    # Estimate input tokens (~4 chars per token)
    input_text = json.dumps(request.payload)
    est_input = len(input_text) // 4
    
    try:
        result = get_decision(request.player_name, request.payload)
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
