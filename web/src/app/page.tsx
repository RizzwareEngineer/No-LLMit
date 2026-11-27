"use client";

import { useMemo, useState, useEffect, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import type { CSSProperties } from "react";
import { flushSync } from "react-dom";
import Link from "next/link";
import { MotionConfig } from "motion/react";
import { ArrowDown, ArrowLeft, CircleNotch, Info } from "@phosphor-icons/react";
import PokerTable from "@/components/PokerTable";
import WinningsPanel from "@/components/WinningsPanel";
import LandingFill, { useFill } from "@/components/LandingFill";
import Fit from "@/components/Fit";
// The table's width at 1440x790 (a 13-inch Mac): 1000px at the stage's zoom, 0.819. Phone draft A's header is laid out
// this wide, so beside the table (drawn from 1000px) it keeps the Mac's size and distance.
const MAC_TABLE_W = 819;
// Its switches (Chips/BB, Sound) drawn at under half size: each hit area reaches 24 layout px above and below (about 11px
// on a phone each way), within the gaps around the status row, as the top bar's TAP does for its own (StickyBar).
const PICTURED_TAP = "[&_button]:relative [&_button]:after:absolute [&_button]:after:-inset-x-1 [&_button]:after:-inset-y-[24px] [&_button]:after:content-['']";
const noSub = () => () => {};
import ReasoningPanel, { Caption } from "@/components/ReasoningPanel";
import SoundToggle, { UnitToggle } from "@/components/SoundToggle";
import UsageIndicator, { useUsage } from "@/components/UsageIndicator";
import StatsSections from "@/components/StatsScreens";
import PlaySoonButton from "@/components/PlaySoonButton";
// The model drawer (lib/drawer) is loaded on the first pointer near a model link, the first model opened, or with the
// stats, and mounted only once loaded (StatsScreens says why: a lazy would finish on a retry lane that a typing reason
// restarts). A failed load never reaches React: the drawer stays closed, one line says it did not load (a chunk a deploy
// replaced does not come back: reload), and the next open tries again. The line goes after a few seconds, on the next
// tap or key, or once the drawer's code does load: it sits over the top seat on a phone.
import { ModelDrawer, loadDrawer, onDrawerLoaded } from "@/lib/drawer";
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
import { CardLookContext, setPageCardLook, useCardLookParam, OVERVIEW_FIRST, backToTables as toAllTables, clearFocus, pushFocus, useEdges, useFocusParam, useLayout, usePnlRow, useTablesOverview, useTallTable } from "@/lib/tableSwitches";
import { type Anim, nextAnim, stageKeyOf, targetOf } from "@/lib/overviewMachine";
import TablesOverview, { EASE, Edge, ZOOM_MS, gridFor, tableLabel, type EdgeRoom } from "@/components/TablesOverview";
import { NavPill, pillWidth, useFadeIn } from "@/components/TableNav";

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
  history.replaceState(history.state, "", window.location.pathname + window.location.search);
  window.dispatchEvent(new HashChangeEvent("hashchange")); // replaceState does not fire it
};

// The site's title: No-LLMit and what it is, with About's link (the desktop's header, and phone draft A's: page's head).
// `as`: a phone's page has its own (screen-reader) h1, so its pictured title is not a second one.
// `about`: the link at the subtitle's end; off where About is the page's top-right pill (AboutPill, with ?tables=1).
function TitleBlock({ as: H = 'h1', className, about = true }: { as?: 'h1' | 'p'; className: string; about?: boolean }) {
  return (
    <div className={className}>
      <H className="text-[28px] font-bold text-balance" style={{ color: 'rgb(55, 53, 47)', lineHeight: 1.1 }}>No-LLMit</H>
      <p className="text-[14px]" style={{ color: MUTED }}>
        Spectate (or play against) SOTA LLMs in a No Limit Texas Hold&apos;em cash game.{about && ' '}
        {/* The home page's last screen; /about stays its own page (a new tab, a shared link). */}
        {about && <Link
          href="/about"
          onClick={e => { if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) { e.preventDefault(); pageTo('about', isPhone()); } }}
          className="underline underline-offset-2 decoration-1 decoration-[rgba(31,111,196,0.4)]"
          style={{ color: BLUE }}
        >
          ⓘ About
        </Link>}
      </p>
    </div>
  );
}

// Fit-to-screen: the stage (table, sidebar, reasoning) takes one uniform zoom so the whole
// table screen fits the window, up to 125% and down to 75%; below
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

// `v`, else the last value it had that was not null.
function useHeld(v: string | null) {
  const [held, setHeld] = useState(v);
  if (v && v !== held) setHeld(v);
  return v ?? held;
}

