#!/usr/bin/env bash
# Proves each fixture state is what it says, from the engine's own stream (no browser): starts serve.sh on spare ports per
# state, reads 25 s of /stream and tests it. Exit 1 if any state does not show.
#   web/scripts/fixture/check-states.sh [state ...]   (default: all)
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
export LLM_PORT=5191 ENGINE_PORT=8191 SITE_PORT=3391 GUARD_PORT=8891
STATES=${*:-typing closed cap reconnect longnames bigbets}
fail=0
for s in $STATES; do
  D=$(mktemp -d); FIXTURE_DIR=$D "$HERE/serve.sh" --size 300 --state "$s" --pace $([ "$s" = bigbets ] && echo 0.02 || echo 0.3) > "$D/serve.txt" 2>&1 &
  up=; for _ in $(seq 300); do grep -q "fixture up" "$D/serve.txt" && { up=1; break; }; sleep 0.5; done
  if [ -z "$up" ]; then # the fixture never came up: the state is not shown (R6-8), whatever a curl to nothing would say
    pkill -f "fixture/serve.sh --size 300 --state $s "; sleep 2
    echo "FAIL  $s: the fixture never came up ($(tail -1 "$D/serve.txt"))"; fail=1; rm -rf "$D"; continue
  fi
  start=$(date +%s.%N)
  curl -sN --max-time 25 "http://localhost:$ENGINE_PORT/stream" > "$D/stream.txt"
  took=$(echo "$(date +%s.%N) - $start" | bc)
  pkill -f "fixture/serve.sh --size 300 --state $s "; sleep 2
  S="$D/stream.txt"
  case $s in
    typing) v=$(grep -o '"reason":"[^"]*"' "$S" | awk '{print length}' | sort -n | tail -1); ok=$([ "${v:-0}" -gt 300 ] && echo 1); what="longest reason ${v:-0} chars" ;;
    closed) ok=$(grep -q '"kind":"closed"' "$S" && echo 1); what="notice: $(grep -o '"kind":"[a-z]*"' "$S" | sort -u | tr '\n' ' ')" ;;
    cap) ok=$(grep -q '"kind":"cap"' "$S" && echo 1); what="notice: $(grep -o '"kind":"[a-z]*"' "$S" | sort -u | tr '\n' ' ')" ;;
    reconnect) ok=$(grep -q '^data:' "$S" && echo "$took > 15 && $took < 23" | bc | grep -q 1 && echo 1); what="stream closed after ${took%.*} s, $(grep -c '^data:' "$S") events" ;;
    longnames) what=$(python3 "$HERE/stream-facts.py" seated < "$S"); ok=$(echo "$what" | grep -q 'Nemotron 3.5 Super.*Cohere Command R7B\|Cohere Command R7B.*Nemotron 3.5 Super' && echo 1) ;;
    bigbets) what=$(python3 "$HERE/stream-facts.py" bets < "$S"); ok=$(echo "$what" | grep -q '^all at the maximum' && echo 1) ;;
  esac
  echo "$([ -n "$ok" ] && echo PASS || echo FAIL)  $s: $what"
  [ -n "$ok" ] || fail=1
  rm -rf "$D"
done
exit $fail
