from pydantic import BaseModel


class Seat(BaseModel):
    seat: int  # 0-based seat index; shown to the model as Player seat+1
    position: str  # SB, BB, UTG, ..., BTN
    stack: int  # current stack


class StreetAction(BaseModel):
    seat: int
    action: str  # post, fold, check, call, raise, all_in
    amount: int = 0  # chips added for post and call; street total for raise and all_in


class Street(BaseModel):
    street: str  # preflop, flop, turn, river
    board: list[str] = []
    pot: int = 0  # pot when the street began
    actions: list[StreetAction] = []


class LegalAction(BaseModel):
    type: str  # FOLD, CHECK, CALL, BET, RAISE, ALL-IN (the engine's spelling)
    amount: int = 0  # CALL: chips to add; ALL-IN: street total
    min: int = 0  # BET/RAISE: street total range
    max: int = 0


class DecisionRequest(BaseModel):
    """The game state as data. The service renders the prompt from it."""

    player_name: str  # roster name of the seat's model; never shown to the model
    small_blind: int
    big_blind: int
    seats: list[Seat]  # clockwise after the button, button last (heads-up: BB, then BTN)
    streets: list[Street]  # preflop first, up to and including the current street
    seat: int  # the acting player
    position: str
    hole_cards: list[str]
    pot: int
    to_call: int
    stack: int
    legal_actions: list[LegalAction]


class DecisionResponse(BaseModel):
    action: str  # FOLD, CHECK, CALL, RAISE or ALL_IN as read from the model's last reply; FOLD when none came
    amount: int
    reason: str  # empty when the model gave none; never filled in for it
    raw: str  # every reply, a retry's separated by "--- retry ---"
    latency_ms: int
    # ok; unparseable or illegal (the model's own miss, twice); timeout or api_error (the
    # provider failed, not the model's fault). Anything but ok means the engine plays its
    # fallback (CHECK when legal, otherwise FOLD) instead of action.
    status: str = "ok"
    retried: bool = False  # the first reply was unparseable or illegal and the model was asked again
    error: str | None = None  # the provider's last failure, when status is timeout or api_error
    prompt: str = ""  # the user prompt the model saw
    retry_prompt: str | None = None  # the follow-up message, when retried
    provider: str = ""
    model: str | None = None  # the model OpenRouter reports serving the request
    tokens_in: int | None = None
    tokens_out: int | None = None
    cost_usd: float | None = None
    prompt_version: str = ""
    # OpenRouter only; None from the mock provider.
    reasoning_tokens: int | None = None
    upstream_provider: str | None = None  # the host OpenRouter routed to
