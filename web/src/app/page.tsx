"use client";

import { useMemo, useState, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import Link from "next/link";
import { MotionConfig } from "motion/react";
import { ArrowDown, CircleNotch } from "@phosphor-icons/react";
import PokerTable from "@/components/PokerTable";
import WinningsPanel from "@/components/WinningsPanel";
import LandingFill from "@/components/LandingFill";
const noSub = () => () => {};
import ReasoningPanel, { Caption } from "@/components/ReasoningPanel";
import SoundToggle, { UnitToggle } from "@/components/SoundToggle";
import UsageIndicator, { useUsage } from "@/components/UsageIndicator";
import StatsSections from "@/components/StatsScreens";
import PlaySoonButton from "@/components/PlaySoonButton";
// The model drawer's code (its chart, its tables) is not in the first load: it loads with the stats (StatsSections
// starts it), or as a pointer or a touch comes to a model's link, so it opens at once; a link opened before then waits for it.
// Loaded on the first pointer near a model link, or the first model opened, and mounted only once loaded (StatsScreens
// says why: a lazy would finish on a retry lane that a typing reason restarts). A failed load never reaches React: the
// drawer stays closed, one line says it did not load (a chunk a deploy replaced does not come back: reload), and the next
// open tries again.
let drawerChunk: Promise<typeof import("@/components/ModelDrawer")> | null = null;
let ModelDrawer: typeof import("@/components/ModelDrawer").default | null = null; // once loaded
const loadDrawer = () => drawerChunk ??= import("@/components/ModelDrawer").catch(() => import("@/components/ModelDrawer"))
  .then(m => { ModelDrawer = m.default; return m; }, e => { drawerChunk = null; throw e; });
import StickyBar, { PhoneBar } from "@/components/StickyBar";
import TabBar, { type Tab } from "@/components/TabBar";
import SessionProgress from "@/components/SessionProgress";
import DevPace from "@/components/DevPace";
import { setTypingPace } from "@/components/TypewriterText";
import { isSoundOn, unlockOnFirstGesture } from "@/lib/sound";
import { useGameState } from "@/hooks/useGameState";
import { EARLY_STREAM } from "@/lib/api";
import { NEXT_BUTTON, NEXT_STYLE, backToOverview, isPaging, pageBy, pageTo, pageToStats, resnap, scrollsInside, stopPaging, useScreen } from "@/components/Section";
import { holdBoxes, useFillIn, useRememberedBox } from "@/lib/boxes";
import { MUTED, BLUE } from "@/lib/stats";
import { PHONE, isPhone, isDraftA } from "@/lib/layout";
import { useLayout } from "@/lib/tableSwitches";

// The URL hash: #model=<slug> opens the model drawer, and Back closes it.
// openedInPage: the drawer's history entry was pushed by a click here, not a deep link, so
// closing it should step back instead of leaving an extra entry behind.
const isModelHash = (h: string) => h.startsWith("#model=");
let lastHash = "";
let openedInPage = false;
let goingBack = false; // history.back() is async: ignore a second close until the hash changes
const subscribeHash = (cb: () => void) => {
  lastHash = window.location.hash;
  openedInPage = false;
  const onChange = () => {
    const h = window.location.hash;
    if (isModelHash(h) && !isModelHash(lastHash)) openedInPage = true;
    lastHash = h;
    goingBack = false;
    cb();
  };
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
};
const closeModel = () => {
  if (!isModelHash(window.location.hash) || goingBack) return; // Back already left the drawer's entry
  if (openedInPage) {
    openedInPage = false;
    goingBack = true;
    history.back();
    return;
  }
  history.replaceState(null, "", window.location.pathname + window.location.search);
  window.dispatchEvent(new HashChangeEvent("hashchange")); // replaceState does not fire it
};

// Fit-to-screen: the stage (table, sidebar, reasoning) takes one uniform zoom so the whole
// table screen fits the window, up to 125% (the size the owner chose) and down to 75%; below
// that the screen scrolls instead of shrinking further. Browser zoom shrinks the CSS viewport,
// so it lowers this scale and is never fought. The phone layout (lib/layout's PHONE, passed in) is at 1.
// The stage's width as drawn (at most the screen's, where it scrolls at the floor) is --stage-w on the root: the
// stats overview, its cards, About and the sticky bar take that column (StatsSections), so every screen has its margins.
// Self-contained (nothing from outside its body): BEFORE_PAINT runs its source inline too.
function fitStage(phone: string) {
  const stage = document.querySelector<HTMLElement>('.stage-zoom'), screen = stage?.closest('section');
  if (!stage || !screen) return;
  if (window.matchMedia(phone).matches) stage.style.zoom = '';
  else {
    const cs = getComputedStyle(screen);
    const kids = [...screen.children];
    // Everything on the screen but the stage: header, gaps, Stats button and padding.
    const chrome = kids[kids.length - 1].getBoundingClientRect().bottom - kids[0].getBoundingClientRect().top
      - stage.getBoundingClientRect().height + parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
    // offsetWidth/offsetHeight are the stage's unzoomed size.
    const s = Math.min(screen.clientWidth / stage.offsetWidth, (document.documentElement.clientHeight - chrome) / stage.offsetHeight);
    stage.style.zoom = String(Math.floor(Math.min(1.25, Math.max(0.75, s)) * 1000) / 1000);
  }
  const w = Math.min(stage.getBoundingClientRect().width, screen.clientWidth);
  document.documentElement.style.setProperty('--stage-w', `${w}px`);
  // The wide stats' one scale (StatsSections' WIDE): laid out at 1480px across and zoomed as one unit to the stage's
  // column, so browser zoom changes only their size, never their layout; at least 0.85, where 13px text draws 11px.
  document.documentElement.style.setProperty('--sz', String(Math.floor(Math.max(0.85, w / 1480) * 10000) / 10000));
}
// The prerendered page, as parsed, before its first paint: the stage fitted and the blank boxes at their remembered sizes
// (lib/boxes), as the effects set them once React has hydrated, so nothing changes size when it does. Run where the
// parser has just passed the table screen, and again after the stats.
const BEFORE_PAINT = `(${fitStage})(${JSON.stringify(PHONE)});(${holdBoxes})(true)`;
const fit = () => fitStage(PHONE);

const PAGE_KEYS: Record<string, 1 | -1> = { ArrowDown: 1, ArrowRight: 1, PageDown: 1, ArrowUp: -1, ArrowLeft: -1, PageUp: -1 };

// How far the screen the window is inside (a [data-screen] taller than the window by more than a few px) can still
// scroll in direction `dir` before its edge; 0 when the window shows a whole screen. A snap point inside it (a phone's
// Profits & Losses) is an edge too: mandatory snapping never rests with one part-way in the window, so a free scroll
// there would only spring back.
// `ahead`: going down, the distance to such a snap point already in the window (null when none).
function roomInside(dir: number) {
  const h = window.innerHeight;
  for (const s of document.querySelectorAll<HTMLElement>('[data-screen]')) {
    const r = s.getBoundingClientRect();
    if (r.top > 1 || r.bottom < h - 1) continue;
    if (r.height <= h + 8) return { room: 0, ahead: null };
    let room = dir > 0 ? r.bottom - h : -r.top, ahead: number | null = null;
    for (const e of s.querySelectorAll<HTMLElement>('[class*="snap-start"]')) {
      if (!/start/.test(getComputedStyle(e).scrollSnapAlign)) continue;
      const t = e.getBoundingClientRect().top;
      if (dir > 0 && t > -1) room = Math.min(room, t - h);
      if (dir < 0 && t < h + 1) room = Math.min(room, -t);
      if (dir > 0 && t > 1 && t <= h + 1) ahead = Math.min(ahead ?? t, t);
    }
    return { room: Math.max(0, room), ahead };
  }
  return { room: 0, ahead: null };
}


export default function Home() {
  const {
    gameState,
    dealAt,
    connection,
    gaveUp,
    tableNotice,
    displayState,
    clock,
    buttonDetermination,
    stats,
    retry,
  } = useGameState();
  useEffect(() => setTypingPace(gameState?.pace), [gameState?.pace]); // reasons type in step with the table's pace
  // Sound starts on the first gesture (SoundToggle does it too, but a phone no longer mounts the desktop status row).
  useEffect(() => {
    if (!isSoundOn()) return;
    const once = unlockOnFirstGesture();
    return () => { window.removeEventListener('pointerdown', once); window.removeEventListener('keydown', once); };
  }, []);

  const [elapsedTime, setElapsedTime] = useState<string>('00:00:00');
  const [counting, setCounting] = useState(false); // the next-hand countdown shows (until dealAt)
  const { usage, error: usageError } = useUsage(connection !== 'connecting'); // the hub counts this page once its stream opens
  const watching = usageError ? undefined : usage?.table?.spectators;
  const isLive = connection === 'open' && !tableNotice;
  // The connection bar only once the server has been unreachable for a while (useGameState): a bar shown and hidden on a
  // normal load moved every screen by its height (--bar-h).
  const bar = connection === 'down';
  // The status label and the hand counter, blinds and timer stand in blank until they are known, then fade in together,
  // with what the label appends (· N watching), so the row changes once and unseen. The label and the hand number hold
  // their remembered widths while blank (lib/boxes), so the toggles beside them do not move when they fill in.
  const statusKnown = connection === 'down' || (!!gameState && (!!usage || usageError));
  const handKnown = statusKnown && (gameState?.handNumber ?? 0) > 0;

  // Timer effect - update elapsed time every second using server's gameStartTime. Before the paint, so the row's first
  // frame has the time and not 00:00:00.
  useLayoutEffect(() => {
    if (!gameState?.gameStartTime) return;
    
    const serverStartTime = new Date(gameState.gameStartTime);
    
    const updateTimer = () => {
      const now = new Date();
      const diff = Math.floor((now.getTime() - serverStartTime.getTime()) / 1000);
      const hours = Math.floor(diff / 3600).toString().padStart(2, '0');
      const minutes = Math.floor((diff % 3600) / 60).toString().padStart(2, '0');
      const seconds = (diff % 60).toString().padStart(2, '0');
      setElapsedTime(`${hours}:${minutes}:${seconds}`);
    };
    
    // Update immediately
    updateTimer();
    
    // Then update every second
    const interval = setInterval(updateTimer, 1000);

    return () => clearInterval(interval);
  }, [gameState?.gameStartTime]);

  // Derived state
  const players = gameState?.players || [];
  const pot = gameState?.pot || 0;
  const communityCards = gameState?.communityCards || [];
  const street = gameState?.street || 'preflop';
  // Use displayState.playerIdx for highlight when actively displaying a player's turn
  // This keeps the highlight on the current player during reasoning + 5s wait
  const currentPlayerIdx = displayState?.playerIdx ?? (gameState?.currentPlayerIdx ?? -1);
  const stakes = gameState?.stakes || { smallBlind: 5, bigBlind: 10 };
  const handNumber = gameState?.handNumber || 0;
  const turnKey = displayState ? `${handNumber}:${displayState.turn}` : ''; // the typing record's key: turns restart each hand
  const winners = gameState?.winners || [];
  const isHandComplete = street === 'complete';

  // All-time stats feed the leaderboard, the drawer and the stats sections; the stream sends them on connect and as each hand is saved.
  // No stats event yet means loading; once the stream has given up with none, that is the error.
  const statsError = !stats && gaveUp ? "can't reach the game server" : null;
  // The phone seat popup's stats: all-time, by model name.
  const seatStats = useMemo(() => (stats ? Object.fromEntries(stats.models.map(m => [m.name, m])) : undefined), [stats]);

  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash, () => '');
  const draftA = useSyncExternalStore(noSub, isDraftA, () => false); // phone draft A (app/a): the landing fill under the caption
  // The URL names no stats screen: an old #stats, #race or #pairwise link opens the page at its top.
  useEffect(() => {
    if (!window.location.hash || isModelHash(window.location.hash)) return;
    history.replaceState(null, "", window.location.pathname + window.location.search);
    const top = () => window.scrollTo({ top: 0, behavior: "instant" });
    top();
    // A production build hydrates before the load event, and the browser still scrolls to the old anchor until then.
    if (document.readyState !== "complete") window.addEventListener("load", top, { once: true });
  }, []);
  const drawerSlug = hash.startsWith('#model=') ? hash.slice('#model='.length) : null;
  // Mounted from the first time a model opens, then kept (it closes as a dialog does).
  const [drawerEver, setDrawerEver] = useState(false);
  const [drawerFailed, setDrawerFailed] = useState(false); // its last load failed, both tries
  useEffect(() => {
    if (!drawerSlug || drawerEver) return;
    let live = true;
    // Not a transition: a model was asked for, and the Trends replay's frames (sync updates) would restart a transition's
    // render of the page until the replay ended (8 s on a phone). A default update renders in one go, and is not lazy.
    loadDrawer().then(() => { if (live) { setDrawerFailed(false); setDrawerEver(true); } }, () => { if (live) { setDrawerFailed(true); closeModel(); } });
    return () => { live = false; };
  }, [drawerSlug, drawerEver]);
  useEffect(() => {
    const near = (e: Event) => { if (e.target instanceof Element && e.target.closest('a[href^="#model="]')) { loadDrawer().catch(() => {}); off(); } };
    const off = () => { removeEventListener('pointerover', near, true); removeEventListener('touchstart', near, true); };
    addEventListener('pointerover', near, { capture: true, passive: true });
    addEventListener('touchstart', near, { capture: true, passive: true });
    return off;
  }, []);

  // Phones: the tab bar's part is where the page is (the table while it shows, else About or the stats); a tap goes to
  // the top of that part: the table, Profits & Losses over the stats (#phone-stats), About. On an opened stats card,
  // Stats goes back to the overview.
  const screen = useScreen();
  // The layout shown (lib/layout): only its own parts are mounted once hydrated (null until then: both, CSS shows one).
  const mounted = useLayout(), desk = mounted !== 'phone', phone = mounted !== 'desk';

  const tableRef = useRef<HTMLDivElement>(null);
  // Plain IntersectionObserver: motion's useInView never reports "out" for an element that
  // starts out of view (a reload below the table).
  const [tableInView, setTableInView] = useState(true);
  const [scrolled, setScrolled] = useState(false); // the sticky bar slides in on a scroll, not on a load below the table
  useEffect(() => {
    let first = true;
    // The top 44px sit under the bar itself, so they do not count as visible. On a phone the row has no box of its own
    // (it lets the caption sit between the table and the sidebar), so the phone table (data-oval; draft A's, data-a-table) is watched too.
    const seen = new Map<Element, boolean>();
    const io = new IntersectionObserver(es => {
      for (const e of es) seen.set(e.target, e.isIntersecting);
      setTableInView([...seen.values()].some(Boolean));
      if (!first) setScrolled(true);
      first = false;
    }, { rootMargin: '-44px 0px 0px 0px' });
    const row = tableRef.current;
    if (row) [row, ...row.querySelectorAll('[data-oval], [data-a-table]')].forEach(e => io.observe(e));
    return () => io.disconnect();
  }, [mounted]); // the phone table mounts and unmounts with the layout

  // The stage's fit (fitStage), kept as the window, the stage or the screen change size.
  const stageRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const stage = stageRef.current, screen = stage?.closest('section');
    if (!stage || !screen) return;
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(stage);
    ro.observe(screen);
    window.addEventListener('resize', fit);
    return () => { ro.disconnect(); window.removeEventListener('resize', fit); };
  }, []);

  // ↑ ↓ ← →, PageUp/PageDown and Space page between screens, unless a field, the drawer or a panel
  // that can still scroll that way has the keys. Down on the last screen goes back to the overview (pageBy).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Space and Shift+Space page like PageDown and PageUp (the browser's own Space scroll stopped wherever proximity snap left it).
      const space = e.key === ' ';
      const dir = space ? (e.shiftKey ? -1 : 1) : PAGE_KEYS[e.key];
      if (!dir || e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || (e.shiftKey && !space)) return;
      const t = e.target instanceof Element ? e.target : null;
      if (t?.closest('input, select, textarea, [contenteditable], dialog')) return;
      if (space && t?.closest('button, a, summary, [role=button], [role=checkbox], [role=switch]')) return; // Space presses those
      const sideways = e.key === 'ArrowLeft' || e.key === 'ArrowRight';
      if (sideways ? t?.closest('.panel-scroll') : scrollsInside(t, dir)) return;
      e.preventDefault();
      pageBy(dir);
    };
    // One wheel or trackpad gesture moves exactly one screen. Wheel inside a panel scrolls the
    // panel until it reaches its end. Events in the paged direction keep the lock alive, so
    // momentum after a flick never pages twice; a reversal is a new gesture and pages at once.
    // Only a page that moved arms the lock: scrolling into either end of the page must not
    // swallow the reversal that follows (the trap on the last screen).
    let lockUntil = 0;
    let lockDir = 0;
    let insideUntil = 0; // the gesture scrolled a panel: its rest never pages
    let lastAbs = 0;
    let rises = 0; // events in a row with a growing |deltaY|: momentum only decays, a new swipe ramps up
    let lastT = 0;
    let riseAt = -1; // when the current ramp began, if it began from rest (a gap or a near-zero delta): a new touch
    let armedAt = 0; // when the lock or the panel guard was last armed
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.defaultPrevented) return;
      const t = e.target instanceof Element ? e.target : null;
      if (t?.closest('dialog')) return;
      const now = e.timeStamp; // when the input happened, so main-thread jank never reads as a pause
      // Chrome lets a page cancel a wheel gesture only from its first event: one left alone makes the rest of the
      // gesture uncancelable, and the browser then scrolls it natively alongside pageBy (mid-way landings, skips).
      // So a gesture's start that is not clearly sideways (no delta, a finger's diagonal jitter) is claimed too,
      // as is anything sideways mid-gesture; a clear sideways swipe stays the browser's (back/forward, a wide table).
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) {
        if (Math.abs(e.deltaX) < 3 || now < lockUntil) e.preventDefault();
        return;
      }
      const dir = e.deltaY > 0 ? 1 : -1;
      // A reversal pages only when it is deliberate: one small opposite event in a noisy
      // momentum tail just extends the lock. The lock comes before the panel check: the tail of a
      // flick that paged onto a card must not scroll that card's panel, then page again at its end.
      const abs = Math.abs(e.deltaY);
      if (abs > lastAbs) {
        // From rest: after a real pause, or from a near-zero delta. 120 ms, not less: when the main thread is busy
        // Chrome coalesces a steady swipe's events, so gaps of 30-60 ms with growing deltas arrive mid-gesture,
        // which read as a new touch and paged a second screen in one gesture.
        if (!rises) riseAt = now - lastT > 120 || lastAbs <= 2 ? now : -1;
        rises++;
      } else rises = 0;
      lastAbs = abs;
      lastT = now;
      const fresh = rises >= 3 && abs >= 8 && riseAt > armedAt; // fingers down again after this gesture was handled (3 rises: a coalescing spike in a momentum tail gives 2)
      if (now < lockUntil && !fresh && (dir === lockDir || abs < 10)) {
        e.preventDefault();
        lockUntil = Math.max(lockUntil, now + 200);
        return;
      }
      // A gesture that scrolls a panel stops at the panel's end; only a new one pages on.
      if (scrollsInside(t, dir)) {
        if (now >= insideUntil) armedAt = now;
        insideUntil = now + 200;
        return;
      }
      // A screen taller than the window (high browser zoom, a short window) scrolls freely, like a panel, to its edge:
      // the wheel moves it as the browser would, stopped at the edge; the next gesture pages on, one screen.
      // Moved here, event by event (the browser's own animated wheel scroll ran past the edge, where mandatory snapping
      // pulled it back). A snap point inside the screen coming into the window (a phone's Profits & Losses) is where a
      // new gesture down goes, as a page.
      const { room, ahead } = roomInside(dir);
      if (room > 1) {
        if (now >= insideUntil) armedAt = now;
        insideUntil = now + 200;
        e.preventDefault();
        const px = Math.abs(e.deltaY) * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? window.innerHeight : 1);
        window.scrollBy({ top: dir * Math.min(px, room), behavior: 'instant' });
        return;
      }
      if (ahead !== null && (now >= insideUntil || fresh) && Math.abs(e.deltaY) >= 4) {
        e.preventDefault();
        window.scrollBy({ top: ahead }); // smooth via scroll-behavior in globals.css
        lockUntil = now + 700;
        armedAt = now;
        lockDir = dir;
        return;
      }
      e.preventDefault();
      if (now < insideUntil && !fresh) {
        insideUntil = now + 200;
        return;
      }
      if (Math.abs(e.deltaY) < 4) return;
      lockUntil = pageBy(dir) ? now + 700 : 0;
      armedAt = now;
      lockDir = dir;
    };
    // Keyboard focus scrolls the focused element into view, which can stop between screens;
    // focus inside the stats stage lands on the overview at least. A resize moves every screen
    // edge; phones skip this (their URL bar resizes constantly, and mandatory snap re-snaps).
    const onFocus = (e: FocusEvent) => {
      const t = e.target instanceof Element ? e.target : null;
      if (!t?.matches(':focus-visible') || t.closest('dialog')) return;
      const stats = document.getElementById('stats');
      const min = stats && t.closest('[data-stage]') ? stats.getBoundingClientRect().top + window.scrollY : 0;
      requestAnimationFrame(() => !isPaging() && resnap(min)); // a click-to-jump focuses its destination as it pages
    };
    const onResize = () => !isPhone() && resnap();
    // A scrollbar drag, Home/End or autoscroll can stop between screens; put the page back on one
    // (desktop only, like onResize). A paged scroll ends on an edge by itself.
    const onScrollEnd = () => !isPhone() && !isPaging() && resnap();
    window.addEventListener('keydown', onKey);
    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('focusin', onFocus);
    window.addEventListener('resize', onResize);
    window.addEventListener('scrollend', onScrollEnd);
    return () => {
      window.removeEventListener('scrollend', onScrollEnd);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('focusin', onFocus);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  // Next hand countdown: the server deals the next hand and tells us how long is left (nextHandInMs, from when it sent
  // it). Counted from the deal's time (dealAt: that message's arrival plus nextHandInMs), so a message that waited for
  // hydration never shows more seconds than the engine has left. This only says whether it shows (once, before paint,
  // and once at dealAt); TableFelt draws its seconds (useSecondsDraw), so no render of the page each second.
  useLayoutEffect(() => {
    const left = isHandComplete && dealAt ? dealAt - Date.now() : 0;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCounting(left > 0);
    if (left <= 0) return;
    let live = true;
    const t = setTimeout(() => { if (live) setCounting(false); }, left + 1);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [isHandComplete, dealAt]);

  // Calculate winners by player index for display on player cards
  const winnersByIdx = isHandComplete && winners.length > 0
    ? winners.reduce((acc, w) => {
        if (!acc[w.playerIdx]) {
          acc[w.playerIdx] = { amount: 0, handDesc: w.handDesc || w.handType };
        }
        acc[w.playerIdx].amount += w.amount;
        return acc;
      }, {} as Record<number, { amount: number; handDesc: string }>)
    : {};

  const tab: Tab = tableInView ? 'table' : screen === 'about' ? 'about' : 'stats';
  const onTab = (t: Tab) => {
    // A Stats or About scroll still underway must not land the page back on its screen (its scrollend resnaps there).
    // A phone's tab bar jumps (as a native tab bar): a smooth scroll from the table to About flashed every window between.
    if (t === 'table') { stopPaging(); window.scrollTo(isPhone() ? { top: 0, behavior: 'instant' } : { top: 0 }); }
    else if (t === 'about') pageTo('about', isPhone());
    else if (!isPhone() && (screen === 'race' || screen === 'stats-table' || screen === 'pairwise')) backToOverview();
    // Phones: on a Stats window already (Profits & Losses, Trends, Profiles, Matchups) the Stats tab does nothing, so a
    // tap just above the bar that touch adjustment hands to it never throws the viewer back to Profits & Losses. Draft A's
    // goes back from a part to the overview, as a native tab bar's tab tapped again goes back to its first screen.
    else if (isPhone() && tab === 'stats') { if (draftA) backToOverview(); }
    else if (draftA) pageToStats(true); // draft A: the stats window as it was left (the overview, or the part open)
    else pageTo('phone-stats', true);
  };

  return (
    <MotionConfig reducedMotion="user">
    {/* --bar-h: room the connection bar (and a phone's tab bar, --tab-h in globals.css) takes at the bottom, so it never
        covers a screen's edge. data-page: the page's one background (globals.css) behind every screen. */}
    <div data-page className="px-3 lg:px-4" style={{ ['--bar-h' as string]: bar ? 'calc(40px + var(--tab-h))' : 'var(--tab-h)' }}>
      {/* The stream opens as this is parsed (lib/api's EARLY_STREAM), not once the page has hydrated. */}
      <script dangerouslySetInnerHTML={{ __html: EARLY_STREAM }} />
      <main className="flex flex-col items-center-safe">
      {/* Phones: the page's top heading (the desktop one sits in the header phones hide; the phone bar shows the name). */}
      <h1 className="sr-only md:hidden">No-LLMit</h1>
      {/* Screen 1: the live table and nothing else. Each screen is a scroll-snap point (globals.css). */}
      {/* Phones: under the slim bar (PhoneBar) only the table and its caption fill the first screen (the header's rows are
          the bar's), Profits & Losses under them starts the stats (the tab bar's Stats): their own snap point,
          which stops a swipe (the screen's own stop would hold a scroll at its end, short of them), so the screen is no
          scroll container there (clip, not auto: a snap point counts only in its nearest one). */}
      <section data-screen aria-label="Live table" className="relative w-full min-h-svh snap-start snap-always max-md:snap-normal overflow-x-auto max-md:overflow-x-clip flex flex-col items-center-safe justify-center-safe max-md:justify-start pt-3 max-md:pt-[calc(48px+env(safe-area-inset-top))] pb-[calc(1rem+var(--bar-h))] lg:pt-4">
      {/* Header - Title centered */}
        {desk && <><div className="mb-1 text-center max-md:hidden">
          <h1 className="text-[28px] font-bold text-balance" style={{ color: 'rgb(55, 53, 47)', lineHeight: 1.1 }}>No-LLMit</h1>
          <p className="text-[14px]" style={{ color: MUTED }}>
            Spectate (or play against) SOTA LLMs in a No Limit Texas Hold&apos;em cash game.{' '}
            {/* The home page's last screen; /about stays its own page (a new tab, a shared link). */}
            <Link
              href="/about"
              onClick={e => { if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) { e.preventDefault(); pageTo('about'); } }}
              className="underline underline-offset-2 decoration-1 decoration-[rgba(31,111,196,0.4)]"
              style={{ color: BLUE }}
            >
              ⓘ About
            </Link>
          </p>
        </div>

        {/* Action buttons row */}
        <div className="mb-1.5 flex items-center justify-center gap-3 max-md:hidden">
          <PlaySoonButton />
        </div>

        {/* Status row - live indicator, hand counter, blinds, timer: its own component, so its remembered boxes mount with
            it when a window crosses into the desktop layout. */}
        <StatusRow statusKnown={statusKnown} handKnown={handKnown} isLive={isLive} label={connection === 'down' ? 'Offline' : tableNotice ? (tableNotice.kind === 'closed' ? 'Closed' : 'Paused') : 'Live'}
          watching={watching} handNumber={handNumber} stakes={stakes} elapsedTime={elapsedTime} />

        <div className="max-md:hidden"><SessionProgress table={usageError ? undefined : usage?.table} /></div></>}

        {/* Main content: a fixed gap under the header, not pushed to the middle of the screen */}
        <div className="mt-6 max-md:mt-0 flex items-center-safe justify-center-safe w-full md:w-auto">
          {/* suppressHydrationWarning: BEFORE_PAINT fits it before React hydrates. */}
          <div ref={stageRef} className="stage-zoom flex flex-col w-full md:w-auto" suppressHydrationWarning>
            {/* Row 1: Table + Winnings. On phones the row dissolves (contents) so the reasoning bar comes right under the
                table and the sidebar after it (order). */}
            <div id="table" ref={tableRef} className="flex flex-col md:flex-row gap-4 md:gap-6 items-stretch relative max-md:contents">
              {/* Main game grid */}
              <PokerTable
                players={players}
                currentPlayerIdx={currentPlayerIdx}
                communityCards={communityCards}
                pot={pot}
                winnersByIdx={winnersByIdx}
                nextDealAt={counting ? dealAt : null}
                thinkingPlayerIdx={(displayState?.phase === 'thinking' || displayState?.phase === 'reasoning') ? displayState.playerIdx : undefined}
                buttonDetermination={buttonDetermination}
                notice={tableNotice}
                street={street}
                handNumber={handNumber}
                stats={seatStats}
                display={displayState}
                clock={displayState?.phase === 'thinking' || displayState?.phase === 'reasoning' ? clock : null}
              />

              {/* Right sidebar column - leaderboard, then API usage. Phones: the top of the stats (the tab bar's Stats lands
                  here, its top under the bar), Profits & Losses only (owner, 2026-11-15: no API usage on a phone). */}
              <div id="phone-stats" className="flex flex-col w-full md:w-[240px] shrink-0 max-md:order-1 max-md:snap-start max-md:snap-always max-md:pt-[calc(var(--top-h)+12px)]">
                <div className="flex-1 flex flex-col min-h-0">
                  <WinningsPanel players={players} />
                </div>
                {desk && <div className="mt-4 max-md:hidden">
                  <UsageIndicator usage={usage} error={usageError} />
                </div>}
              </div>
            </div>

            {/* Reasoning Panel - LLM thinking + reasoning; phones: the caption under the table (its shot clock is the ring
                round the seat), the first screen's slack split above the table and under the caption. */}
            {desk && <div data-reasoning className="mt-4 w-full max-md:hidden">
              <ReasoningPanel
                displayState={displayState}
                clock={clock}
                blank={players.length === 0}
                street={players.length ? street : undefined}
                turnKey={turnKey}
              />
            </div>}
            {phone && <div className={`md:hidden ${draftA ? 'mt-2' : 'mt-1.5'} w-full`} style={{ marginBottom: 'calc(var(--phone-slack, 0px) / 2 + 8px)' }}>
              <Caption displayState={displayState} blank={players.length === 0} turnKey={turnKey} />
            </div>}
            {phone && draftA && <LandingFill stats={stats} players={players} />}
          </div>
        </div>

        {desk && <button onClick={() => pageBy(1)} className={`mt-6 max-md:hidden ${NEXT_BUTTON}`} style={NEXT_STYLE}>
          Stats <ArrowDown size={16} weight="bold" aria-hidden />
        </button>}
      </section>
      <script dangerouslySetInnerHTML={{ __html: BEFORE_PAINT }} />

      {/* Screens 2-5: the overview, then race, stats and pairwise one at a time. */}
      <StatsSections stats={stats} error={statsError} />
      <script dangerouslySetInnerHTML={{ __html: BEFORE_PAINT }} />
      </main>

      {/* The status bars in a landmark of their own (their boxes are fixed: the header adds no box). */}
      <header aria-label="Table status">
        {desk && <StickyBar show={!tableInView} slide={scrolled} blank={players.length === 0} pot={pot} handNumber={handNumber} display={displayState} />}
        {phone && <PhoneBar blank={players.length === 0} live={isLive} watching={watching} handNumber={handNumber} pot={pot} bigBlind={stakes.bigBlind} />}
      </header>
      {phone && <TabBar tab={tab} onTab={onTab} />}
      {/* No floating back-to-top button on phones: it covered text, logos and chart marks. The tab bar's Table tab is the way
          back to the table's top, as a native tab bar's. */}
      {drawerEver && ModelDrawer && <ModelDrawer models={stats?.models ?? []} error={statsError} slug={drawerSlug} onClose={closeModel} />}
      {drawerFailed && !drawerEver && (
        <p role="status" className="fixed left-1/2 -translate-x-1/2 z-50 rounded bg-white px-3 py-1.5 text-[13px] leading-5 whitespace-nowrap" style={{ top: 'calc(var(--top-h, 0px) + 8px)', color: 'rgb(55, 53, 47)', boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.1) 0px 2px 4px' }}>
          Model page did not load. Reload the page.
        </p>
      )}

      {/* Fixed notification bar for connection status */}
      {bar && (
        <div role="status" className="fixed bottom-0 left-0 right-0 px-4 py-2 flex items-center justify-center gap-4 z-50" style={{ bottom: 'var(--tab-h)', background: 'rgb(203, 145, 47)', color: 'rgb(30, 28, 24)' }}>
          <div className="flex items-center gap-2">
            {gaveUp ? (
              <span className="text-sm font-medium">Can&apos;t reach the game server.</span>
            ) : (
              <>
                <CircleNotch size={14} className="animate-spin" aria-hidden />
                <span className="text-sm font-medium">Connecting to the game server…</span>
              </>
            )}
          </div>
          {gaveUp && (
            <button
              onClick={retry}
              className="text-xs bg-white/40 hover:bg-white/60 px-3 py-1 max-md:min-h-11 max-md:min-w-11 rounded font-bold"
            >
              Retry
            </button>
          )}
        </div>
      )}
      <DevPace />
    </div>
    </MotionConfig>
  );
}

// The desktop status row. Its hooks live here, not in Table, so they run when the row mounts: a window that loads in
// the phone layout and widens past the switch still remembers the label and hand number boxes.
function StatusRow({ statusKnown, handKnown, isLive, label, watching, handNumber, stakes, elapsedTime }: {
  statusKnown: boolean; handKnown: boolean; isLive: boolean; label: string; watching: number | undefined;
  handNumber: number; stakes: { smallBlind: number; bigBlind: number }; elapsedTime: string;
}) {
  const labelRef = useRef<HTMLDivElement>(null), handRef = useRef<HTMLDivElement>(null);
  useFillIn(labelRef, statusKnown);
  useFillIn(handRef, handKnown);
  const [labelBox, labelSize, labelAttrs] = useRememberedBox<HTMLSpanElement>('status-label', statusKnown, 'wh');
  const [handBox, handSize, handAttrs] = useRememberedBox<HTMLSpanElement>('hand-no', handKnown, 'wh');
  return (
    <div className="mb-1 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 max-md:hidden">
      {/* Live indicator */}
      <div ref={labelRef} className={`flex items-center gap-2 ${statusKnown ? '' : '[&>*]:invisible'}`}>
        <span
          aria-hidden
          className="inline-block w-2.5 h-2.5 rounded-full"
          style={{ background: isLive ? 'rgb(220, 38, 38)' : MUTED }}
        />
        <span ref={labelBox} {...labelAttrs} className="text-[14px] font-medium tabular-nums" style={{ color: 'rgb(55, 53, 47)', ...labelSize }}>
          {label}
          {statusKnown && watching !== undefined && ` · ${watching.toLocaleString('en-US')} watching`}
        </span>
      </div>

      {/* Hand counter, blinds, timer. Held blank until the first state, so the row keeps its width (a phone wraps it
          to the same lines) and nothing under it moves when they fill in. */}
      <div ref={handRef} className={`contents ${handKnown ? '' : '[&>*]:invisible'}`}>
        <div className="h-4 w-px" style={{ background: 'rgba(55, 53, 47, 0.09)' }} />
        <span ref={handBox} {...handAttrs} className="text-[14px] tabular-nums" style={{ color: MUTED, ...handSize }}>Hand #{handNumber || '00'}</span>
        <div className="h-4 w-px" style={{ background: 'rgba(55, 53, 47, 0.09)' }} />
        <span className="text-[14px]" style={{ color: MUTED }}>{stakes.smallBlind}/{stakes.bigBlind}</span>
        <div className="h-4 w-px" style={{ background: 'rgba(55, 53, 47, 0.09)' }} />
        <span className="text-[14px] tabular-nums" style={{ color: MUTED }}>{elapsedTime}</span>
      </div>
      <div className="h-4 w-px" style={{ background: 'rgba(55, 53, 47, 0.09)' }} />
      <UnitToggle bigBlind={stakes.bigBlind} />
      <div className="h-4 w-px" style={{ background: 'rgba(55, 53, 47, 0.09)' }} />
      <SoundToggle />
    </div>
  );
}
