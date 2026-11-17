#!/usr/bin/env bash
# Builds a fixture hand-log snapshot with the real engine and a seeded mock model (the kind scripts/dev.sh --seed builds,
# but the same cards and moves every time): sessions of the given sizes, the engine restarted between them.
#   web/scripts/fixture/gen-snapshot.sh OUT_DIR SEED SIZE [SIZE ...]
# Needs /tmp/engine-bin (cd engine && go build -o /tmp/engine-bin .) and uv. Calls no paid service: the mock model only.
set -eu
OUT=$1 SEED=$2; shift 2
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
LLM_PORT=${LLM_PORT:-5102} ENGINE_PORT=${ENGINE_PORT:-8102}
mkdir -p "$OUT"; : > "$OUT/hands.jsonl"
hands() { wc -l < "$OUT/hands.jsonl" | tr -d ' '; }
s=0
for size in "$@"; do
  s=$((s + 1))
  # A fresh mock per session, seeded per session, so session k always plays the same moves.
  (cd "$ROOT/llm" && LLM_PROVIDER=mock MOCK_SEED=$((SEED * 100 + s)) exec uv run --quiet --no-project --with-requirements requirements.txt \
    python -m uvicorn app:app --host 127.0.0.1 --port "$LLM_PORT" --log-level warning) > "$OUT/.llm.log" 2>&1 &
  llm=$!
  for _ in $(seq 120); do curl -sf -o /dev/null "http://127.0.0.1:$LLM_PORT/health" && break; sleep 0.5; done
  goal=$(( $(hands) + size ))
  env -u SUPABASE_URL -u SUPABASE_SERVICE_KEY -u TABLE_TIMEZONE PORT=$ENGINE_PORT HAND_LOG_DIR="$OUT" \
    LLM_SERVICE_URL=http://127.0.0.1:$LLM_PORT TABLE_PACE=0.001 DAILY_CALL_CAP=1000000000 FIXTURE_SEED=$((SEED * 100 + s)) \
    /tmp/engine-bin > "$OUT/.engine.log" 2>&1 &
  eng=$!
  while [ "$(hands)" -lt "$goal" ]; do kill -0 $eng 2>/dev/null || { tail "$OUT/.engine.log"; exit 1; }; sleep 0.5; done
  kill $eng $llm; wait $eng $llm 2>/dev/null || true
  # The engine may finish a hand between the count and the kill: cut the session to exactly its size.
  head -n "$goal" "$OUT/hands.jsonl" > "$OUT/.h" && mv "$OUT/.h" "$OUT/hands.jsonl"
  echo "session $s: $(hands) hands"
done
rm -f "$OUT/.llm.log" "$OUT/.engine.log"
