# Rules for every loop run (read first)

You are alone in a cloud VM on the owner's PUBLIC repository RizzwareEngineer/No-LLMit (main deploys production).
- Branch: `git fetch origin && git checkout -b work/<your-run-name> origin/work/loop-base`. Push ONLY to that branch. Never push to main or any other branch, never force-push, never open a pull request, no secrets in any file, never call production or a paid service, no subagents, never message the owner.
- HARD DEADLINE 2 hours 30 minutes from your first `date -u`; at 2 hours 10 minutes stop starting anything new, commit, push, report. PUSH AFTER EVERY COMMIT. Commit your report `.cloud-out/<RUN>.md` early and update it as you go. If a command is refused by a transient permission-checker error, wait a minute and retry it; never work around the checker. Commands time out after 10 minutes: run long things with nohup ... & and wait in loops of at most 9 minutes.
- Read `.cloud-out/LOOP-DESIGN.md` (the adversarially reviewed loop design). Your run is one node of it.
- Before you change product code, write in your report the one mechanism metric you will move and your predicted gain. Commits that change checks, the harness or fixtures are their own commits with the reason in the message; never weaken a check. Every new check must first be shown to fail on the base for the right reason.

## VM recipe
- Mock models: `cd llm && LLM_PROVIDER=mock nohup uv run --quiet --no-project --with-requirements requirements.txt python -m uvicorn app:app --host 127.0.0.1 --port 5001 > /tmp/llm.txt 2>&1 &`
- Engine: `cd engine && go build -o /tmp/engine-bin .`; data: 2 sessions of about 300 hands (`env -u SUPABASE_URL -u SUPABASE_SERVICE_KEY PORT=8080 HAND_LOG_DIR=$HOME/.nollmit-hands LLM_SERVICE_URL=http://localhost:5001 TABLE_PACE=0.001 DAILY_CALL_CAP=1000000 /tmp/engine-bin`, restarted between), then a final session with the same env plus DEV_CONTROLS=1, about 400 hands at 0.001 without restarting, then `curl -X POST 'localhost:8080/dev/pace?pace=0.3'`.
- Site: `cd web && npm ci && NEXT_PUBLIC_API_URL=http://localhost:8080 npx next build && (nohup npx next start -p 3300 > /tmp/site.txt 2>&1 &)`. Kill stale servers with `pkill -f '^next-server'`. Headless Chrome: $CHROME_PATH with puppeteer-core from web/node_modules. Browser zoom W x H at z = viewport round(W/z) x round(H/z), deviceScaleFactor z. The phone/desktop switch is web/src/lib/layout.ts (desktop from 992 CSS px wide and 501 tall).
- UI checks: `cd web && node scripts/checks.mjs --base http://localhost:3300 --lanes N --only <ids>` (--query k=v adds URL parameters). Full suite about 50 minutes at --lanes 2. Lighthouse, axe and contact sheets: web/scripts/audit.mjs.
- Must pass before your last code commit: `cd web && npx tsc --noEmit && node --experimental-strip-types --test src/lib/*.test.mjs && npx eslint src --quiet`.

## Owner rules (never break)
One number format (en-US thousands separators); text at least 11px; UI text on one line; content hugs its container, no empty bands; each phone Stats window fills the screen; the About dial's faded rows stay; the desktop table is locked (seats 200x128, table 1000px); the Trends y axis follows the owner's 2026-11-08 dynamic rule; a figure on screen that disagrees with the engine is mission-critical; the seat drafts (?seat=), shape drafts (?shape=) and About layouts (?about=) wait for the owner's pick: do not change their geometry or the defaults. phone-table-ownership and phone-table-places on the default seat are expected to fail until he picks.

## Report
`.cloud-out/<RUN>.md`: the metric and predicted gain, what you changed (commit per idea), measured results with intervals (or "inconclusive"), checks run and results, what you left open, your honest read. Commit messages: plain, one sentence, ending with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
