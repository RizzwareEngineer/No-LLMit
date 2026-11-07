# How agent work is built and merged

## The gate
`scripts/verify.sh` runs: go vet and tests, pytest, tsc, eslint on changed web files, then
`web/scripts/checks.mjs` (headless Chrome against a running dev server and engine). Work merges
into the preview branch only when it prints `VERIFY: PASS`.

`checks.mjs` holds the owner's locked rules as checks that can fail. Every correction the owner
makes becomes a new check here, so it cannot regress. Run one check with `--only id`, skip with
`--skip id`, point at an agent's own dev server with `--base http://localhost:PORT`.

## The split
One worker per area of the code, with a scope line naming the files it may edit, so parallel
workers never edit the same file. A shared contract (for example the History chart's design
aspect) is fixed before they start.

## The loop
Each worker builds, runs the gate (its checks plus the locked ones), fixes, and repeats until it
passes. A check still failing after 3 attempts goes back to the orchestrator: the plan is wrong,
not the code.

## Merge lanes
- Front-end changes on the preview branch: merge once the gate passes.
- Engine or API changes: the gate plus their own tests.
- Main, deploys, production data, money: the owner only.

## The way back
- A rejected item goes back alone, with a scope line. Correct work is never redone with it.
- An accepted correction becomes a check (and a memory note), so the next run starts from it.

## The owner's two approvals
Screenshots of each finished item (taste cannot be checked by code), and the merge to main.
