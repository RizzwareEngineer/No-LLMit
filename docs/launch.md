# Launch runbook

Every step from "the pull request stack is approved" to "the table is open to the public", in the order they must happen.
Each step says what to set (names and value shapes, never real values), where, and how to check it worked.
`scripts/smoke.sh ENGINE_URL SITE_URL` is the check after any deploy: every line must say PASS.

## 0. Before anything

- Pick a quiet hour: nobody is watching and no hand needs to finish.
- Commits on `feat/sse-stream` after the last stack branch (`pr/31-health-tests-final-docs`) are not in the stack: approve them as their own pull request on top, or leave them out on purpose.
- Know where each deploy comes from: Railway, each service, Settings > Source (the branch it deploys); Vercel, Settings > Git (Production Branch). If they deploy `main` on every push, merging 31 pull requests one by one would deploy 31 half-finished versions.
  Pause that first: on Railway disconnect the branch in Settings > Source (reconnect it in step 4); on Vercel set Settings > Git > Ignored Build Step to "Don't build anything" (set it back in step 5).

## 1. Supabase: the migration, before the merge

The nightly export (`.github/workflows/dataset.yml`, runs from `main`) reads the new `retry_prompt` column, and the new engine saves it.

1. Supabase > the project > SQL Editor > New query.
2. Paste all of `supabase/migrations/20261113000000_decision_prompts_retry_prompt.sql` and Run.
3. Check: `select column_name from information_schema.columns where table_name = 'decision_prompts' and column_name = 'retry_prompt';` returns one row.

It only adds a column and replaces `save_hand` with one that also saves it, so the engine running today keeps working. It is never rolled back.

## 2. Vercel: the engine address, before the merge

A production build reads `NEXT_PUBLIC_API_URL` at build time and fails without it (`web/next.config.ts`), so set it first.

1. Vercel > the project > Settings > Environment Variables.
2. Add `NEXT_PUBLIC_API_URL` = `https://<engine host>` for Production only: the engine's public Railway address, no trailing slash, no `/ws`.
3. Check `NEXT_PUBLIC_SITE_URL` is the site's address (`https://<site host>`, used in link previews).
4. Do not delete `NEXT_PUBLIC_WS_URL` yet (step 6): the site live today was built with it.

## 3. Merge the stack

1. Merge draft pull requests #32 to #62 in number order, each with "Create a merge commit" (never squash or rebase: that rewrites the commits and every later pull request conflicts).
2. After each merge the next pull request's base must read `main`: GitHub moves it when the merged branch is deleted, otherwise click Edit next to the title and change the base.
3. Check: `git fetch && git diff origin/main origin/pr/31-health-tests-final-docs` prints nothing.

## 4. Railway: the LLM service, then the engine

**LLM service** (the `llm/` folder, `llm/Dockerfile`):

| Setting | Value shape |
|---|---|
| `LLM_PROVIDER` | `openrouter` |
| `OPENROUTER_API_KEY` | the key from step 7 (a secret) |
| `LLM_SERVICE_TOKEN` | a long random string, e.g. `openssl rand -hex 32` (a secret); the engine gets the same value |
| `LINEUP` | unset (the default nine), or nine roster names from `llm/registry.py`, comma-separated |
| `PORT` | `5001` (set it, so the private address below has a fixed port) |

- Settings > Networking: no public domain. Delete one if it exists. The engine reaches it over the private network only.
- Deploy it (reconnect the branch, or Deployments > Deploy). Check: the deployment log shows uvicorn started on port 5001 and no traceback.

**Engine** (the `engine/` folder, `engine/Dockerfile`), deployed after the LLM service is up (it reads the turn budget from the service once, at start):

