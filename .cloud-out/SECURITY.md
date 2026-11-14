# Security audit: No-LLMit, branch work/security (base 4e361d1)

**Verdict: safe to open-source. No secret has ever been committed, and nothing a visitor can do makes the engine call a model. Four defense-in-depth fixes are on this branch. Two items need your settings on Railway and OpenRouter before launch.**

## Leaked secrets

**None.** I scanned all 298 commits on every branch (main, work/security, work/peel2, feat/sse-stream). There are no tags. The scan used `git log --all -p` plus a regex sweep for OpenRouter (`sk-or-v1-`), Anthropic (`sk-ant-`), OpenAI (`sk-`/`sk-proj-`), Supabase JWTs (`eyJ…`), `sb_secret_`/`sb_publishable_`, GitHub tokens (`ghp_`/`gho_`/`github_pat_`), Hugging Face (`hf_`), AWS (`AKIA`), Slack, private-key blocks, `postgres://user:pass@` strings, and any `KEY/TOKEN/SECRET/PASSWORD/_URL=` assignment with a value.

- The only matches are placeholders (`OPENROUTER_API_KEY=sk-or-your_api_key_here`, empty `SUPABASE_SERVICE_KEY=`) and public URLs.
- No `.env`, `.log`, key or database file has ever been added. `.gitignore` ignores `.env*`, `*.log`, `data/` and `dataset/out/`.
- No Supabase project ref, `*.up.railway.app` host or `*.railway.internal` host appears anywhere in history. The only public host named is `nollmit.vercel.app`.
- **Minor (history only, not a secret):** docs/audit/*.md, since deleted, held the local path `/Users/rizzwareengineer/No-LLMit` 16 times. That is the same handle as the GitHub account, so it reveals nothing new. It is still in history, and per the brief I did not rewrite history.
- The dataset fixtures (`dataset/tests/fixtures/*.jsonl`) are generated mock hands with no personal data. Test e-mail addresses are all `@example.*`.

No secret needs rotating.

## Findings

| # | Severity | What an attacker does | Where | Status |
|---|---|---|---|---|
| 1 | Medium (only if the llm service is ever reachable) | `POST /decide` on the llm service with `{"player_name":"<any roster model>", …}` makes a paid OpenRouter call. Your daily cap is not involved: `DAILY_CALL_CAP` lives in the engine (`engine/api/table.go:94,260`) and the llm service has no cap or auth of its own (`llm/app.py`, `/decide`). Its FastAPI `/docs` and `/openapi.json` also describe the API. | `llm/app.py:36-37,74` | **Fixed in 658ba2d.** An optional `LLM_SERVICE_TOKEN` is now supported: when set, every route but `/health` needs `Authorization: Bearer <token>` (compared in constant time), and the engine sends it on every request (`engine/client/llm.go`). The API docs routes are removed. Tests: `llm/tests/test_app.py`, `engine/client/llm_test.go`. Takes effect once you set the token (deploy settings below). The main protection is still that the service has no public domain. |
| 2 | Medium (depends on Railway, unverified) | Holds all 6,000 stream slots so real viewers get 503. The 50-per-address limit trusts `X-Real-IP` as-is (`engine/api/waitlist.go:198-204`). If Railway's edge passed a client-supplied `X-Real-IP` through, one client could send `X-Real-IP: <random>` on each `GET /stream` and fill the cap from one machine; the same would apply to the waitlist's 5-per-hour limit (the 5,000/day ceiling still holds). Even with an honest header, IPv6 is grouped by /64, so a free tunnel-broker /48 gives an attacker 65,536 buckets. 120 of them (×50) fill the cap. | `engine/api/stream.go:20-22,180-200`, `engine/api/waitlist.go:198` | **Not fixed in code.** A code change cannot tell a forged header from a real one, and grouping IPv6 more widely would lock out mobile carriers. Verify the header (deploy settings). If it is honest, this is the usual cost of an open stream: about 120 addresses. Tighter limits need an edge or CDN rate limit. |
| 3 | Low (local only) | With `DEV_CONTROLS=1` on your machine, `/dev/pace` answered `Access-Control-Allow-Origin: *` and read `?pace=` from a POST. Any website you visited could send a form POST to `http://localhost:8080/dev/pace?pace=2` and change the pace. | `engine/api/server.go:121,126` | **Fixed in 047ab52.** Requests with an `Origin` that is not `http://localhost`/`127.0.0.1` get 403. Tested in `server_test.go`. I checked every path to setting `DEV_CONTROLS`: only `os.Getenv`. No Dockerfile, `railway.json`, script (`scripts/dev.sh` does not set it) or `.env` loader sets it, and the engine does not read `.env` files. Without it, `/dev/pace` is a 404, which a test and `scripts/smoke.sh` check. |
| 4 | Low | Builds `llm/` locally with `docker build` while `llm/.env` holds the OpenRouter key: `COPY . .` bakes the key into the image, and pushing it anywhere leaks it. Railway builds from git, where `.env` is not present, so production images are clean. | `llm/Dockerfile:7`, `engine/Dockerfile:9` | **Fixed in 447bc76.** Added `llm/.dockerignore` and `engine/.dockerignore`, which exclude `.env*` (except `.env.example`), `data/` and caches. |
| 5 | Low | The site had no CSP or Permissions-Policy and sent `X-Powered-By: Next.js`. Framing was already blocked by `X-Frame-Options: DENY`. | `web/next.config.ts` | **Fixed in 11dc007 + 78c56b5** (the headers unit test updated to match). It adds `Content-Security-Policy: frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'`, `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()` and `poweredByHeader: false`. I checked these against a local `next build` + `next start`, and `/` and `/about` returned 200. A full `script-src` CSP still waits on hashes for the two inline scripts (`web/src/app/page.tsx:465,469`). They are static source with no data, so they are not an injection point. |
| 6 | Low (accepted) | Membership oracle: `POST /api/waitlist {"email":"victim@x.com"}` then compare the returned count with `GET`. The count goes up only for a new address, so this shows whether someone was already on the list. It is documented behaviour and limited to 5 tries per address per hour. | `engine/api/waitlist.go:50-55,96-103` | Not changed: the site uses the count. If you want this closed, have a POST for an address already on the list return the cached count without refreshing it, or return no count on POST at all. |

### Checked and holding (refuted)

- **No outsider can make the engine spend money.** The table drives every model call itself (`engine/api/table.go:282` Run → playTurn). No HTTP route calls `/decide`. `/api/usage` is fetched from the llm service at most once a minute (`server.go:95-111`). `/api/stats` and `/api/stats/timeline` serve a pre-gzipped cached body (`stats.go:267-283`).
- **Engine routes:** `/health`, `/stream`, `/api/usage`, `/api/stats`, `/api/stats/timeline`, `/api/waitlist`, plus `/dev/pace` only with DEV_CONTROLS=1. CORS `*` is fine on read-only public data. Only the waitlist reads a body: 1 KB `MaxBytesReader` and a 5 s read deadline. Errors are generic strings, and Supabase response bodies are logged server-side only and never returned. `ReadHeaderTimeout` is 10 s and `IdleTimeout` 120 s.
- **Stream:** each write has a 10 s deadline (60 s for a snapshot), so a slow reader is dropped, not buffered. A ring of 50 frames is shared by all viewers. Streams close after 10–14 min. The per-address map is cleaned on disconnect.
- **Waitlist:** checks `Content-Type: application/json` (so a cross-site POST needs a preflight), checks `Origin` against SITE_URL/localhost, applies 5 tries per address per hour and a daily maximum of 5,000 new rows that are reserved before insert, and the per-address map is capped at 10k entries. Addresses are 254 chars max, printable ASCII, strict `net/mail`, cannot start with `= + -` (CSV formula injection), and are stored lowercased. The insert is JSON through PostgREST, so there is no SQL injection. Addresses are never logged or returned.
- **Site:** model output, model names and stream data reach the page only as React text. There is no `innerHTML` or markdown renderer. The only `dangerouslySetInnerHTML` is the static `BEFORE_PAINT` source. Links built from data are `#model=<slug>` fragments, and logos come from a fixed map. Every `target="_blank"` has `rel="noopener noreferrer"`. There are no third-party scripts, no `vercel.json`, and no Next API routes or middleware.
- **Supabase (migrations):** RLS is enabled on `system_prompts`, `hands`, `decision_prompts`, `dataset_waitlist`, `hands_voided` and `decision_prompts_voided`, with no policies, so `anon`/`authenticated` can neither read nor write. `save_hand` is SECURITY INVOKER with `search_path = ''`, EXECUTE is revoked from `public, anon, authenticated` and granted to `service_role` only, and both migrations repeat this.
- **CI:** `ci.yml` runs on `pull_request` (not `_target`), with `contents: read`, no secrets, and actions pinned to SHAs. A fork's pull request gets no secret and no write token. `dataset.yml` runs on schedule/dispatch only, with `contents: read`; each secret is scoped to the one step that needs it, and dispatch inputs go through `env` (no `${{ }}` in `run:`, so no script injection). It uploads only hands, decision prompts and replies, and system prompts, never the waitlist. `health.yml` uses curl only, no secrets. No workflow uses `workflow_run`.
- **Secrets in logs:** keys go only in request headers. Python `requests` and Go errors print URLs, not headers. The OpenRouter error path keeps `model_id: <requests message>`, which does not include the key.
- **Images:** both run as `nobody`, with no secrets baked in (env comes from Railway). The engine's final stage holds only the binary. One port each. No debug flags.

## Spend: what bounds a day

- `DAILY_CALL_CAP` (default 5,000 turns per UTC day; `table.go:94,250-279`) is checked before each turn and counts the model's retry (`table.go:562,574`).
- Per turn: at most 2 model attempts (the reply retry), each with up to 2 provider-failure retries inside a 45 s budget (`llm/decide.py:14-21,64-80`). A read timeout is never retried. Each request is capped at `max_tokens` 1536 with 1024 reasoning tokens (`llm/providers/openrouter.py:20-21`). The engine waits 50 s at most (`client/llm.go`).
- **Gaps:**
  - The cap is in memory, so every engine restart or redeploy resets it (`railway.json` allows 10 restarts on failure).
  - It counts turns, not HTTP requests. A 5xx or 429 that OpenRouter bills would not be counted.
  - The llm service has no cap of its own (finding 1).
  - The real hard ceiling is therefore a credit limit on the OpenRouter key (deploy settings).

## Deploy settings for the owner (not changed by me)

1. **Railway, llm service:**
   - Settings > Networking: confirm there is **no public domain**.
   - Set `LLM_SERVICE_TOKEN` to `openssl rand -hex 32`, and set the **same** value on the **engine** service.
   - Deploy both. A mismatch shows as 401s from the llm service and fallback moves at the table.
2. **OpenRouter:** set a **credit limit on the key** at the most you will spend per period. That is the only cap that survives restarts and covers every path.
3. **Railway, engine — check the client address header** (finding 2). From one machine, open 51 `GET /stream` connections with different forged `X-Real-IP` values.
   - If the 51st is accepted, the edge passes the header through and the per-address limits can be bypassed. Tell me and I'll switch to the edge's own header.
   - If it gets 429, the edge overwrites the header and the limit holds.
4. **Railway, engine:** make sure `DEV_CONTROLS` is unset and `SUPABASE_SERVICE_KEY` is a variable, not in any file. `SITE_URL` should be the real site origin if it is not `https://nollmit.vercel.app`.
5. **GitHub:**
   - Settings > Actions > General: keep "Require approval for … outside collaborators" (the default for public repos) and default workflow permissions **read-only**.
   - Turn on secret scanning and push protection.
   - The `HF_TOKEN` secret should be a fine-grained token with write access to the dataset repo only.
6. **Supabase:** keep the service-role key only in Railway (engine) and the GitHub `dataset` secrets. The site needs no Supabase key, and none is in the web build.

## Dependency results

- **web:** `npm audit --omit=dev` found 0 vulnerabilities.
- **llm:** `pip-audit -r llm/requirements.txt` found no known vulnerabilities.
- **dataset:** `pip-audit -r dataset/requirements.txt` found no known vulnerabilities.
- **engine:** govulncheck **could not run**, because this environment's network policy blocks `vuln.go.dev` (403). The engine has **no third-party Go modules** (`go.mod` has no `require`), so the only exposure is the Go standard library of the build image. `engine/Dockerfile` uses `golang:1.25-alpine`, which follows the latest 1.25 patch release on each build. Run `govulncheck ./...` in `engine/` once on a normal network to confirm.

## What I did not check

- Production behaviour: by order, there were no requests to the live site, engine, Supabase, Railway, Vercel or OpenRouter. So Railway's handling of `X-Real-IP`, the live headers, whether the llm service has a public domain, and the real Supabase grants beyond the migrations are unverified.
- The Supabase database's actual state, such as policies or grants added in the dashboard outside the migrations.
- GitHub repository settings and secrets (no API access was used).
- The headless UI checks in `web/scripts/checks.mjs` (not run; they were not changed).
- A load test of the stream cap, and fuzzing the poker engine's rules.
- Base images are floating tags (`alpine:latest`, `golang:1.25-alpine`, `python:3.11-slim`). Pinning by digest would make builds reproducible but means manual updates, so I left them.

## Commits on work/security

- 658ba2d: optional `LLM_SERVICE_TOKEN` between the engine and the llm service; llm API docs removed.
- 047ab52: `/dev/pace` refuses requests from other sites.
- 447bc76: `.dockerignore` for the engine and llm.
- 11dc007: site CSP, Permissions-Policy, no X-Powered-By.
- 78c56b5: headers unit test updated to match.
- (this commit): .cloud-out/SECURITY.md.

Verification after the fixes, all passing:
- `go vet ./... && go test ./... && go test -race ./api/...`
- llm pytest: 227 passed, 1 skipped
- dataset pytest: 16 passed
- `npm ci && npx tsc --noEmit`
- web node tests: 23 passed
