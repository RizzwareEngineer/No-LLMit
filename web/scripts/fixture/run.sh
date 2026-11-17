#!/usr/bin/env bash
# Runs a browser tool against a running fixture (serve.sh) through the endpoint guard, and fails the run if the page made
# any request the fixture does not serve.
#   web/scripts/fixture/run.sh VIOLATIONS_FILE -- node scripts/checks.mjs --base http://localhost:3301 ...
# Puppeteer and Lighthouse launch CHROME_PATH, which here is chrome.sh (the real Chrome behind the guard).
set -u
VIOL=$1; shift; [ "${1-}" = "--" ] && shift
HERE="$(cd "$(dirname "$0")" && pwd)"
: > "$VIOL.before"; cp "$VIOL" "$VIOL.before" 2>/dev/null
REAL="${FIXTURE_REAL_CHROME:-${CHROME_PATH:-/usr/bin/google-chrome}}"
FIXTURE_REAL_CHROME="$REAL" CHROME_PATH="$HERE/chrome.sh" "$@"
code=$?
new=$(( $(wc -l < "$VIOL") - $(wc -l < "$VIOL.before") )); rm -f "$VIOL.before"
if [ "$new" -gt 0 ]; then
  echo "FIXTURE GUARD: $new request(s) the fixture does not serve:"; tail -n "$new" "$VIOL" | head -20
  exit 3
fi
exit $code
