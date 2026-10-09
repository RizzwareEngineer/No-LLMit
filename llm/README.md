# LLM Service

Python service that handles LLM API calls for No-LLMit poker.

## Setup

```bash
cd llm
uv venv
source .venv/bin/activate
uv pip install -r requirements.txt
```

## Environment

Create `.env` file:
```
OPENROUTER_API_KEY=sk-or-your_api_key_here
PORT=5001
```

Without `OPENROUTER_API_KEY` the service runs the mock provider, which plays random legal
actions and calls no model. Set `LLM_PROVIDER=mock` or `LLM_PROVIDER=openrouter` to force one.

## Run

```bash
source .venv/bin/activate
python app.py
```

Or with uvicorn directly:
```bash
uvicorn app:app --reload --port 5001
```

## API Endpoints

- `GET /health` - Health check
- `GET /usage` - Provider, spend against the key's limit, and request counts
- `POST /decide` - Get LLM decision

### POST /decide

Request:
```json
{
  "player_name": "Claude Haiku 5.5",
  "prompt": "Hand #12. No Limit Texas Hold'em cash game, blinds 5/10, 9 players. ...",
  "valid_actions": [{"type": "FOLD"}, {"type": "CALL", "amount": 20}]
}
```

Response:
```json
{
  "action": "RAISE",
  "amount": 150,
  "reason": "Strong hand in position.",
  "raw": "ACTION: RAISE\nAMOUNT: 150\nREASON: Strong hand in position.",
  "latency_ms": 1234
}
```

## Architecture

- **Go** manages game state and writes the text prompt for each decision
- **Python** is stateless: receives the prompt → calls the seat's model on OpenRouter → returns the action
- Each prompt describes the current hand only; there is no memory of previous hands
- Only the "You are ..." section (name, cards, stack) differs per LLM

## Files

- `app.py` - FastAPI server
- `prompts.py` - System prompt for LLM poker players
- `registry.py` - Seat names and the OpenRouter model behind each
- `parsing.py` - Turns a raw reply into an action
- `providers/openrouter.py` - OpenRouter client
- `providers/mock.py` - Random legal actions for local development

---

## Future: Training Mode

Allow users to train an LLM by playing 1000+ hands themselves.

### Data Structure (reuses existing types)

```go
// Wraps LLMPreviousHand - no duplication
type LLMTrainingRecord struct {
    Hand      LLMPreviousHand   // REUSED - contains all hand context
    YourName  string            // which player is being trained
    YourCards []string          // trainee's cards (even if folded)
    Decisions []LLMDecision     // trainee's decisions with reasoning
}

type LLMDecision struct {
    ActionIdx  int      // index into Hand.Actions (which action was theirs)
    Reasoning  string   // user's explanation (optional input)
}
```

### What's Included via Reuse

`LLMTrainingRecord.Hand` (type `LLMPreviousHand`) contains:

| Field | What's in it |
|-------|--------------|
| `Players` | All player names, seats, **stack sizes**, positions |
| `CommunityCards` | Final board (flop, turn, river) |
| `Actions` | Every action: player, action type, amount |
| `Showdown` | Cards revealed at showdown |
| `Winners` | Who won, how much |

### What Training Adds

| Field | Why needed |
|-------|------------|
| `YourCards` | Trainee's hole cards (needed if they fold before showdown) |
| `Decisions` | Links trainee's actions to their reasoning |

**No parallel structures.** Training wraps the existing hand type.

### Flow

1. User enters "Training Mode" and selects base LLM to train
2. User plays hands against other LLMs
3. After each user action, optionally prompt for reasoning
4. Each hand archived as `LLMTrainingRecord` to database
5. After 1000+ hands, fine-tune the base LLM on collected data
6. User gets their custom-trained LLM

### Storage (future)

```sql
CREATE TABLE training_sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT,
    base_llm TEXT,
    created_at TIMESTAMP
);

CREATE TABLE training_hands (
    id TEXT PRIMARY KEY,
    session_id TEXT REFERENCES training_sessions(id),
    hand_data JSONB,        -- LLMPreviousHand (players, actions, etc.)
    your_cards TEXT[],
    decisions JSONB,        -- []LLMDecision
    created_at TIMESTAMP
);
```

### Fine-tuning Options

1. **HuggingFace + Tinker** - User provides API key, we handle training
2. **Custom training pipeline** - Export data, user trains locally
3. **OpenAI fine-tuning API** - For GPT-based models
