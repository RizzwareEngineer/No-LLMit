# No-LLMit UX/UI audit

Scope: `/Users/rizzwareengineer/No-LLMit/web/src` at HEAD, the live HTML from https://nollmit.vercel.app and /about (fetched 2026-11-04 01:40 ET, while the table was closed), and the live `/api/usage` response.
Checked against the Vercel Web Interface Guidelines (fetched fresh) and a first-time visitor arriving from a tweet.
No browser was used: layout claims come from reading code and CSS; items that need a real look are marked **[visual check]**.
Contrast numbers were computed from the actual colors against white.

Paths below are relative to `/Users/rizzwareengineer/No-LLMit/web/src/`.

## Ranked findings

### Critical

1. **Phone and small laptops get a clipped, partly unreachable layout.**
   `app/page.tsx:243` centers with `items-center` a row that is 1,000px of table (`components/PokerTable.tsx:121`, 5 columns × 200px) + 24px gap + 240px sidebar (`app/page.tsx:369`) ≈ 1,264px, plus a reasoning panel with `minWidth: 500px` (`app/page.tsx:382`).
   A centered flex child wider than its parent overflows equally on both sides, and the left overflow cannot be scrolled to, so at 375px the left ~445px (seat 1, seats 9/8, the start of each row) is cut off; even a 1,280px laptop overflows by ~8px.
   Smallest fix: change `items-center` to `items-center-safe` (Tailwind v4) on `app/page.tsx:243` and `:345`, so it scrolls instead of clipping.
   Real fix for phones: below `md`, render seats as a single-column list (or 3×3 grid) with the felt on top, P&L below, and drop the `minWidth: 500px`. **[visual check]**

2. **Link previews from a tweet are bare.**
   `app/layout.tsx:11-14` has only `title` and `description`; the live `<head>` has no `og:*`, `twitter:*`, or preview image, so the tweet unfurls as plain text with no picture of the table.
   Fix: add `openGraph` + `twitter: { card: "summary_large_image" }` to `metadata`, and an `app/opengraph-image.png` (a screenshot of a hand with reasoning showing).

