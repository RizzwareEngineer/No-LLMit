"""FastAPI server for querying LLM APIs for their decisions/action given the current game state."""

import os
import time
import logging
from datetime import datetime
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from schemas import DecisionRequest, DecisionResponse

load_dotenv()

# TODO: refactor out this providers as its own class, may be overengineering but oh well 
from providers.huggingface import get_decision
from registry import list_models

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger("app")


app = FastAPI(title="No-LLMit LLM Service")

# Local usage tracking (HuggingFace doesn't expose remaining credits via API)
usage_stats = {
    "session_start": datetime.now().isoformat(),
    "total_requests": 0,
    "estimated_input_tokens": 0,
    "estimated_output_tokens": 0,
}


@app.get("/health")
def health():
    """Verifies health of all LLM API keys providers."""
    
    api_key = os.getenv("HF_API_KEY")
    if not api_key: raise HTTPException(status_code=503, detail="HF_API_KEY not configured")
    
    return {"status": "ok"}


@app.get("/usage")
def get_usage():
    """
    Returns local usage stats for this session.
    
    Note: HuggingFace doesn't expose an API to check remaining credits.
    Limits: Free = ~100k tokens/month + 1k requests/day, Pro = ~2M tokens/month + 20k requests/day
    """
    return {
        **usage_stats,
        "estimated_total_tokens": usage_stats["estimated_input_tokens"] + usage_stats["estimated_output_tokens"],
        "note": "HuggingFace limits: Free ~100k tokens/mo, Pro ~2M tokens/mo. This is local tracking only.",
    }


@app.post("/decide", response_model=DecisionResponse)
def decide(request: DecisionRequest):
    """
    Query an LLM's API for their decision/action given context of the current game state.

    Look at GetLLMPromptPayload() inside no-LLMit/engine/game/game.go to see how payload is constructed.
    """
    logger.info("")
    logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    logger.info(f"🎯 LLM API Request: {request.player_name}")
    logger.info("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━")
    start = time.time()
    
    # Estimate input tokens (rough: ~4 chars per token)
    import json
    input_text = json.dumps(request.payload)
    estimated_input = len(input_text) // 4
    
    try:
        result = get_decision(request.player_name, request.payload)
    except Exception as e:
        logger.error(f"❌ Error for {request.player_name}: {e}")
        return DecisionResponse(
            action="FOLD",
            amount=0,
            reason=f"Error: {str(e)}",
            raw="",
            latency_ms=int((time.time() - start) * 1000),
        )
    
    latency_ms = int((time.time() - start) * 1000)
    
    # Update usage stats
    estimated_output = len(result.get("raw", "")) // 4
    usage_stats["total_requests"] += 1
    usage_stats["estimated_input_tokens"] += estimated_input
    usage_stats["estimated_output_tokens"] += estimated_output
    
    # Format action with emoji
    action_emojis = {"FOLD": "🃏", "CHECK": "✋", "CALL": "📞", "RAISE": "⬆️", "ALL_IN": "🔥"}
    emoji = action_emojis.get(result["action"], "❓")
    
    logger.info(f"{emoji} {result['action']}")
    if result["amount"] > 0:
        logger.info(f"   Amount: ¤{result['amount']}")
    logger.info(f"   Reason: {result['reason']}")
    logger.info(f"   ⏱️  {latency_ms}ms | 📊 ~{estimated_input + estimated_output} tokens (session: {usage_stats['total_requests']} reqs)")
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
    port = int(os.getenv("PORT", "5001"))
    uvicorn.run(app, host="0.0.0.0", port=port)

