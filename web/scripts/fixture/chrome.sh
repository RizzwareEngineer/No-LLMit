#!/usr/bin/env bash
# CHROME_PATH for fixture runs: the real Chrome, with every request (loopback too) sent through the endpoint guard (guard.mjs).
# Chrome's own background traffic (updates, sign-in, time sync, safe browsing) is switched off, so what reaches the guard
# is the page's; those flags change nothing a page can see.
exec "${FIXTURE_REAL_CHROME:-/usr/bin/google-chrome}" --proxy-server="http://127.0.0.1:${FIXTURE_GUARD_PORT:-8899}" --proxy-bypass-list='<-loopback>' \
  --disable-background-networking --disable-component-update --disable-sync --no-first-run --disable-default-apps \
  --disable-domain-reliability --disable-client-side-phishing-detection --disable-features=OptimizationHints,MediaRouter,Translate,NetworkTimeServiceQuerying,AutofillServerCommunication,CertificateTransparencyComponentUpdater \
  --metrics-recording-only --no-pings --safebrowsing-disable-auto-update "$@"
