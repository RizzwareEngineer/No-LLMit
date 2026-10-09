from pydantic import BaseModel

class DecisionRequest(BaseModel):
    player_name: str
    prompt: str
    valid_actions: list[dict] = []
    mode: str | None = None


class DecisionResponse(BaseModel):
    action: str
    amount: int
    reason: str
    raw: str
    latency_ms: int
    # ok, unparseable (no action found in the reply), timeout, or api_error
    status: str = "ok"
    provider: str = ""
    model: str | None = None
    tokens_in: int | None = None
    tokens_out: int | None = None
    cost_usd: float | None = None
    prompt_version: str = ""

