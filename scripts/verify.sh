#!/usr/bin/env bash
# The gate every change passes before it merges. Exits non-zero on any failure.
#   scripts/verify.sh [--base http://localhost:3100] [--skip id,id] [--only id,id] [--no-ui]
# Engine: go vet + tests. LLM service: pytest. Web: tsc, eslint on changed files, then the
# headless UI checks (web/scripts/checks.mjs) against a running dev server and engine.
set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BASE_REF="${BASE_REF:-preview/ui}"
UI=1; PASS=()
for a in "$@"; do [ "$a" = "--no-ui" ] && UI=0; done
for a in "$@"; do [ "$a" != "--no-ui" ] && PASS+=("$a"); done
fail=0
step() { printf '\n== %s\n' "$1"; }

step "engine: go vet + go test"
(cd "$ROOT/engine" && go vet ./... && go test ./... >/tmp/verify-go.$$ 2>&1; s=$?; tail -8 /tmp/verify-go.$$; rm -f /tmp/verify-go.$$; exit $s) || fail=1

step "llm: pytest"
(cd "$ROOT/llm" && PYTHONPATH=. uv run --quiet --no-project --with-requirements requirements.txt --with pytest --with httpx pytest -q 2>&1 | tail -3; exit "${PIPESTATUS[0]}") || fail=1

step "web: tsc"
(cd "$ROOT/web" && npx tsc --noEmit -p .) || fail=1

step "web: eslint (files changed against $BASE_REF)"
changed=$(cd "$ROOT" && { git diff --name-only "$BASE_REF"...HEAD; git diff --name-only; git ls-files --others --exclude-standard; } | sort -u | grep -E '^web/src/.*\.(ts|tsx)$' | sed 's#^web/##')
if [ -n "$changed" ]; then (cd "$ROOT/web" && npx eslint $changed) || fail=1; else echo "no changed web files"; fi

if [ "$UI" = 1 ]; then
  step "ui: headless checks"
  (cd "$ROOT/web" && node scripts/checks.mjs "${PASS[@]+"${PASS[@]}"}") || fail=1
fi

echo; [ "$fail" = 0 ] && echo "VERIFY: PASS" || echo "VERIFY: FAIL"
exit $fail