3. **A newcomer cannot tell what this is in 10 seconds.**
   The only explanation is a 12px, 65%-gray line (`app/page.tsx:248-249`) that says "Spectate (or play against) SOTA LLMs", followed by two disabled "coming soon" buttons (`:272-285`) as the first things you can click.
   Nothing says each seat is a different AI model, that the reasoning below is the model's own words, or that this is live.
   Fix: replace the tagline with one 14-15px dark line such as "9 AI models play No Limit Hold'em against each other, live. Watch each one explain its move." and delete or demote the two coming-soon buttons (move them to /about's Upcoming Features, which already lists them).

### High

4. **The closed table (9pm-9am ET) looks like a broken site.**
   The engine sends the closed notice as an `error` message (`engine/api/table.go:138-142`), so the page shows it in the mustard error bar with "⚠️" and a "Dismiss" button (`app/page.tsx:460-484`); after Dismiss, the only trace is 9px text in the usage widget (`components/UsageIndicator.tsx:117-121`).
   A tweet reader in another time zone sees a frozen board and a warning, with no reopen time in their own zone.
   Fix: send the notice as its own message type (or flag it) and render it on the felt as "Table closed, reopens in 7h 12m (9:00 AM your time)" via `Intl.DateTimeFormat`; until replays exist, link to /about from that card.

5. **The closed/cap banner never clears when the table reopens.**
   The engine clears `t.notice` silently (`engine/api/table.go:147-153`, `:347-349`) and the client only clears `error` on connect or Dismiss (`hooks/useGameState.ts:195`, `:338`), so a tab left open overnight shows "The table is closed" over a live game.
   Fix: clear `error` when a `game_state`/hand-start message arrives, or have the engine broadcast an empty notice.

6. **Connection failure spins forever.**
   When disconnected, the banner always shows "Connecting to game server..." (`app/page.tsx:463-467`) and hides `error`, even after the 5 reconnect attempts are exhausted (`lib/api.ts:213-216`); the Retry button only appears if `error` is set.
   Fix: track a `gaveUp` state and show "Can't reach the game server." with a Retry button; render the felt placeholder as "Connecting to the table…".

7. **The usage widget shows wrong numbers on prod.**
   Live `/api/usage` returns `spend: null`, so the widget prints "Spend: $0.00" (`components/UsageIndicator.tsx:56`, `:100`) while the bar beside it is actually calls-today/cap (`:59-61`), mixing two metrics under one "Spend" label.
   Fix: when `spend` is null, hide the Spend row and label the bar "Calls today 104 / 5,000".

8. **The leaderboard can be dragged into a false order.**
   `components/WinningsPanel.tsx:83-94` uses `Reorder.Group`/`Reorder.Item`, which are draggable by default and call `onReorder={setRankedPlayers}`, so any visitor can drag a loser to rank 1 until the next update.
   Fix: replace with `motion.ol` / `motion.li layout` (keeps the reorder animation, no drag), or pass `dragListener={false}` to each item.

9. **"Who is winning" is under "API Usage".**
   The sidebar puts the cost widget first (`app/page.tsx:371`) and the P&L list second (`:374-376`); P&L numbers are 10px, have no ¤ or "chips" unit (`components/WinningsPanel.tsx:52-66`), and no tabular figures.
   Fix: put `WinningsPanel` first, title it "Leaderboard (chips won/lost)", bump to 12-13px with `tabular-nums` and the ¤ prefix; move usage below it.

10. **Text contrast and size fail WCAG across the table.**
    Measured on white: `rgba(55,53,47,.35)` = 1.98:1 (rank numbers, zero P&L, "WAITING"; `components/WinningsPanel.tsx:43,66`, `components/Player.tsx:122`), `.4` = 2.21:1 ("Spend:", "Calls today:", idle text; `components/UsageIndicator.tsx:86,105`, `components/ReasoningPanel.tsx:134`), `.5` = 2.81:1.
    White on position badges: amber-500 2.15, green-500 2.28, red-300 1.90, purple-400 2.64, red-400 2.77 (`components/Player.tsx:18-28`) at 8px; white on the mustard banner 2.75:1 (`app/page.tsx:461`).
    Sizes go down to 7px (`components/TableFelt.tsx:89`), 8px badges, 9px labels.
    Fix: floor muted text at `rgba(55,53,47,.65)` (4.19:1; .7 to pass 4.5), use -600/-700 shades for badge backgrounds, dark text on the mustard bar, and a 11px minimum.

11. **Screen readers get a scrambled, silent table.**
    The seat grid is a data `<table>` used for layout (`components/PokerTable.tsx:129`), so it announces a 5-column table with empty cells and reads seats as 1,2,3,9,felt,4,8,5,7,6.
    Cards have no accessible name: rank is text, suit is an unlabeled icon (`components/Card.tsx:52-57`), so "K♥" reads as "K".
    No `aria-live` anywhere: actions, reasoning, winners, and the closed/error bar are all silent.
    Fix: `role="presentation"` on the `<table>`; `role="img" aria-label="King of hearts"` on each card (blank card: `aria-label="hidden card"`); an `aria-live="polite"` visually-hidden line in `ReasoningPanel` that announces "{player}: {action}. {reason}" with the full text (not the typewriter partials); `role="status"` on the bottom bar.

### Medium

12. **No reduced-motion support.**
    Infinite `notion-pulse` on the active seat (`app/globals.css:33-50`), `animate-pulse` on the button-winner box and cursor (`components/TableFelt.tsx:94`, `components/TypewriterText.tsx:70`), spin icons, card fly-ins (`components/Card.tsx:40-44`), the typewriter, and reorder animations all ignore `prefers-reduced-motion`.
    Fix: wrap the app in `<MotionConfig reducedMotion="user">`, add `@media (prefers-reduced-motion: reduce)` disabling the pulse/spin, and show the full reason instantly in `TypewriterText` under that query.

13. **Reasoning, the main hook, is truncated and fleeting.**
    The panel is a fixed 100px with `line-clamp-3` and shrinks long reasons to 11px (`components/ReasoningPanel.tsx:60-67`, `:127`); there is no way to read the rest or see the previous player's reasoning.
    Its width (`50vw`, 500-700px; `app/page.tsx:382`) doesn't match the 1,264px row above, so it sits left-aligned under part of the table. **[visual check]**
    Fix: make it full row width (`w-full`) and add a small scrollable "Recent actions" log (last ~10 actions with reasons) below it; keep the fixed height for the live line.

14. **Long model names are truncated in seats.**
    At `lg` the seat puts name and two 28px cards side by side in a 200px cell (`components/Player.tsx:65-84`), leaving ~70px for 11px names like "Cohere Command R7B", "DeepSeek V4 Flash". Below `lg` the row stacks (`flex-col`) inside a fixed 100px cell with `overflow-hidden`, which likely clips the action line. **[visual check]**
    Fix: show a short display name in seats (full name in `title`), or put the cards on the second row.

15. **Usage widget / donate popup are mouse-only.**
    The whole card is a `div onClick` (`components/UsageIndicator.tsx:67-71`): not focusable, no keyboard, no `aria-expanded`; the popup opens upward (`:131-132`) over the status row and doesn't close on Escape or outside click.
    Fix: make "Support this project" a real `<a href="https://github.com/sponsors/RizzwareEngineer">` and drop the popup; or make the card a `<button aria-expanded>`.

16. **Stale or wrong copy.**
    - "SOTA LLMs" (`app/page.tsx:249`, `app/about/page.tsx:83`): the lineup is small models (Llama 3.1 8B, Gemma 3 12B, Phi-4, Mistral Nemo, R7B; `lib/constants.ts:4-14`). Say "9 small/fast LLMs" or name them.
    - "(or play against)" and "(or, soon, tournament)": play is disabled; drop both.
    - "Start a new game to begin" shows to spectators while connecting (`components/PokerTable.tsx:113`, visible in the live SSR HTML). Use "Connecting to the table…".
    - "Play vs. LLMs — (coming soon)!" punctuation (`app/page.tsx:277`).
    - "Spectating" indicator (`app/page.tsx:294-298`) means nothing when spectate is the only mode; replace with "Live · N watching" (the API already returns `spectators`).
    - Hours: engine says "9am to 9pm EST" (`engine/api/table.go:122`), About says "ET"; cap notice says "resumes at midnight UTC" (`engine/api/table.go:355`), which is 7-8pm ET. Show local times.
    - `...` instead of `…`: `app/page.tsx:466`, `components/ReasoningPanel.tsx:112,135`, `components/TypewriterText.tsx:64`.
    - ¤ is never explained; add "¤ = chips, not real money" once (header or P&L title).

17. **About page: key facts missing, long lines, and stale bits.**
    - It never lists the 9 models, the stakes (5/10, 2,000-chip start; `lib/constants.ts:19-23`), what P&L measures, or what happens when a model busts.
    - "To keep costs down, the table runs on a fixed monthly budget:" is followed by opening hours, not a budget (`app/about/page.tsx:147-152`).
    - "~150 hands per day" (`:166`) vs. a 5,000-call cap at ~15 calls/hand (≈330); check which is true.
    - Example input uses "GPT-4" (`:12-20`), not a current seat.
    - "Thinking Machine's Lab" → "Thinking Machines Lab" (`:227`); "🫷Upcoming Features" missing space (`:206`); Tinker listed as a cost under "Why Donate" though not used yet (`:189-191`).
    - Body text spans `max-w-[1300px]` (`:74`), giving ~170-character lines for the hero and orange callout; wrap prose in `max-w-prose`.
    - `Toggle` buttons lack `aria-expanded` (`:37-48`); footer at `opacity-40` fails contrast (`:253`).
    - Leftover commented-out JSX (`:151`, `:155-159`, `:165`).

### Low

18. `/play` (`app/play/page.tsx`) is still routable, uses `alert()` (`:24`) and an older stone-100 style; delete it or redirect to `/` until play ships.
19. Logo `alt="{model} logo"` (`components/LLMLogo.tsx:45`) duplicates the name printed next to it; use `alt=""`.
20. No `<main>` landmark or skip link on `/` (`app/page.tsx:242`); `color-scheme: light` and `<meta name="theme-color" content="#ffffff">` missing (`app/layout.tsx`).
21. Hover handlers via inline `onMouseEnter` on non-interactive seats and rows (`components/Player.tsx:62-63`, `components/WinningsPanel.tsx:40-41`) imply clickability; remove.
22. Blank hole cards render as empty white boxes (`components/Player.tsx:79-82`) while a styled card back exists (`components/Card.tsx:59-63`); pass `faceDown` for a finished look.
23. Winner box shows only the first winner and "+N more" (`components/TableFelt.tsx:60-69`); split pots lose names.
24. Stacks, P&L, pot, and elapsed timer lack `tabular-nums`, so numbers jitter as they change.

## What is good and should stay

- Four-color deck (hearts red, diamonds blue, clubs green, spades dark) plus distinct suit shapes; color is never the only cue.
- Active seat uses `outline` with negative offset, and the reasoning panel has a fixed height: no layout shift as turns change.
- The shot clock, "THINKING" state on the seat, and the typewriter reveal make the turn rhythm legible.
- NumberFlow pot and animated leaderboard reordering (keep the animation, lose the drag).
- Real model logos with explicit width/height.
- About page transparency: the exact system prompt, a real example input/output, and the bold "No memory between calls" callout. This is the most credible thing on the site; surface a one-line version of it on the main page.
- Zoom is not disabled (`initial-scale=1`, no `maximum-scale`); buttons have a `:focus-visible` ring.
- One shared table that everyone watches; dev controls are gated to `NODE_ENV === 'development'`.

## Not checked

- No rendering in a real browser: overflow clipping, seat truncation, and reasoning-panel alignment need a visual pass at 375px, 768px, 1280px and 1440px.
- The open-table state live (it was closed at audit time), and real screen-reader output.
