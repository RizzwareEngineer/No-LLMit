#!/usr/bin/env bash
# Smoke test of a deployed table, curl only, read-only (the waitlist POST is refused before it is read).
#   scripts/smoke.sh ENGINE_URL SITE_URL     e.g. scripts/smoke.sh https://engine.example.com https://nollmit.vercel.app
# Prints PASS or FAIL per check with what it saw; exits non-zero on any FAIL. Run it after each deploy.
set -u
[ $# -eq 2 ] || { echo "usage: scripts/smoke.sh ENGINE_URL SITE_URL"; exit 2; }
ENGINE="${1%/}"; SITE="${2%/}"
FAILS=0
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

pass() { echo "PASS  $1: $2"; }
fail() { echo "FAIL  $1: $2"; FAILS=$((FAILS + 1)); }
# code URL [curl args...]: the status code, body in $TMP/body, headers in $TMP/head
code() { local u="$1"; shift; curl -s -m 10 -o "$TMP/body" -D "$TMP/head" -w '%{http_code}' "$@" "$u" || true; }
header() { grep -i "^$1:" "$TMP/head" | head -1 | cut -d: -f2- | tr -d '\r' | sed 's/^ *//'; }

c=$(code "$ENGINE/health")
[ "$c" = 200 ] && pass "engine /health" "200" || fail "engine /health" "status $c"

c=$(code "$ENGINE/api/usage")
body=$(head -c 400 "$TMP/body")
if [ "$c" != 200 ]; then fail "engine /api/usage" "status $c"
elif grep -q '"open":true' "$TMP/body"; then pass "engine /api/usage" "200, table open: $body"
elif grep -q '"open":false' "$TMP/body"; then pass "engine /api/usage" "200, table CLOSED (outside its hours): $body"
else fail "engine /api/usage" "200 but no open state: $body"
fi

# The stream never ends: curl stops at 5 s (exit 28), which is expected.
curl -sN -m 5 -o "$TMP/stream" -D "$TMP/head" "$ENGINE/stream" || true
ct=$(header Content-Type)
if [[ "$ct" != text/event-stream* ]]; then fail "engine /stream" "Content-Type '$ct'"
elif grep -q '"type":"snapshot"' "$TMP/stream"; then pass "engine /stream" "$ct, snapshot within 5 s"
else fail "engine /stream" "$ct but no snapshot within 5 s: $(head -c 200 "$TMP/stream")"
fi

c=$(code "$ENGINE/dev/pace")
[ "$c" = 404 ] && pass "engine /dev/pace" "404, dev controls off" || fail "engine /dev/pace" "status $c (DEV_CONTROLS is set)"

c=$(code "$ENGINE/api/waitlist" -X POST -H 'Origin: https://smoke-test.invalid' -H 'Content-Type: application/json' --data '{}')
[ "$c" = 403 ] && pass "waitlist foreign Origin" "403" || fail "waitlist foreign Origin" "status $c, want 403"

for path in / /about; do
  c=$(code "$SITE$path")
  missing=""
  [ "$(header X-Content-Type-Options)" = nosniff ] || missing+=" X-Content-Type-Options"
  [ "$(header X-Frame-Options)" = DENY ] || missing+=" X-Frame-Options"
  [ "$(header Referrer-Policy)" = strict-origin-when-cross-origin ] || missing+=" Referrer-Policy"
  if [ "$c" != 200 ]; then fail "site $path" "status $c"
  elif [ -n "$missing" ]; then fail "site $path" "200, missing or wrong:$missing"
  else pass "site $path" "200 with the security headers"
  fi
done

[ "$FAILS" -eq 0 ] && echo "ALL PASS" || echo "$FAILS FAILED"
exit $((FAILS > 0))
