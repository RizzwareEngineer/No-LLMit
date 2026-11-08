#!/usr/bin/env bash
# The gate every change passes before it merges. Exits non-zero on any failure.
#   scripts/verify.sh [--base http://localhost:3100] [--changed] [--skip id,id] [--only id,id] [--no-ui]
# Engine: go vet + tests. LLM service: pytest. Web: tsc, eslint on changed files, then the headless UI
# checks (web/scripts/checks.mjs). Without --base the UI checks run against a production build of this
# worktree (next build into web/.next-verify, reused while web/ is unchanged; next start on a free port,
# stopped at the end). --base points them at a running server instead (the owner's :3100 dev preview).
# --changed runs only the UI checks tied to the files changed against $BASE_REF (none if web/ is untouched).
# Only one UI phase (build, server, headless Chrome) runs at a time on this machine: /tmp/nollmit-checks.lock.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export BASE_REF="${BASE_REF:-preview/ui}"
UI=1; BASE=""; CHANGED=0; PASS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --no-ui) UI=0 ;;
    --base) BASE="$2"; shift ;;
    --changed) CHANGED=1; PASS+=("$1") ;;
    *) PASS+=("$1") ;;
  esac
  shift
done
fail=0
t0=$(date +%s)
step() { printf '\n== %s (at %ss)\n' "$1" $(( $(date +%s) - t0 )); }

step "engine: go vet + go test"
(cd "$ROOT/engine" && go vet ./... && go test ./... >/tmp/verify-go.$$ 2>&1; s=$?; tail -8 /tmp/verify-go.$$; rm -f /tmp/verify-go.$$; exit $s) || fail=1

step "llm: pytest"
(cd "$ROOT/llm" && PYTHONPATH=. uv run --quiet --no-project --with-requirements requirements.txt --with pytest --with httpx pytest -q 2>&1 | tail -3; exit "${PIPESTATUS[0]}") || fail=1

step "web: tsc"
(cd "$ROOT/web" && npx tsc --noEmit -p .) || fail=1

changed_files() { cd "$ROOT" && { git diff --name-only "$BASE_REF"...HEAD; git diff --name-only HEAD; git ls-files --others --exclude-standard; } | sort -u; }
step "web: eslint (files changed against $BASE_REF)"
changed=$(changed_files | grep -E '^web/src/.*\.(ts|tsx)$' | sed 's#^web/##')
if [ -n "$changed" ]; then (cd "$ROOT/web" && npx eslint $changed) || fail=1; else echo "no changed web files"; fi

if [ "$UI" = 1 ] && [ "$CHANGED" = 1 ] && ! changed_files | grep -q '^web/'; then
  step "ui: headless checks"; echo "no changed files under web/: no UI checks"; UI=0
fi

LOCK=/tmp/nollmit-checks.lock SERVER="" PORT=""
cleanup() {
  [ -n "$SERVER" ] && "$ROOT/scripts/stop-server.sh" "$PORT" >/dev/null
  [ "$(cat "$LOCK" 2>/dev/null)" = "$$" ] && rm -f "$LOCK"
}
trap cleanup EXIT; trap 'exit 130' INT TERM

if [ "$UI" = 1 ]; then
  step "ui: lock"
  w0=$(date +%s)
  # noclobber makes the create atomic: the first writer owns the lock. A dead holder's lock is cleared.
  until (set -C; echo $$ > "$LOCK") 2>/dev/null; do
    holder=$(cat "$LOCK" 2>/dev/null)
    if [ -n "$holder" ] && ! kill -0 "$holder" 2>/dev/null; then echo "clearing the lock of dead pid $holder"; rm -f "$LOCK"; continue; fi
    [ $(( $(date +%s) - w0 )) -ge 1800 ] && { echo "lock held by pid $holder for 30 min: giving up"; fail=1; UI=0; break; }
    sleep 2
  done
  [ "$UI" = 1 ] && echo "lock taken after $(( $(date +%s) - w0 ))s wait"
fi

if [ "$UI" = 1 ] && [ -z "$BASE" ]; then
  step "ui: production build (web/.next-verify)"
  export NEXT_DIST_DIR=.next-verify
  # Rebuild only when web/ (the check scripts aside) differs from the last build's tree.
  key=$(cd "$ROOT" && { git rev-parse HEAD:web; git diff HEAD -- web ':!web/scripts'; git ls-files -z --others --exclude-standard -- web ':!web/scripts' | xargs -0 cat; } | shasum | cut -c1-40)
  # Turbopack cannot follow a worker worktree's symlinked node_modules; webpack can.
  [ -L "$ROOT/web/node_modules" ] && bundler=--webpack || bundler=
  if [ "$(cat "$ROOT/web/.next-verify/VERIFY_KEY" 2>/dev/null)" = "$key" ]; then echo "unchanged since the last build: reused"
  elif (cd "$ROOT/web" && npx next build $bundler >/tmp/verify-build.$$ 2>&1); then echo "$key" > "$ROOT/web/.next-verify/VERIFY_KEY"; tail -3 /tmp/verify-build.$$
  else tail -30 /tmp/verify-build.$$; fail=1; UI=0; fi
  rm -f /tmp/verify-build.$$
fi

if [ "$UI" = 1 ] && [ -z "$BASE" ]; then
  PORT=3300; while lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; do PORT=$((PORT + 1)); done
  (cd "$ROOT/web" && exec node node_modules/next/dist/bin/next start -p "$PORT" >/tmp/verify-start.$PORT 2>&1) & SERVER=$!
  BASE="http://localhost:$PORT"
  for _ in $(seq 120); do curl -sf -o /dev/null "$BASE" && break; sleep 0.5; done
  curl -sf -o /dev/null "$BASE" && echo "serving the build on :$PORT" || { cat /tmp/verify-start.$PORT; fail=1; UI=0; }
fi

if [ "$UI" = 1 ]; then
  step "ui: headless checks ($BASE)"
  (cd "$ROOT/web" && node scripts/checks.mjs --base "$BASE" "${PASS[@]+"${PASS[@]}"}") || fail=1
fi

echo; echo "verify took $(( $(date +%s) - t0 ))s"
[ "$fail" = 0 ] && echo "VERIFY: PASS" || echo "VERIFY: FAIL"
exit $fail