| Setting | Value shape |
|---|---|
| `LLM_SERVICE_URL` | `http://<llm service name>.railway.internal:5001` (the LLM service's private address, Settings > Networking) |
| `LLM_SERVICE_TOKEN` | the same value as the LLM service's (a secret) |
| `SUPABASE_URL` | `https://<project ref>.supabase.co` |
| `SUPABASE_SERVICE_KEY` | the service-role key (a secret) |
| `DAILY_CALL_CAP` | a whole number, model calls per UTC day; 5000 is about $0.41 a day typical, $1.31 worst |
| `TABLE_PACE` | `1` (0.3 plays about three times faster and costs that much more per hour) |
| `TABLE_OPEN_HOUR`, `TABLE_CLOSE_HOUR`, `TABLE_TIMEZONE` | for set hours, for example `9`, `21`, `America/New_York`; leave all three unset for 24 hours |
| `WAITLIST_DAILY_MAX` | about `300` |
| `SITE_URL` | `https://<site host>`, exactly the site's origin, no trailing slash: the only site the waitlist accepts posts from |
| `DEV_CONTROLS` | never set in production (it opens `/dev/pace`) |
| `PORT` | leave it to Railway |

- Deploy it. If the engine deployed before the LLM service finished, redeploy the engine once more.
- Check: the engine log shows `Starting server on :<port>` and no `DEV_CONTROLS=1` line; `curl https://<engine host>/health` gives `{"status":"ok"}`.
- On a non-production deploy only (a fork environment or a local run of the new engine), check that a 51st open stream from one address gets 429.

**Billing:** Railway > Workspace Settings > Usage: set a hard usage limit (the services stop when it is reached) and an email alert below it.

## 5. Vercel: deploy the site

1. Set Ignored Build Step back to "Automatic" if you changed it, then Deployments > the latest `main` commit > Redeploy (or push nothing and wait for the merge build).
2. Check: the build log has no `NEXT_PUBLIC_API_URL is not set` error, and the deployment is marked Production.

## 6. Smoke test, then the old setting

1. Run `scripts/smoke.sh https://<engine host> https://<site host>`. Every line PASS; `/api/usage` says the table open, or CLOSED outside its hours (fine, but step 8 needs it open).
2. Open the site in a browser: the table moves, the About page loads, nothing in the browser console in red.
3. Then delete `NEXT_PUBLIC_WS_URL` in Vercel (Settings > Environment Variables). Nothing reads it any more.

## 7. OpenRouter: limit the key, then fund it

1. OpenRouter > Settings > API Keys > the production key > Edit: set a credit limit with a daily reset (a few dollars a day covers the cap above with room).
2. Only then add credit. Check: the key page shows the limit and the reset.
3. Without credit the table still runs, but every call fails: each hand is voided, the table shows the outage notice and pauses 5 minutes.

## 8. GitHub: the health check

1. Repository > Settings > Secrets and variables > Actions > Variables > New repository variable: `ENGINE_URL` = `https://<engine host>` (no trailing slash).
2. Actions > Health > Run workflow. Check: the run is green. From now on it runs every 15 minutes and GitHub emails the owner when it fails.

## 9. Twenty hands on real models, watched

The site is reachable but not announced yet. Watch about 20 hands (about 90 minutes at `TABLE_PACE` 1), with the engine log open (Railway > engine > the deployment > View Logs):

- Every move and amount on screen matches what the model's reasoning says it does (a fold is shown as a fold, a raise to 600 as 600).
- The shot clock counts down from the model's budget and the reasoning appears when the model answers.
- Positions are right: the button moves one seat each hand, SB and BB sit after it, the seat before the button is CO.
- No errors in the engine log, no outage or "saving" notice on the table.
- Hands are saved: in the SQL editor, `select count(*) from public.hands where started_at > now() - interval '2 hours';` grows by one per hand.
- Spend matches the estimate: OpenRouter > Activity, about $0.0013 a hand (a 20-hand run is a few cents).

## 10. Open

Share the link. Keep the Railway logs and OpenRouter Activity open for the first hour.

## Rollback

The new engine and the new site go back together: the old site talks to `/ws`, which the new engine does not have, and the new site needs `/stream`.

- **Railway:** the service > Deployments > the last good deployment > the three-dot menu > Rollback (or Redeploy). Engine first; the LLM service only if it is the cause.
- **Vercel:** Deployments > the last good Production deployment > the three-dot menu > Instant Rollback. Its old `NEXT_PUBLIC_WS_URL` value is built into it, so deleting the variable does not break it.
- **Supabase:** leave the migration; the old engine works with it.
- To roll the code back on `main`, revert the merge commits in a new pull request, never a force push.

## When the table stops

- **Daily cap.** The table shows the cap notice and starts again at 00:00 UTC. `/api/usage` shows `callsToday` at `dailyCallCap`. To allow more today, raise `DAILY_CALL_CAP` in Railway; the engine restarts and the hand in progress is lost.
- **"The table is paused until the last hand is saved."** The save to Supabase is failing; the engine retries forever, so fixing the cause resumes play with no restart. Look in the engine log for the save error, then at Supabase: project paused, a changed service-role key (update `SUPABASE_SERVICE_KEY`), or the 500 MB free quota passed (HTTP 402; upgrade or delete old rows).
- **Outage notice, hands voided.** The LLM service or OpenRouter is failing: the key's daily credit limit is reached (it resets daily), the credit is used up, or the LLM service is down (Railway > llm > logs).
- **Health check emails.** Run `scripts/smoke.sh` to see which part fails, then the cases above.
