# Backlog (open items only)

Each becomes a GitHub issue once approved. Value / size / auto-merge-ok.
Checked against the code on 2026-11-13: sessions, seating orderings, replay pages, per-model pages, reasoning checks, multi-table and pruning do not exist yet.

1. Sessions: 1,000-hand sessions, stacks reset to 2,000 at session start, `session_id` + hand-in-session on every record — high / S / no
2. Balanced seating: 8 orderings where every model sits at every distance from every other once; one per session, recorded on each hand — high / S / no
3. Usage tracker: calls, tokens, cost, errors per provider/model/day in Supabase; `/api/usage` reads it and it survives restarts (today the engine caches the LLM service's in-memory figures) — med / M / yes
4. Shareable hand replay `/hand/<id>` with every model's reasoning — high / M / yes
5. Per-model pages; hand/blunder of the day — med / M / yes
6. Reasoning sanity checks (hallucinated cards, claimed hands, reason/action contradiction) — med / M / yes
7. Offline re-query harness over stored prompts: HUD-memory probe, self-consistency, cross-model same-spot (~$1-5 per run) — high / M / no
8. Multi-table engine (TableConfig, table map, model per request) + headless capped research table; open questions in system-design.md "Not decided" — med / L / no
9. Flagship showcase sessions (weekly, time-boxed budget) — high / S after 8 / no
10. Replace models with >5% error rate after a week of data — med / S / no
11. Prune old hands from Postgres (the nightly export to Hugging Face already exists) or move to Supabase Pro — med / S / no

## Open question
- Candidate models are in the roster (`llm/registry.py`) with OpenRouter prices; the owner picks who to seat via LINEUP.
