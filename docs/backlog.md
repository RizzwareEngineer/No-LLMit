# Backlog (proposed, 2026-11-04)

Each becomes a GitHub issue once approved. Value / size / auto-merge-ok.

## Phase 2 (approved in principle during the audit review; confirm)
1. Sessions: 1,000-hand sessions, stacks reset to 2,000 at session start, `session_id` + hand-in-session on every record — high / S / no
2. Balanced seating: 8 orderings where every model sits at every distance from every other once; one per session, recorded on each hand — high / S / no
3. Anonymize model names in the prompt ("Player 3 (BTN)"), real names stay on the site — high / S / no
4. Schema 2 on the engine + Supabase: store reasoning, reasoning tokens, finish reason, upstream host, generation id, temperature, prompt template version; model per seat at hand start; migration — high / M / no
5. Usage tracker: calls, tokens, cost, errors per provider/model/day in Supabase; `/api/usage` and widget read it; survives restarts — med / M / yes
6. Dead-code deletion: per-visitor engine flow, unread past-hands list, unused deps, play-mode engine half (keep the play UI), duplicate TS types, position labels from the engine — med / M / yes
7. Next.js security upgrade (`next upgrade`) — med / S / yes

## Phase 3 (stats and sharing)
8. Stats pipeline over saved hands: bb/100 ± CI, all-in EV, VPIP/PFR/3-bet/AF/c-bet/WTSD/W$SD, fold-when-check-free, error rate, latency, cost per model; persisted; excludes non-ok decisions — high / M / no
9. Persisted leaderboard page backed by the stats, per session and all-time — high / M / yes
10. Shareable hand replay `/hand/<id>` with every model's reasoning — high / M / yes
11. Nightly dataset export to Hugging Face (Parquet + JSONL) and pruning old prompts from Postgres — high / M / no
12. Per-model pages; hand/blunder of the day — med / M / yes
13. Reasoning sanity checks (hallucinated cards, claimed hands, reason/action contradiction) — med / M / yes

## Phase 4 (research)
14. Offline re-query harness over stored prompts: HUD-memory probe, self-consistency, cross-model same-spot (~$1–5 per run) — high / M / no
15. Multi-table engine (TableConfig, table map, model per request) + headless capped research table — med / L / no
16. Flagship showcase sessions (weekly, time-boxed budget) — high / S after 15 / no
17. Replace models with >5% error rate after a week of data — med / S / no

## Small / housekeeping
18. Remaining UX medium items: recent-actions log under the reasoning panel, short seat names, card backs for hidden cards, split-pot winner names — low / S / yes
19. About page: list the models and stakes, fix the budget sentence, example input with a current seat — low / S / yes
20. README: resolve the memory contradiction; link the dataset once it exists — low / S / yes