type Dir = 'left' | 'right' | 'up' | 'down';
const STEP: Record<Dir, [number, number]> = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] };
const ARROWS: Record<string, Dir> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
type Box = { left: number; top: number; width: number; height: number };
// The stage's moving parts for the zoom and the slide: its table, and the panels that slide in once it lands.
const stageParts = (stage: HTMLElement) => ({
  table: stage.querySelector<HTMLElement>('[data-desk-table]')!,
  panels: [stage.querySelector<HTMLElement>('#phone-stats'), stage.querySelector<HTMLElement>('[data-reasoning]')].filter(e => !!e),
});
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
// Panels in: the sidebar from the right, the reasoning from below, after `delay`; out: faded, held until cancelled.
const panelsIn = (panels: HTMLElement[], delay: number) => panels.forEach((p, i) => p.animate(
  [{ opacity: 0, transform: i ? 'translateY(16px)' : 'translateX(24px)' }, { opacity: 1, transform: 'none' }],
  { duration: reduced() ? 0 : 220, delay: reduced() ? 0 : delay, easing: EASE, fill: 'backwards' }));
const panelsOut = (panels: HTMLElement[]) => panels.map(p => p.animate([{ opacity: 1 }, { opacity: 0 }], { duration: reduced() ? 0 : 140, easing: 'ease-out', fill: 'forwards' }));
const stop = (...els: (HTMLElement | null | undefined)[]) => els.forEach(e => e?.getAnimations().forEach(a => a.cancel()));
// The way round a table (its arrow buttons or edges, and "All tables"): faded out before a zoom out or a slide.
const navParts = () => [...document.querySelectorAll<HTMLElement>('[data-table-nav], [data-edge], [data-all-tables-button]')];

// Where the arrow buttons go, in the screen's px (measured in page.tsx's room): a compass round the table, each one
// GAP off the edge it leads past. Left and right: centred on the table's height, outside the table (left) and the
// sidebar (right); laid on their side (the pill's height across) where the window's margin is narrower than the pill.
// Up and down: on the table's left edge, above the table and under the reasoning panel (the stage's foot), so the
// table below is never beside the page's own Stats ↓, which stays centred at the page's foot.
type NavRoom = { table: Box; stageBottom: number; sideRight: number; leftRoom: number; rightRoom: number; h: number; font: string };
const NAV_GAP = 8, NAV_MARGIN = 8;
function navAt(d: Dir, label: string, r: NavRoom) {
  const w = pillWidth(label, r.font), { table: t, h } = r, cy = t.top + t.height / 2;
  if (d === 'up') return { at: { left: t.left, top: t.top - NAV_GAP - h }, vertical: false };
  if (d === 'down') return { at: { left: t.left, top: r.stageBottom + NAV_GAP }, vertical: false };
  const room = d === 'left' ? r.leftRoom : r.rightRoom, vertical = room < w + NAV_GAP + NAV_MARGIN, across = vertical ? h : w;
  return { at: { left: d === 'left' ? t.left - NAV_GAP - across : r.sideRight + NAV_GAP, top: cy - (vertical ? w : h) / 2 }, vertical };
}

// About, with ?tables=1: the Stats button's pill at the page's top-right corner, across from "All tables" (the
// subtitle's link was a 14px line in a sentence; a pill of the family's height there would make the header taller).
function AboutPill({ top }: { top: number }) {
  return (
    <Link href="/about" data-about-pill
      onClick={e => { if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) { e.preventDefault(); pageTo('about', false); } }}
      className={`absolute z-20 right-0 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgb(31,111,196)] ${NEXT_BUTTON}`}
      style={{ ...NEXT_STYLE, top }}>
      <Info size={16} weight="bold" aria-hidden style={{ color: BLUE }} /> About
    </Link>
  );
}

// "All tables": the way back to the overview, the Stats button's pill at the page's top-left corner.
function AllTables({ ref, at, still, onClick }: { ref: React.RefObject<HTMLButtonElement | null>; at: { left: number; top: number }; still: boolean; onClick: () => void }) {
  useFadeIn(ref);
  return (
    <button ref={ref} type="button" data-all-tables-button onClick={onClick}
      className={`absolute z-20 outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgb(31,111,196)] ${NEXT_BUTTON}`}
      style={{ ...NEXT_STYLE, ...at, pointerEvents: still ? 'none' : undefined }}>
      <ArrowLeft size={16} weight="bold" aria-hidden style={{ color: 'rgba(55, 53, 47, 0.6)' }} /> All tables
    </button>
  );
}

