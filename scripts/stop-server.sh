#!/usr/bin/env bash
# Stops whatever a worker left running: the dev or production server listening on each given port (and
# its npm/next parent).
#   scripts/stop-server.sh 3241 [3251 ...]
# With no ports it lists orphans instead: next servers on any port but 3100, and headless Chromes
# older than 30 minutes. It never touches a Chrome that isn't headless.
set -u
if [ $# -eq 0 ]; then
  lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | awk '/node/ {n=split($9,a,":"); print $2, a[n]}' | sort -u | while read -r pid port; do
    # Only Next servers (other node apps on this machine aren't ours) and not the preview on :3100.
    [ "$port" != 3100 ] && ps -o command= -p "$pid" | grep -q next && echo "dev server pid $pid on :$port"
  done
  # macOS ps has no etimes: turn etime ([[dd-]hh:]mm:ss) into minutes.
  ps -axo pid,etime,command | awk '/Google Chrome/ && /--headless/ && !/awk/ {
    n = split($2, t, /[-:]/); m = (n == 4 ? t[1]*1440 + t[2]*60 + t[3] : n == 3 ? t[1]*60 + t[2] : t[1]);
    if (m >= 30) print "headless chrome pid " $1 " up " m " min" }' | head
  exit 0
fi
for port in "$@"; do
  for pid in $(lsof -nP -t -iTCP:"$port" -sTCP:LISTEN 2>/dev/null); do
    parent=$(ps -o ppid= -p "$pid" | tr -d ' ')
    kill "$pid" 2>/dev/null && echo "stopped :$port (pid $pid)"
    # The npm/next dev or start wrapper that spawned it, if it is still around.
    [ -n "$parent" ] && ps -o command= -p "$parent" | grep -qE "next (dev|start)" && kill "$parent" 2>/dev/null
  done
done
