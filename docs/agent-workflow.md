# How agent work is built and merged

## The gate
`scripts/verify.sh` runs: go vet and tests, pytest, tsc, eslint on changed web files, then
`web/scripts/checks.mjs` (headless Chrome, engine on :8080). By default the UI checks run against a
production build of the worktree (`next build` into `web/.next-verify`, reused while `web/` is
unchanged; `next start` on a free port from 3300, stopped at the end). `--base http://localhost:3100`
points them at a running server instead. Work merges into the preview branch only when a full run
prints `VERIFY: PASS`. A UI check that fails in the full run is rerun once on its own (timing checks can
fail only because other workers keep the machine busy); the run passes if every one of them passes there,
and the PASS line names them, so a check that keeps showing up there is a real flake to fix.

`checks.mjs` holds the owner's locked rules as checks that can fail. Every correction the owner
makes becomes a new check here, so it cannot regress. Run one check with `--only id`, skip with
`--skip id`. Checks that watch a whole Trends replay play it 4x faster (`--replay-speed`, test-only),
with their timings in replay time. The main page's checks run in order while checks with pages of their
own run beside them in separate windows (`--lanes 3`); the scroll-gesture checks wait for the main page.
Each result shows its seconds; the slowest five are listed.

Only one UI phase (build, server, headless Chrome) runs at a time on the machine: verify.sh waits on
`/tmp/nollmit-checks.lock` (it prints the wait; a dead holder's lock is cleared).

## The split
One worker per area of the code, with a scope line naming the files it may edit, so parallel
workers never edit the same file. A shared contract (for example the History chart's design
aspect) is fixed before they start.

## The loop
Each worker builds, runs `scripts/verify.sh --changed` (only the checks tied to the files it changed
against preview/ui; a change to a check's own block runs that check), fixes, and repeats. The full
`scripts/verify.sh` runs once before merge. A check still failing after 3 attempts goes back to the
orchestrator: the plan is wrong, not the code.

## Merge lanes
- Front-end changes on the preview branch: merge once the gate passes.
- Engine or API changes: the gate plus their own tests.
- Main, deploys, production data, money: the owner only.

## The way back
- A rejected item goes back alone, with a scope line. Correct work is never redone with it.
- An accepted correction becomes a check (and a memory note), so the next run starts from it.

## The owner's two approvals
Screenshots of each finished item (taste cannot be checked by code), and the merge to main.

## Cleanup
verify.sh stops its own production server and frees the lock on exit, Ctrl-C included. A worker that
started a dev server ends with `scripts/stop-server.sh <its port>` (dev or production server and its
npm/next wrapper). The check script closes its headless Chrome even when it crashes or is interrupted. The
orchestrator runs `scripts/stop-server.sh` with no ports in every progress update: it lists any Next
server not on :3100 and any headless Chrome older than 30 minutes, and anything that belongs to no
running worker is stopped.

## The owner's preview (:3100)
Never edit `web/next.config.ts`, `tsconfig.json` or anything else that restarts the :3100 dev
server while the owner may have it open: a restart hot-reloads open tabs into a broken mix of old
and new CSS (tiles stretched wall to wall, charts small, empty bands). If such a change is needed,
say so first; after it lands, restart :3100 and ask the owner to hard-refresh (Cmd+Shift+R).
