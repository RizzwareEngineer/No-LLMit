#!/usr/bin/env bash
# Starts the fixture: the real engine on frozen inputs, plus the site and the endpoint guard.
#   web/scripts/fixture/serve.sh [--size 300|1250] [--state STATE[,STATE...]] [--pace 0.3] [--freeze N]
# --freeze N: frozen mode for frozen.mjs (the guard serves the stream's first N events, then a paused table; see guard.mjs).
# States (combine with commas):
#   live        nothing extra: the table plays at --pace (default)
#   typing      the mock's reason is six times as long, so a reason is still typing when a page loads
#   closed      the table is outside its opening hours (TABLE_TIMEZONE=UTC, hours set to exclude now)
#   cap         the daily call cap is 1: the table stops at its first call (the at-cap notice)
#   reconnect   every stream closes after 20 s, so the page reconnects (FIXTURE_STREAM_LIFE_S)
#   longnames   the roster's nine longest names are seated (FIXTURE_LINEUP)
#   bigbets     every bet and raise is the maximum (MOCK_BETS=big)
# Inputs: snapshot.jsonl.gz (1,250 hands, five sessions; the first 300 are the 300 size), FIXTURE_SEED and MOCK_SEED.
# Ports (override by env): mock 5190, engine 8090 (the fixture build's NEXT_PUBLIC_API_URL), site 3301, guard 8899.
# The site is the build in web/.next-fx: NEXT_DIST_DIR=.next-fx NEXT_PUBLIC_API_URL=http://localhost:8090 npx next build.
# It prints the env to use for a browser tool (CHROME_PATH=chrome.sh) and stays in the foreground; Ctrl-C stops it all.
set -eu
# Its own process group, so stopping it (Ctrl-C, or kill on this script) stops every server it started, next-server included.
# Started from a terminal (or any shell with job control) it already leads its own group, in the terminal's foreground, so
# Ctrl-C reaches it all: no setsid then (setsid would fork and detach it from the terminal; R6-10). Started from a script
# (check-states.sh's &), it shares its caller's group: only then does it take a session of its own.
if [ -z "${FIXTURE_GROUP-}" ] && [ "$(ps -o pgid= -p $$ | tr -d ' ')" != "$$" ]; then FIXTURE_GROUP=1 exec setsid "$0" "$@"; fi
HERE="$(cd "$(dirname "$0")" && pwd)"; ROOT="$(cd "$HERE/../../.." && pwd)"
SIZE=1250 STATES=live PACE=0.3 FREEZE=0
while [ $# -gt 0 ]; do case "$1" in --size) SIZE=$2; shift 2 ;; --state) STATES=$2; shift 2 ;; --pace) PACE=$2; shift 2 ;; --freeze) FREEZE=$2; shift 2 ;; *) echo "unknown $1"; exit 2 ;; esac; done
LLM_PORT=${LLM_PORT:-5190} ENGINE_PORT=${ENGINE_PORT:-8090} SITE_PORT=${SITE_PORT:-3301} GUARD_PORT=${GUARD_PORT:-8899}
SEED=${FIXTURE_SEED:-7}
DIR=${FIXTURE_DIR:-$(mktemp -d)}; mkdir -p "$DIR/hands"
gzip -dc "$HERE/snapshot.jsonl.gz" | head -n "$SIZE" > "$DIR/hands/hands.jsonl"
[ "$(wc -l < "$DIR/hands/hands.jsonl")" -eq "$SIZE" ] || { echo "snapshot has fewer than $SIZE hands"; exit 1; }

ENG_ENV=(FIXTURE_SEED=$SEED TABLE_PACE=$PACE DAILY_CALL_CAP=1000000)
LLM_ENV=(LLM_PROVIDER=mock MOCK_SEED=$SEED)
for s in ${STATES//,/ }; do case "$s" in
  live) ;;
  typing) LLM_ENV+=(MOCK_REASON_REPEAT=6) ;;
  closed) h=$(date -u +%-H); o=$(( (h + 2) % 24 )); [ $o -ge 23 ] && o=1; ENG_ENV+=(TABLE_TIMEZONE=UTC TABLE_OPEN_HOUR=$o TABLE_CLOSE_HOUR=$((o + 1))) ;;
  cap) ENG_ENV+=(DAILY_CALL_CAP=1) ;;
  reconnect) ENG_ENV+=(FIXTURE_STREAM_LIFE_S=20) ;;
  longnames) ENG_ENV+=("FIXTURE_LINEUP=Cohere Command R7B,Nemotron 3.5 Super,Llama 4 Maverick,DeepSeek V4 Flash,Qwen3 235B A22B,Mistral Large 3,Claude Haiku 5.5,Qwen 3.7 Flash,Llama 3.1 8B") ;;
  bigbets) LLM_ENV+=(MOCK_BETS=big) ;;
  *) echo "unknown state $s"; exit 2 ;;
esac; done

pids=()
cleanup() { trap - EXIT INT TERM; kill -- -$$ 2>/dev/null; }
trap cleanup EXIT; trap 'exit 130' INT TERM
wait_for() { for _ in $(seq 240); do curl -sf -o /dev/null "$1" && return 0; sleep 0.5; done; echo "$2 did not start"; exit 1; }

(cd "$ROOT/llm" && exec env "${LLM_ENV[@]}" uv run --quiet --no-project --with-requirements requirements.txt \
  python -m uvicorn app:app --host 127.0.0.1 --port "$LLM_PORT" --log-level warning) > "$DIR/llm.log" 2>&1 &
pids+=($!); wait_for "http://127.0.0.1:$LLM_PORT/health" "the mock model"
env -u SUPABASE_URL -u SUPABASE_SERVICE_KEY -u DEV_CONTROLS -u TABLE_TIMEZONE PORT=$ENGINE_PORT HAND_LOG_DIR="$DIR/hands" \
  LLM_SERVICE_URL=http://127.0.0.1:$LLM_PORT "${ENG_ENV[@]}" /tmp/engine-bin > "$DIR/engine.log" 2>&1 &
pids+=($!); wait_for "http://127.0.0.1:$ENGINE_PORT/health" "the engine"
(cd "$ROOT/web" && NEXT_DIST_DIR=.next-fx exec npx next start -p "$SITE_PORT") > "$DIR/site.log" 2>&1 &
pids+=($!); wait_for "http://localhost:$SITE_PORT" "the site"
node "$HERE/guard.mjs" --port "$GUARD_PORT" --site "http://localhost:$SITE_PORT" --engine "http://localhost:$ENGINE_PORT" \
  --violations "$DIR/violations.jsonl" --freeze "$FREEZE" > "$DIR/guard.log" 2>&1 &
pids+=($!); sleep 0.5
# Frozen mode: wait until the guard has read its events (asked through the guard, as a page would).
if [ "$FREEZE" -gt 0 ]; then
  for _ in $(seq 240); do curl -sf -o /dev/null -x "http://127.0.0.1:$GUARD_PORT" "http://localhost:$ENGINE_PORT/__fixture/frozen-at" && break; sleep 0.5; done
fi
echo "fixture up: size $SIZE, states $STATES, pace $PACE, logs in $DIR"
echo "use: CHROME_PATH=$HERE/chrome.sh FIXTURE_GUARD_PORT=$GUARD_PORT, base http://localhost:$SITE_PORT; violations: $DIR/violations.jsonl"
wait
