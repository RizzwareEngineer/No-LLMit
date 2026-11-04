from pydantic import BaseModel

class DecisionRequest(BaseModel):
    player_name: str
    prompt: str
    valid_actions: list[dict] = []
    mode: str | None = None
    # Set when re-asking after an invalid reply; sent as a second user message.
    retry_note: str | None = None


class DecisionResponse(BaseModel):
    action: str
    amount: int
    reason: str
    raw: str
    latency_ms: int
    # ok, unparseable (no action found in the reply), truncated (hit max_tokens before
    # answering), timeout, or api_error
    status: str = "ok"
    provider: str = ""
    model: str | None = None
    tokens_in: int | None = None
    tokens_out: int | None = None
    cost_usd: float | None = None
    prompt_version: str = ""
    # OpenRouter only; None from the mock provider.
    reasoning: str | None = None  # the model's thinking text, if it returned any
    reasoning_tokens: int | None = None
    finish_reason: str | None = None  # "stop", "length", ...
    upstream_provider: str | None = None  # the host OpenRouter routed to
    generation_id: str | None = None  # OpenRouter generation id
    temperature: float | None = None
