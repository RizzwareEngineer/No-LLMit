# Backlog

Work not started yet, each with value / size / whether an agent may merge it. Checked against the code on 2026-11-13: none of it exists.

1. Sessions: 1,000-hand sessions, stacks reset to 2,000 at session start, `session_id` and hand-in-session on every record — high / S / no
2. Balanced seating: 8 orderings where every model sits at every distance from every other once; one per session, recorded on each hand — high / S / no
3. Usage tracker: calls, tokens, cost and errors per provider, model and day in Supabase, read by `/api/usage` (today the call count lives in the engine's memory and resets on restart, and spend is OpenRouter's total for the key) — med / M / yes
4. Shareable hand replay `/hand/<id>` with every model's reasoning — high / M / yes
5. Per-model pages; hand and blunder of the day — med / M / yes
6. Reasoning sanity checks (hallucinated cards, claimed hands, reason and action that disagree) — med / M / yes
7. Offline re-query harness over stored prompts: memory probe, self-consistency, cross-model same spot (about $1-5 a run) — high / M / no
8. Multi-table engine and a headless research table with its own budget; open questions in [system-design.md](system-design.md), "Not decided" — med / L / no
9. Weekly flagship sessions with a time-boxed budget — high / S after 8 / no
10. Replace models with over 5% errors after a week of data — med / S / no
11. Prune old hands from Postgres once the nightly export publishes them, or move to Supabase Pro — med / S / no

Who sits at the table is the owner's call: the candidates and their prices are in [llm/README.md](../llm/README.md), and `LINEUP` seats them.
