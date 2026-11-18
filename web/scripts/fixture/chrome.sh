#!/usr/bin/env bash
# CHROME_PATH for fixture runs: the real Chrome, with every request (loopback too) sent through the endpoint guard (guard.mjs).
# Chrome's own background traffic (updates, sign-in, time sync, safe browsing) is switched off, so what reaches the guard
# is the page's; those flags change nothing a page can see.
HERE="$(cd "$(dirname "$0")" && pwd)"; REAL="${FIXTURE_REAL_CHROME:-/usr/bin/google-chrome}"
# Never exec itself (CHROME_PATH=chrome.sh passed through as the real Chrome loops until E2BIG; R6-13).
[ "$(readlink -f "$REAL")" = "$(readlink -f "$HERE/chrome.sh")" ] && { echo "chrome.sh: FIXTURE_REAL_CHROME is chrome.sh itself" >&2; exit 2; }
exec "$REAL" --proxy-server="http://127.0.0.1:${FIXTURE_GUARD_PORT:-8899}" --proxy-bypass-list='<-loopback>' \
  --disable-background-networking --disable-component-update --disable-sync --no-first-run --disable-default-apps \
  --disable-domain-reliability --disable-client-side-phishing-detection --disable-features=OptimizationHints,MediaRouter,Translate,NetworkTimeServiceQuerying,AutofillServerCommunication,CertificateTransparencyComponentUpdater \
  --metrics-recording-only --no-pings --safebrowsing-disable-auto-update "$@"
