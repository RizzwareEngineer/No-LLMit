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

## Open design questions (2026-11-04)
- Per-model view: the drawer stays for now; decide later how a model's detail fits the one-screen-per-concern layout (third screen? inline expand? separate page?).
- Phone overview: the five stacked previews are ~140px tall each; decide whether phones get a list of titles instead of previews.
- Phone table screen is ~2 windows tall; first swipe scrolls inside it before reaching the overview.
- CSS `zoom` on screen 1 under 889px tall (0.86 / 0.8 / 0.75); the real fix is smaller seat cards.
- Pairwise/heads-up/multiway: show only after N hands per cell (small-sample warning exists for the stats table only).
- Open design question: per-model view (drawer stays for now).
- Phone: Stats zoom and All stats still scroll vertically inside the panel; Pairwise zoom uses 9px compact figures.
- At 1280, All stats ellipsises long model names (numbers never clipped).
- Synthetic 1 s wheel stream can page twice after a zoom in `next dev` at 1280 (suspected main-thread stall); untested on prod build and real trackpad.
- "Not seated yet" falls back to the no-hands rule for past sessions (no `seated` in their payload).
- Candidate models (10) are in the roster with OpenRouter prices; owner picks who to seat via LINEUP.
- 1280x720: table screen zoomed to 0.8 (seat text ~11px); only fix is smaller seat cards or allowing screen 1 to scroll.
- UsageIndicator and SessionProgress still 11px.
- Wheel heuristic: a second swipe that cuts into the first one's momentum within ~300 ms is swallowed (next swipe pages); untested on a real trackpad.
- Pairwise net counts only pots among the shown models, so it can differ slightly from P&L (same scope now: live session).
- Mid-street joiner sees actions only for seats with chips in; BET inferred from raise size (engine keeps one lastAction per hand).
- Race/Stats/Pairwise default to the live session via the shared picker; "All time" one click away.
