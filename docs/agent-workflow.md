# How agent work is built and merged

The process coding agents follow on this repo: the test gate, how work is split, and what only the owner approves.

## The gate

`scripts/verify.sh` runs go vet, go test (and `-race` on `./api/...`), pytest for `llm/` and `dataset/`, the node tests
in `web/src/lib`, tsc, eslint on the changed web files, then the headless UI checks in `web/scripts/checks.mjs`. The UI
checks need an engine on :8080 (`NEXT_PUBLIC_API_URL`); the gate stops early if none answers `/health`. They run
against a production build of the worktree (`next build` into `web/.next-verify`, reused while `web/` is unchanged,
served by `next start` on a free port from 3300), or against a running server with `--base http://localhost:3100`.
`--no-ui` skips them. Work merges into the preview branch only when a full run prints `VERIFY: PASS`.

A UI check that fails in the full run reruns once on its own, since a busy machine can fail a timing check; the PASS
line names any that needed it, so one that keeps showing up is a real flake to fix.

`checks.mjs` holds the owner's locked rules as checks that can fail: every correction he makes becomes a new check, so
it cannot regress. `--only id` and `--skip id` pick checks. Checks that watch a whole Trends replay play it 4x faster
(`--replay-speed`). Checks with pages of their own run beside the main page's in `--lanes 3` windows. The run lists
each check's seconds and the slowest five.

Only one UI phase (build, server, headless Chrome) runs at a time on the machine: verify.sh waits on
`/tmp/nollmit-checks.lock` and clears a dead holder's lock.

## The split and the loop

One worker per area of the code, with a scope line naming the files it may edit, so parallel workers never edit the
same file. A shared contract is fixed before they start.

Each worker builds, runs `scripts/verify.sh --changed` (only the UI checks tied to the files changed against
`$BASE_REF`, `origin/main` unless set), fixes, and repeats. The full `scripts/verify.sh` runs once before merge. A
check still failing after 3 attempts goes back to the orchestrator: the plan is wrong, not the code.

## Merging

- Front-end changes on the preview branch merge once the gate passes.
- Engine or API changes need the gate plus their own tests.
- Main, deploys, production data and money: the owner only. He approves screenshots of each finished item (taste
  cannot be checked by code) and every merge to main.
- A rejected item goes back alone, with a scope line; correct work is never redone with it. An accepted correction
  becomes a check.

## Cleanup

verify.sh stops its own server and frees the lock on exit, Ctrl-C included, and checks.mjs closes its headless Chrome
even when it crashes. A worker that started a server ends with `scripts/stop-server.sh <port>`. With no ports,
stop-server.sh lists Next servers on any port but :3100 and headless Chromes older than 30 minutes; the orchestrator
stops any that belong to no running worker.

## The owner's preview (:3100)

Never edit `web/next.config.ts`, `tsconfig.json` or anything else that restarts the :3100 dev server while the owner
may have it open: the restart hot-reloads open tabs into a broken mix of old and new CSS. If such a change is needed,
say so first; after it lands, restart :3100 and ask the owner to hard-refresh.
