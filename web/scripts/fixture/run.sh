#!/usr/bin/env bash
# Runs a browser tool against a running fixture (serve.sh) through the endpoint guard, and fails the run if the page made
# any request the fixture does not serve.
#   web/scripts/fixture/run.sh VIOLATIONS_FILE -- node scripts/checks.mjs --base http://localhost:3301 ...
# Puppeteer and Lighthouse launch CHROME_PATH, which here is chrome.sh (the real Chrome behind the guard).
set -u
VIOL=$1; shift; [ "${1-}" = "--" ] && shift
HERE="$(cd "$(dirname "$0")" && pwd)"
# The guard's own file (serve.sh's "violations:" path) must exist: a wrong path would count nothing and pass (R6-7).
[ -f "$VIOL" ] || { echo "FIXTURE GUARD: no violations file $VIOL (is serve.sh running? use the path it printed)"; exit 3; }
# ...and a guard must be writing it now: the pid it left beside the file is alive and is guard.mjs on this very file
# (R7-12: a stopped fixture's file stays on disk, and counted nothing while another guard wrote elsewhere).
GPID=$(cat "$VIOL.pid" 2>/dev/null)
if [ -z "$GPID" ] || ! kill -0 "$GPID" 2>/dev/null || ! tr '\0' ' ' < "/proc/$GPID/cmdline" 2>/dev/null | grep -q -- "guard.mjs.*--violations $VIOL\( \|$\)"; then
  echo "FIXTURE GUARD: no running guard writes $VIOL (a stopped fixture's file? use the path the running serve.sh printed)"; exit 3
fi
cp "$VIOL" "$VIOL.before"
REAL="${FIXTURE_REAL_CHROME:-${CHROME_PATH:-/usr/bin/google-chrome}}"
# CHROME_PATH exported as chrome.sh (serve.sh's "use:" line) would make chrome.sh exec itself forever (R6-13).
if [ "$(readlink -f "$REAL" 2>/dev/null)" = "$(readlink -f "$HERE/chrome.sh")" ]; then
  REAL="${FIXTURE_REAL_CHROME_FALLBACK:-/usr/bin/google-chrome}"
  [ "$(readlink -f "$REAL" 2>/dev/null)" = "$(readlink -f "$HERE/chrome.sh")" ] && { echo "run.sh: the real Chrome is chrome.sh itself; set FIXTURE_REAL_CHROME"; exit 2; }
fi
FIXTURE_REAL_CHROME="$REAL" CHROME_PATH="$HERE/chrome.sh" "$@"
code=$?
new=$(( $(wc -l < "$VIOL") - $(wc -l < "$VIOL.before") )); rm -f "$VIOL.before"
if [ "$new" -gt 0 ]; then
  echo "FIXTURE GUARD: $new request(s) the fixture does not serve:"; tail -n "$new" "$VIOL" | head -20
  exit 3
fi
exit $code
