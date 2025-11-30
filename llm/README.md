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
HF_API_KEY=hf_your_api_key_here
PORT=5000
```

## Run

```bash
source .venv/bin/activate
python app.py
```

Or with uvicorn directly:
```bash
uvicorn app:app --reload --port 5000
```

## API Endpoints

- `GET /health` - Health check
- `GET /models` - List available models
- `POST /decide` - Get LLM decision

### POST /decide

Request:
```json
{
  "player_name": "Claude 3.5",
  "payload": { ...game state from Go... }
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

- **Go** manages game state and LLM prompt history (append-only)
- **Python** is stateless: receives payload → calls HuggingFace → returns action
- Shared history: all LLMs see the same action history
- Only `yourName` and `yourCards` differ per LLM

## Files

- `prompt.py` - System prompt for LLM poker players
- `huggingface.py` - HuggingFace client and response parser
- `app.py` - FastAPI server

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
