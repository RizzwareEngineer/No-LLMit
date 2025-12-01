from pydantic import BaseModel

class DecisionRequest(BaseModel):
    player_name: str
    payload: dict
    mode: str | None = None


class DecisionResponse(BaseModel):
    action: str
    amount: int
    reason: str
    raw: str
    latency_ms: int