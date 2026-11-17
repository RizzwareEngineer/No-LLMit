# web/scripts

Checks (`checks.mjs`), audits (`audit.mjs`), traces (`perf-trace.mjs`) and the films and sweeps beside them. Each file's header says how to run it.

## The fixture (`fixture/`)

The real engine on frozen inputs, so a run sees the same data every time and makes no call it was not meant to.

- **Inputs.** `snapshot.jsonl.gz` is a 1,250-hand log in five sessions (150, 150, 300, 325, 325), built by `gen-snapshot.sh` with the real engine and the mock model, both seeded. Its first 300 hands are the small size. The engine and the mock model take test-only flags; production sets none of them:
  - engine: `FIXTURE_SEED` (seeds the deck), `FIXTURE_LINEUP` (seats the names given), `FIXTURE_STREAM_LIFE_S` (closes each stream after that many seconds);
  - mock model (`llm/providers/mock.py`): `MOCK_SEED`, `MOCK_BETS=big` (every bet at the maximum), `MOCK_REASON_REPEAT` (longer reasons).
  Rebuilding with the same seed gives the same hands, apart from ids and times.
- **Serve.** First build the site once against the fixture's engine port: `NEXT_DIST_DIR=.next-fx NEXT_PUBLIC_API_URL=http://localhost:8090 npx next build`. Then run `scripts/fixture/serve.sh --size 300|1250 --state live|typing|closed|cap|reconnect|longnames|bigbets` (states combine with commas). It starts the seeded mock model (:5190), the engine on a copy of the snapshot (:8090), the site (:3301) and the guard (:8899). Stop it with Ctrl-C or `pkill -f fixture/serve.sh`, which stops all of them.
- **Endpoint guard.** `run.sh VIOLATIONS -- <command>` runs any Puppeteer or Lighthouse tool with `CHROME_PATH=chrome.sh`, which sends every request through `guard.mjs`. The guard forwards the site and the engine's own endpoints and answers anything else with a 599. The run fails (exit 3) when there was any such request, and the requests are listed. Chrome's own calls to Google service hosts are logged apart (`VIOLATIONS.chrome`), because branded Chrome makes them whatever its flags say.
- **Frozen screenshot mode.** `serve.sh --freeze N` makes the guard serve the first N stream events of a fresh engine, then a paused table, and the same engine reads to every page. `frozen.mjs --out DIR` pins the page clock to the moment those events were read, finishes CSS animations, waits until boxes and text hold still for 3 s, pauses virtual time and saves a PNG plus every box and text. `frozen.mjs --compare A B` diffs two captures. All of it lives in the harness; no site build contains any of it.
- **A/A.** `aa.mjs --a URL --b URL --pairs 30` measures the same build on two ports in interleaved pairs (Lighthouse mobile plus a 4x-CPU trace) and prints the noise of each metric and the runs needed to see a 5% change.

Results of the first run, including verdicts against the live mock engine and the A/A, are in `.cloud-out/loop-fixture.md` on the `work/loop-fixture` branch.