export default function Home() {
  // The tables overview's machine (lib/overviewMachine; below): what the stage shows at rest (undefined: not started)
  // and the animation running. Without the overview the URL's table is the stage's.
  const mounted = useLayout(), desk = mounted !== 'phone', phone = mounted !== 'desk';
  const focusParam = useFocusParam();
  const overviewOn = useTablesOverview() && mounted === 'desk';
  const [shown, setShown] = useState<string | null | undefined>(undefined);
  const [anim, setAnim] = useState<Anim | null>(null);
  const stageKey = useHeld(overviewOn ? stageKeyOf(shown, anim) : focusParam);
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
    tables,
    retry,
  } = useGameState(stageKey);
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
  const fill = useFill();
  const tall = useTallTable(); // draft A's tall table (?table=tall): the first screen is the table and its caption, no fill or header
  // The URL names no stats screen: an old #stats, #race or #pairwise link opens the page at its top.
  useEffect(() => {
    if (!window.location.hash || isModelHash(window.location.hash)) return;
    history.replaceState(history.state, "", window.location.pathname + window.location.search);
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
  useEffect(() => onDrawerLoaded(() => setDrawerFailed(false)), []);
  useEffect(() => {
    if (!drawerFailed) return;
    const clear = () => setDrawerFailed(false);
    const t = setTimeout(clear, 6000);
    addEventListener('pointerdown', clear, { capture: true, passive: true });
    addEventListener('keydown', clear, { capture: true, passive: true });
    return () => { clearTimeout(t); removeEventListener('pointerdown', clear, { capture: true }); removeEventListener('keydown', clear, { capture: true }); };
  }, [drawerFailed]);
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
  // The layout shown (lib/layout, `mounted` above): only its own parts are mounted once hydrated (null until then: both,
  // CSS shows one).

  // The tables overview (lib/tableSwitches' ?tables=1), desktop only: the landing, a click zooms a table into the stage,
  // and Back, Esc or "All tables" zooms it back into its cell. The stage stays laid out under the overview (hidden), so the
  // table lands exactly where it always is. The URL decides where the page goes (lib/overviewMachine): an input changes it
  // (a click or an edge pushes ?t, Esc and "All tables" go back), and the machine animates toward it one step at a time.
  const edges = useEdges(), pnl = usePnlRow() ? 'row' as const : 'panel' as const;
  // ?cards=bold|a|b|c (a draft): the bolder cards on this page's own table (not the overview's small ones).
  const cardLook = useCardLookParam();
  useEffect(() => setPageCardLook(cardLook), [cardLook]);
  const keys = useMemo(() => tables.map(t => t.key), [tables]);
  const target = targetOf(focusParam, keys);
  const atRest = !anim, hidden = overviewOn && shown === null && atRest; // the stage under the overview
  const showOverview = overviewOn && (shown === null || anim?.kind === 'in' || anim?.kind === 'out');
  const chrome = overviewOn && !!shown && atRest; // the way back and the neighbours, at rest on a table
  // Drawn from the landing until they have faded out before a zoom out or a slide (the anim effect fades them).
  const navShown = overviewOn && !!shown && (atRest || anim?.kind === 'out' || anim?.kind === 'slideOut');
  const mainRef = useRef<HTMLDivElement>(null), statsButton = useRef<HTMLButtonElement>(null), overlay = useRef<HTMLDivElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  const animId = useRef(0); // the running animation's id: an end of any other is stale and ignored
  // Where the overview, the edges and the way back go, in the screen's px (measured below).
  const [room, setRoom] = useState<{ overview: Box; edges: Partial<Record<Dir, EdgeRoom>>; back: { left: number; top: number }; w: number; nav: NavRoom } | null>(null);
  const grid = room ? gridFor(tables.length, room.overview.width, room.overview.height, pnl) : null, cols = grid?.cols ?? 1;
  // The header's per-table items (hand, stakes, clock) open as a table zooms in and fold away as it zooms out (StatusRow).
  const perTable = !overviewOn || !(anim ? anim.kind === 'out' : (shown === undefined ? target === null : shown === null));
  // In the zoom the stage's table is the overview's small one growing: it starts seen from far away, as the cell drew it,
  // and its detail fades in over the zoom's last third (PokerTable's lod, the --lod-t animation below); zooming out, back.
  const zoomLod = overviewOn && grid?.tw && (anim?.kind === 'in' || anim?.kind === 'out') ? { k: 1000 / grid.tw, morph: true } : null;
  // A ?t no table has (a stale link, or a table gone from the stream) is dropped, so the page is on the overview.
  useEffect(() => { if (overviewOn && focusParam && keys.length && !keys.includes(focusParam)) clearFocus(); }, [overviewOn, focusParam, keys]);
  // Off (a resize to a phone): forget the machine, and any animation still running ends unheard.
  useEffect(() => {
    if (overviewOn) return;
    animId.current++;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShown(undefined); setAnim(null);
  }, [overviewOn]);
  // At rest and not where the URL says: start the next step. Before the paint, so no frame shows the stage between.
  useLayoutEffect(() => {
    if (!overviewOn) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (shown === undefined) { setShown(target); return; }
    document.documentElement.removeAttribute('data-overview'); // OVERVIEW_FIRST's part is done
    if (anim) return; // its end plans the next step
    const next = nextAnim(++animId.current, shown, target, keys, cols);
    if (next) setAnim(next);
  }, [overviewOn, shown, anim, target, keys, cols]);
  // Each animation, run once (a new object each step); its end sets the next state only if it is still the running one.
  useLayoutEffect(() => {
    const stage = stageRef.current;
    if (!anim || !stage) return;
    const { id, kind, from, to, v: [dx, dy] } = anim, { table, panels } = stageParts(stage);
    const mine = () => animId.current === id;
    const cellOf = (key: string | null) => document.querySelector(`[data-overview-cell="${key}"] [data-small-table]`)?.getBoundingClientRect();
    const z = () => table.getBoundingClientRect().width / table.offsetWidth;
    const rest = () => { table.style.zIndex = table.style.transformOrigin = ''; };
    const landed = () => { if (!mine()) return; rest(); setShown(to); setAnim(null); };
    if (kind === 'in') {
      const cell = cellOf(to);
      if (!cell || reduced()) { stop(table, ...panels, overlay.current); landed(); return; }
      const b = table.getBoundingClientRect();
      table.style.zIndex = '30';
      table.style.transformOrigin = '0 0';
      const grow = table.animate([{ transform: `translate(${(cell.left - b.left) / z()}px, ${(cell.top - b.top) / z()}px) scale(${cell.width / b.width})` }, { transform: 'none' }],
        { duration: ZOOM_MS, easing: EASE });
      // The detail the overview drops fades in over the last third; the far layer fades out (globals.css, --lod-t).
      table.animate([{ '--lod-t': 0 }, { '--lod-t': 0, offset: 2 / 3 }, { '--lod-t': 1 }], { duration: ZOOM_MS, easing: 'linear', fill: 'both' });
      panelsIn(panels, ZOOM_MS);
      overlay.current?.animate([{ opacity: 1 }, { opacity: 0 }], { duration: ZOOM_MS, easing: EASE, fill: 'forwards' });
      grow.finished.then(landed, () => {});
    } else if (kind === 'out') {
      // The panels fade, then the table shrinks into its cell as the overview fades back over it.
      const cell = cellOf(from);
      // The shrink's fill dropped and the stage hidden in one task, so no frame shows the table back at its own size;
      // dropped first, as the commit may already start the next step's animation.
      const done = () => { if (!mine()) return; stop(table, ...panels, overlay.current); rest(); flushSync(() => { setShown(null); setAnim(null); }); };
      stop(overlay.current);
      if (!cell || reduced()) { done(); return; }
      panelsOut([...panels, ...navParts()]);
      const b = table.getBoundingClientRect();
      table.style.zIndex = '30';
      table.style.transformOrigin = '0 0';
      const shrink = table.animate([{ transform: 'none' }, { transform: `translate(${(cell.left - b.left) / z()}px, ${(cell.top - b.top) / z()}px) scale(${cell.width / b.width})` }],
        { duration: ZOOM_MS, delay: 140, easing: EASE, fill: 'forwards' });
      // The reverse: the detail fades out over the first third, so the table that lands is the overview's far one.
      table.animate([{ '--lod-t': 1 }, { '--lod-t': 0, offset: 1 / 3 }, { '--lod-t': 0 }], { duration: ZOOM_MS, delay: 140, easing: 'linear', fill: 'both' });
      overlay.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ZOOM_MS, delay: 140, easing: EASE, fill: 'backwards' });
      shrink.finished.then(done, () => {});
    } else if (kind === 'slideOut') {
      // The table leaves the way the new one lies, the panels and the way round fade; then the new one arrives from the other side.
      panelsOut([...panels, ...navParts()]);
      const out = table.animate([{ transform: 'none', opacity: 1 }, { transform: `translate(${-dx * innerWidth * 0.5 / z()}px, ${-dy * innerHeight * 0.5 / z()}px)`, opacity: 0 }],
        { duration: reduced() ? 0 : 200, easing: 'ease-in', fill: 'forwards' });
      out.finished.then(() => { if (mine()) setAnim({ ...anim, kind: 'slideIn' }); }, () => {});
    } else {
      stop(table, ...panels);
      if (reduced()) { landed(); return; }
      const arrive = table.animate([{ transform: `translate(${dx * innerWidth * 0.5 / z()}px, ${dy * innerHeight * 0.5 / z()}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 300, easing: EASE });
      panelsIn(panels, 300);
      arrive.finished.then(landed, () => {});
    }
  }, [anim]);
  // A click on the table while it shrinks into its cell is a click on that cell (the viewer sees the table they just
  // left and clicks it again): it opens that table again, as a click on the cell would (queued: the zoom out ends, then it
  // zooms back in). Not a click on what the shrinking table holds (a seat's model link).
  useEffect(() => {
    const stage = stageRef.current;
    if (anim?.kind !== 'out' || !anim.from || !stage) return;
    const key = anim.from;
    // Only while it is still shrinking: a zoom out with reduced motion ends in its own commit, before this effect's cleanup.
    const shrinking = () => stageParts(stage).table.getAnimations().some(a => a.playState === 'running');
    const reopen = (e: MouseEvent) => { if (e.button !== 0 || !e.detail || !shrinking()) return; e.preventDefault(); e.stopPropagation(); pushFocus(key); };
    stage.addEventListener('click', reopen, true);
    return () => stage.removeEventListener('click', reopen, true);
  }, [anim]);
  // Keyboard focus follows: after a zoom in to the way back, after a zoom out to the table's cell, when it was on
  // something that has gone (the cell under the stage, the way back) or nowhere.
  const lastShown = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    if (!overviewOn || !atRest || shown === undefined) return;
    const was = lastShown.current;
    lastShown.current = shown;
    if (was === undefined || was === shown) return;
    const a = document.activeElement;
    if (a && a !== document.body && !a.closest('[data-overview]')) return;
    const to = shown ? backButton.current : document.querySelector<HTMLElement>(`[data-overview-cell="${was}"]`);
    to?.focus({ preventScroll: true });
  }, [overviewOn, atRest, shown]);
  const focusIdx = tables.findIndex(t => t.key === shown);
  const neighbour = (d: Dir) => {
    // The overview's columns at this window: its neighbours above and below are the overview's.
    const [dx, dy] = STEP[d], col = focusIdx % cols, i = focusIdx + dx + dy * cols;
    return focusIdx >= 0 && col + dx >= 0 && col + dx < cols && i >= 0 && i < tables.length ? tables[i] : null;
  };
  const openTable = pushFocus;
  const backToTables = () => { if (target !== null) toAllTables(); };
  // To a neighbour: only at rest on a table (an arrow held down steps one table per slide).
  const goTo = (d: Dir) => { const n = neighbour(d); if (n && atRest && shown === target) pushFocus(n.key); };
  // Esc goes back to all tables; an arrow key to the neighbour that way (before the page's own keys, which page
  // screens). While a table is in focus or on its way, never the page's keys.
  useEffect(() => {
    if (!overviewOn || (shown === null && atRest)) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || window.scrollY > 8) return;
      if (e.target instanceof Element && e.target.closest('input, select, textarea, [contenteditable], dialog')) return;
      const d = ARROWS[e.key];
      if (e.key === 'Escape') backToTables();
      else if (d) goTo(d);
      else return;
      e.preventDefault();
    };
    addEventListener('keydown', onKey, true);
    return () => removeEventListener('keydown', onKey, true);
  });
  // Where the overview and the edges go, in the screen's px: the overview under the header down to the Stats button; the
  // edges in the room round the stage (beside the table and the sidebar, between the header and the table, under the
  // reasoning), never over them.
  useLayoutEffect(() => {
    const main = mainRef.current, stage = stageRef.current, screen = stage?.closest('section'), btn = statsButton.current;
    if (!overviewOn || !main || !stage || !screen || !btn) return;
    const measure = () => {
      const s = screen.getBoundingClientRect(), t = stage.querySelector('[data-desk-table]')!.getBoundingClientRect(), st = stage.getBoundingClientRect();
      const side = stage.querySelector('#phone-stats')!.getBoundingClientRect(), head = main.previousElementSibling!.getBoundingClientRect(), b = btn.getBoundingClientRect();
      const x = (r: number) => r - s.left, y = (r: number) => r - s.top;
      // The overview: the first screen under the header, down to the Stats button (the single-table page's, where it always is),
      // 40px in from the window's sides, so it never runs wall to wall.
      const foot = Math.min(s.bottom, innerHeight);
      // Each neighbour's room: the free space beside the table and the sidebar, between the header and the table, under
      // the reasoning panel. Wide or tall enough for its label: the neighbour itself, faded; else a slim tab at that edge
      // (in the gap when there is one, else in the table's own empty corner cell).
      const LABEL = 124, TAB = 20, cx = x(t.left) + t.width / 2, cy = y(t.top) + t.height / 2, corner = (t.width / 5);
      const lw = t.left - s.left - 20, rw = s.right - side.right - 20, ug = t.top - head.bottom, dg = b.top - st.bottom;
      const edges: Partial<Record<Dir, EdgeRoom>> = {
        left: lw >= LABEL ? { box: { left: 4, top: y(t.top), width: lw, height: t.height }, tab: false }
          : { box: { left: lw >= 0 ? x(t.left) - 6 - TAB : x(t.left) + 8, top: lw >= 0 ? cy : y(t.top) + 8, width: TAB, transform: lw >= 0 ? 'translateY(-50%)' : undefined }, tab: true },
        right: rw >= LABEL ? { box: { left: x(side.right + 16), top: y(t.top), width: rw, height: t.height }, tab: false }
          : { box: { left: rw >= 0 ? x(side.right) + 6 : x(t.right) - 8 - TAB, top: rw >= 0 ? cy : y(t.top) + 8, width: TAB, transform: rw >= 0 ? 'translateY(-50%)' : undefined }, tab: true },
        up: ug >= 72 ? { box: { left: x(t.left), top: y(head.bottom) + 6, width: t.width, height: ug - 12 }, tab: false }
          : { box: { left: ug >= TAB + 4 ? cx : x(t.left) + corner / 2, top: ug >= TAB + 4 ? y(head.bottom) + (ug - TAB) / 2 : y(t.top) + 8, height: TAB, transform: 'translateX(-50%)' }, tab: true },
        down: dg >= 72 ? { box: { left: x(t.left), top: y(st.bottom) + 6, width: t.width, height: dg - 12 }, tab: false }
          : { box: { left: dg >= TAB + 4 ? cx : x(t.left) + corner / 2, top: dg >= TAB + 4 ? y(st.bottom) + (dg - TAB) / 2 : y(t.bottom) - 8 - TAB, height: TAB, transform: 'translateX(-50%)' }, tab: true },
      };
      const pad = parseFloat(getComputedStyle(screen).paddingTop);
      const next = {
        overview: { left: x(40), top: y(head.bottom) + 6, width: document.documentElement.clientWidth - 80, height: Math.min(foot, b.top) - head.bottom - 12 },
        edges,
        // "All tables": the page's top-left content corner (the screen's left edge, under its top padding).
        back: { left: 0, top: pad },
        w: t.width,
        nav: {
          table: { left: x(t.left), top: y(t.top), width: t.width, height: t.height }, stageBottom: y(st.bottom), sideRight: x(side.right),
          leftRoom: t.left, rightRoom: document.documentElement.clientWidth - side.right, h: b.height, font: getComputedStyle(btn).font,
        },
      };
      setRoom(r => (JSON.stringify(r) === JSON.stringify(next) ? r : next));
    };
    measure();
    // The header's rows too: a row that settles late (its font, a status) moves the overview's top.
    const ro = new ResizeObserver(measure);
    for (const e of [screen, stage, ...main.parentElement!.children]) if (e !== main) ro.observe(e);
    let live = true;
    document.fonts?.ready.then(() => { if (live) measure(); });
    return () => { live = false; ro.disconnect(); };
  }, [overviewOn, chrome]);

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
  }, [mounted, tall]); // the phone table mounts and unmounts with the layout (and draft A's with ?table=tall)

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

  // The desktop's header: the title, Play (soon), the status row (live, hand, blinds, clock, units, sound) and the session's
  // progress; the desktop's over its stage, and phone draft A's (?fill=none) over its table (Fit).
  // Each part is the screen's own child (fitStage measures the screen from its first child's box; a display: contents
  // wrapper has none, and the desktop table shrank), `hide` its rule under md (the desktop's, for the prerender on a phone).
  const head = (hide: string, phone = false) => (
    <>
      <TitleBlock as={phone ? 'p' : 'h1'} className={`mb-1 text-center ${hide}`} about={phone || !overviewOn} />

      {/* Action buttons row */}
      <div className={`mb-1.5 flex items-center justify-center gap-3 ${hide}`}>
        <PlaySoonButton />
      </div>

      {/* Status row - live indicator, hand counter, blinds, timer: its own component, so its remembered boxes mount with
          it when a window crosses into the desktop layout. */}
      <StatusRow className={hide} statusKnown={statusKnown} handKnown={handKnown} perTable={perTable} fold={overviewOn} outDelay={anim?.kind === 'out' ? 140 : 0} isLive={isLive} label={connection === 'down' ? 'Offline' : tableNotice ? (tableNotice.kind === 'closed' ? 'Closed' : 'Paused') : 'Live'}
        watching={watching} handNumber={handNumber} stakes={stakes} elapsedTime={elapsedTime} />

      <div className={hide}><SessionProgress table={usageError ? undefined : usage?.table} /></div>
    </>
  );
  return (
    <MotionConfig reducedMotion="user">
    {/* --bar-h: room the connection bar (and a phone's tab bar, --tab-h in globals.css) takes at the bottom, so it never
        covers a screen's edge. data-page: the page's one background (globals.css) behind every screen. */}
    <div data-page className="px-3 lg:px-4" style={{ ['--bar-h' as string]: bar ? 'calc(40px + var(--tab-h))' : 'var(--tab-h)' }}>
      {/* The stream opens as this is parsed (lib/api's EARLY_STREAM), not once the page has hydrated. */}
      <script dangerouslySetInnerHTML={{ __html: EARLY_STREAM }} />
      <script dangerouslySetInnerHTML={{ __html: OVERVIEW_FIRST }} />
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
        {desk && head('max-md:hidden')}

        {/* Phone draft A without a landing fill (?fill=none): the desktop's header over the table, as at 1440x790, at the
            desktop's distance from the table: laid out MAC_TABLE_W across, the table's width there, and drawn
            at the phone's width, so it keeps the Mac's size and distance beside the table (its pb-6, the main content's mt-6
            there). The screen is centred (globals.css, html[data-fill=none]). */}
        {phone && draftA && fill === 'none' && !tall && <Fit w={MAC_TABLE_W} data-a-head><div className={`flex flex-col items-center pb-6 ${PICTURED_TAP}`}>{head('', true)}</div></Fit>}

        {/* Main content: a fixed gap under the header, not pushed to the middle of the screen */}
        <div ref={mainRef} className="mt-6 max-md:mt-0 flex items-center-safe justify-center-safe w-full md:w-auto">
          {/* suppressHydrationWarning: BEFORE_PAINT fits it before React hydrates. */}
          <div ref={stageRef} data-stage-key={overviewOn ? stageKey ?? '' : undefined} className="stage-zoom flex flex-col w-full md:w-auto" style={hidden ? { visibility: 'hidden' } : undefined} suppressHydrationWarning>
            {/* Row 1: Table + Winnings. On phones the row dissolves (contents) so the reasoning bar comes right under the
                table and the sidebar after it (order). */}
            <div id="table" ref={tableRef} className="flex flex-col md:flex-row gap-4 md:gap-6 items-stretch relative max-md:contents">
              {/* Main game grid */}
              <CardLookContext.Provider value={cardLook}>
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
                still={hidden}
                lod={zoomLod}
              />
              </CardLookContext.Provider>

              {/* Right sidebar column - leaderboard, then API usage. Phones: the top of the stats (the tab bar's Stats lands
                  here, its top under the bar), Profits & Losses only (no API usage on a phone). */}
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
            {phone && draftA && !tall && <LandingFill stats={stats} players={players} />}
          </div>
        </div>

        {/* The tables overview over the stage (hidden under it), and in the focused view the way back and the neighbours.
            Between the stage and the Stats button: fitStage measures the screen from its first child to its last. */}
        {/* Mounted for as long as the switch is on (hidden while a table is in focus), so zooming out draws no new tables. */}
        {overviewOn && room && <div ref={overlay} className="absolute z-20" style={{ ...room.overview, ...(showOverview ? null : { visibility: 'hidden', pointerEvents: 'none' }) }} aria-hidden={!showOverview || undefined}>
          <TablesOverview tables={tables} w={room.overview.width} h={room.overview.height} pnl={pnl} onOpen={openTable} />
        </div>}
        {overviewOn && room && <AboutPill top={room.back.top} />}
        {navShown && room && <>
          <AllTables ref={backButton} at={room.back} still={!atRest} onClick={backToTables} />
          {(Object.keys(STEP) as Dir[]).map(d => {
            const n = neighbour(d), r = room.edges[d];
            if (!n) return null;
            if (edges === 'buttons') return <NavPill key={d} dir={d} label={tableLabel(n)} still={!atRest} onGo={() => goTo(d)} {...navAt(d, tableLabel(n), room.nav)} />;
            return r && <Edge key={d} t={n} dir={d} variant={edges} room={r} width={room.w * (d === 'left' || d === 'right' ? 0.8 : 0.6)} onGo={() => goTo(d)} />;
          })}
        </>}
        {desk && <button ref={statsButton} onClick={() => pageBy(1)} className={`mt-6 max-md:hidden ${NEXT_BUTTON}`} style={NEXT_STYLE}>
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
        {phone && <PhoneBar show={!(draftA && fill === 'none' && !tall) || !tableInView} blank={players.length === 0} live={isLive} watching={watching} handNumber={handNumber} pot={pot} bigBlind={stakes.bigBlind} />}
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
function StatusRow({ className = '', statusKnown, handKnown, perTable = true, fold = false, outDelay = 0, isLive, label, watching, handNumber, stakes, elapsedTime }: {
  className?: string; statusKnown: boolean; handKnown: boolean; perTable?: boolean; fold?: boolean; outDelay?: number; isLive: boolean; label: string; watching: number | undefined;
  handNumber: number; stakes: { smallBlind: number; bigBlind: number }; elapsedTime: string;
}) {
  const labelRef = useRef<HTMLDivElement>(null), handRef = useRef<HTMLDivElement>(null);
  // The tables overview (`fold`): the per-table items fold to nothing between Live and the units, so Live, the units and
  // Sound stand together in the middle; they open (and fold) with the zoom's curve and time, the row's groups gliding to
  // their places. Their width is measured, so the glide ends on the row as it always is (and on a refresh html[data-overview]
  // holds them folded from the first paint, globals.css). Without the overview they are simply the row's items.
  const [midW, setMidW] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = handRef.current;
    if (!fold || !el) return;
    const ro = new ResizeObserver(() => setMidW(el.offsetWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [fold]);
  const glide = (p: string) => `${p} ${ZOOM_MS}ms ${EASE} ${perTable ? 0 : outDelay}ms`;
  const midStyle: CSSProperties | undefined = fold ? {
    width: perTable ? midW ?? undefined : 0, marginLeft: perTable ? 0 : -16, opacity: perTable ? 1 : 0,
    transition: reduced() ? 'none' : ['width', 'margin-left', 'opacity'].map(glide).join(', '),
  } : undefined;
  useFillIn(labelRef, statusKnown);
  useFillIn(handRef, handKnown);
  const [labelBox, labelSize, labelAttrs] = useRememberedBox<HTMLSpanElement>('status-label', statusKnown, 'wh');
  const [handBox, handSize, handAttrs] = useRememberedBox<HTMLSpanElement>('hand-no', handKnown, 'wh');
  // Without the overview exactly the row as it always was (the items in the row itself, display: contents); on the
  // overview's first paint html[data-overview] hides them (globals.css), as the folded box will.
  const handItems = (
    <div ref={handRef} data-status-hand className={`${fold ? 'flex items-center gap-x-4 shrink-0' : 'contents'} ${handKnown ? '' : '[&>*]:invisible'}`}>
      <div className="h-4 w-px" style={{ background: 'rgba(55, 53, 47, 0.09)' }} />
      <span ref={handBox} {...handAttrs} className="text-[14px] tabular-nums" style={{ color: MUTED, ...handSize }}>Hand #{handNumber || '0'}</span>
      <div className="h-4 w-px" style={{ background: 'rgba(55, 53, 47, 0.09)' }} />
      <span className="text-[14px]" style={{ color: MUTED }}>{stakes.smallBlind}/{stakes.bigBlind}</span>
      <div className="h-4 w-px" style={{ background: 'rgba(55, 53, 47, 0.09)' }} />
      <span className="text-[14px] tabular-nums" style={{ color: MUTED }}>{elapsedTime}</span>
    </div>
  );
  return (
    <div className={`mb-1 flex flex-wrap items-center justify-center gap-x-4 gap-y-1 ${className}`}>
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
          to the same lines) and nothing under it moves when they fill in. The blank hand number is one digit (tabular
          figures), never wider than the one remembered from the last visit, so on a refresh the remembered width holds
          it exactly (a "#00" blank was wider than "#2" and the row shifted 4px when a session's first hands arrived). */}
      {fold ? <div data-status-table aria-hidden={!perTable || undefined} className="flex items-center overflow-hidden shrink-0" style={midStyle}>{handItems}</div> : handItems}
      <div className="h-4 w-px" style={{ background: 'rgba(55, 53, 47, 0.09)' }} />
      <UnitToggle bigBlind={stakes.bigBlind} />
      <div className="h-4 w-px" style={{ background: 'rgba(55, 53, 47, 0.09)' }} />
      <SoundToggle />
    </div>
  );
}
