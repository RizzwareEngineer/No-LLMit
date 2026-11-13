#!/usr/bin/env bash
# Runs the whole table on this machine with mock models: the LLM service, the engine and the site.
#   scripts/dev.sh [--seed N]
# --seed N first plays N fast hands so the stats screens are not empty, then restarts the engine at normal pace.
# Mock models pick random legal moves and call no API. Hands go to HAND_LOG_DIR, never to Supabase.
# Ctrl-C stops all three. Needs go, uv and node (the same tools scripts/verify.sh uses).
set -u
LLM_PORT=${LLM_PORT:-5005}
ENGINE_PORT=${ENGINE_PORT:-8080}
WEB_PORT=${WEB_PORT:-3000}
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export HAND_LOG_DIR="${HAND_LOG_DIR:-$ROOT/engine/data}"

SEED=0
case "${1-}" in '') ;; --seed) SEED="${2-}" ;; *) SEED=bad ;; esac
case "$SEED" in ''|*[!0-9]*) echo "usage: scripts/dev.sh [--seed N]"; exit 2 ;; esac

# Local only: no production database, and the table open all day.
unset SUPABASE_URL SUPABASE_SERVICE_KEY TABLE_TIMEZONE
export LLM_PROVIDER=mock LLM_SERVICE_URL="http://127.0.0.1:$LLM_PORT"

for p in "$LLM_PORT" "$ENGINE_PORT" "$WEB_PORT"; do
  lsof -nP -iTCP:"$p" -sTCP:LISTEN >/dev/null 2>&1 && { echo "port $p is in use: set LLM_PORT, ENGINE_PORT or WEB_PORT"; exit 1; }
done

BIN="$(mktemp -d)"
cleanup() {
  trap - EXIT INT TERM
  "$ROOT/scripts/stop-server.sh" "$WEB_PORT" "$ENGINE_PORT" "$LLM_PORT" >/dev/null
  kill $(jobs -p) 2>/dev/null
  rm -rf "$BIN"
}
trap cleanup EXIT; trap 'exit 130' INT TERM

wait_for() { # url name
  for _ in $(seq 240); do curl -sf -o /dev/null "$1" && return 0; sleep 0.5; done
  echo "$2 did not start: see the output above"; exit 1
}
hands() { cat "$HAND_LOG_DIR/hands.jsonl" 2>/dev/null | wc -l | tr -d ' '; }

mkdir -p "$HAND_LOG_DIR"
(cd "$ROOT/engine" && go build -o "$BIN/engine" .) || exit 1
[ -d "$ROOT/web/node_modules" ] || (cd "$ROOT/web" && npm ci) || exit 1

(cd "$ROOT/llm" && exec uv run --quiet --python 3.11 --no-project --with-requirements requirements.txt \
  python -m uvicorn app:app --host 127.0.0.1 --port "$LLM_PORT") &
wait_for "http://127.0.0.1:$LLM_PORT/health" "the LLM service"

if [ "$SEED" -gt 0 ]; then
  goal=$(( $(hands) + SEED ))
  echo "seeding $SEED hands into $HAND_LOG_DIR/hands.jsonl"
  # The call cap counts in memory: lift it so a big seed does not stop at 5,000 calls.
  PORT="$ENGINE_PORT" TABLE_PACE=0.001 DAILY_CALL_CAP=1000000000 "$BIN/engine" >"$BIN/seed.log" 2>&1 &
  seeder=$!
  while [ "$(hands)" -lt "$goal" ]; do
    kill -0 "$seeder" 2>/dev/null || { tail -20 "$BIN/seed.log"; echo "the engine stopped while seeding"; exit 1; }
    sleep 1
  done
  kill "$seeder"; wait "$seeder" 2>/dev/null
  echo "seeded: $(hands) hands in the log"
fi

PORT="$ENGINE_PORT" "$BIN/engine" &
wait_for "http://127.0.0.1:$ENGINE_PORT/health" "the engine"

(cd "$ROOT/web" && NEXT_PUBLIC_API_URL="http://localhost:$ENGINE_PORT" exec npx next dev -p "$WEB_PORT") &
wait_for "http://localhost:$WEB_PORT" "the site"

echo
echo "No-LLMit with mock models: http://localhost:$WEB_PORT  (Ctrl-C stops it)"
wait
