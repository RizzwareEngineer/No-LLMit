'use client';

import { useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { AnimatePresence, MotionConfig, PresenceContext, cubicBezier, motion, usePresence } from 'motion/react';
import { BLUE, MUTED, TEXT } from '@/lib/stats';
import { useRememberedBox } from '@/lib/boxes';
import { isPhone } from '@/lib/layout';
import { CARD, CARD_SHADOW, HEADER, SHADOW, Segmented, TITLE } from '@/components/ui';

export { CARD, CARD_SHADOW, HEADER, SHADOW, Segmented, TITLE };

// Document y of every snap screen, top to bottom. Screens carry no transforms, so the
// bounding box is their layout position.
const screens = () => [...document.querySelectorAll<HTMLElement>('[data-screen]')];
const topOf = (el: HTMLElement) => el.getBoundingClientRect().top + window.scrollY;

// Where a running paged scroll is headed, so a second press steps on from there.
let pendingY: number | null = null;
let pendingId: string | null = null; // the screen that scroll is headed for
let clearTimer: ReturnType<typeof setTimeout> | undefined;
const settle = () => {
  pendingY = null;
  pendingId = null;
  clearTimeout(clearTimer);
};
// An instant jump elsewhere (a tile opening, Back to overview) replaces a running paged scroll: its end must not
// land the page back on the paged scroll's screen.
export const stopPaging = settle;

// Scroll one screen down (1) or up (-1); a screen taller than the window (the phone table)
// moves one window at a time inside it. Smooth through scroll-behavior in globals.css, which
// prefers-reduced-motion turns off. Announces the target screen so the zoom can start at once.
// A screen marked data-back="up" or "down" goes back to the overview that way instead, as Back to overview
// does (the stats cards' loop: up on History, down on Matchups); data-end ends the page going down (About).
// Returns false at either end of the page, where there is nowhere to go.
export function pageBy(dir: 1 | -1) {
  if (performance.now() < heldUntil) return true; // swallowed, not refused: the wheel lock still arms
  const y = pendingY ?? window.scrollY;
  const h = window.innerHeight;
  const list = screens();
  const tops = list.map(topOf);
  const here = list[tops.findIndex(t => Math.abs(t - y) < 2)];
  if (here?.dataset.back === (dir > 0 ? 'down' : 'up')) {
    backToOverview();
    return true;
  }
  if (dir > 0 && here?.hasAttribute('data-end')) return false;
  let top = dir > 0 ? tops.find(t => t > y + 1) : tops.findLast(t => t < y - 1);
  if (top === undefined) return false;
  top = dir > 0 ? Math.min(top, y + h) : Math.max(top, y - h);
  const at = top;
  // A fractional screen top (a table screen 709.14px tall) must still name its screen.
  scrollToTop(Math.min(top, document.documentElement.scrollHeight - h), list[tops.findIndex(t => Math.abs(t - at) < 2)]?.id ?? '');
  return true;
}

// A smooth scroll to the screen `id` (the header's About link); `instant` jumps there (a phone's tab bar: a smooth scroll
// from the table to About showed every window between, a flash of each).
export function pageTo(id: string, instant = false) {
  const el = document.getElementById(id);
  if (el) scrollToTop(topOf(el), id, instant);
}

// While a tile glides to or from its card (StatsSections), paging waits: the page jumps to the
// glide's screen when it lands.
let heldUntil = 0;
export const hold = (ms: number) => { heldUntil = performance.now() + ms; };

// The screen the page is on ('' is the table), for the sticky bar's Back to overview.
let onScreen = '';
const listeners = new Set<() => void>();
export const currentScreen = () => onScreen;
export function setScreen(id: string) {
  if (id === onScreen) return;
  onScreen = id;
  listeners.forEach(l => l());
}
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => { listeners.delete(l); };
};
export const useScreen = () => useSyncExternalStore(subscribe, currentScreen, () => '');
// Glides the detail screen's card back to its overview tile (StatsSections listens).
export const backToOverview = () => window.dispatchEvent(new Event('overview'));
// Phone draft A (StatsSections' PhoneStats): the stats are one window, the overview of the three parts or the part opened
// from it in its place. openPart opens one there (now, so the page can go to it) and pages to it unless it is in view;
// pageToStats pages to the window as it is (a native tab bar's tab keeps the part it was left on).
// A part asked for before the stats have mounted (StatsScreens loads them on the first touch, so a tap on the landing fill
// comes first) opens when they do (takePart); the page goes to their window meanwhile.
let asked: string | null = null;
export const takePart = () => { const p = asked; asked = null; return p; };
export function openPart(part: string) {
  flushSync(() => window.dispatchEvent(new CustomEvent('tileopen', { detail: part })));
  if (!document.getElementById(part)) asked = part;
  const el = document.getElementById(part) ?? document.getElementById('stats');
  if (el && Math.abs(el.getBoundingClientRect().top) > 1) pageTo(el.id);
}
export const pageToStats = (instant = false) => pageTo(document.querySelector('.stats-room > section[data-screen]:not(#about)')?.id ?? 'stats', instant);

// A paged scroll is underway (it ends on a screen edge by itself).
export const isPaging = () => pendingId !== null;

// Puts the page back on a screen edge after a focus scroll or a resize left it between two:
// the screen a running paged scroll was headed for, else the nearest one (never above `min`).
// A screen taller than the window (the phone table) is fine anywhere inside it.
export function resnap(min = 0) {
  const target = pendingId !== null ? document.getElementById(pendingId) : null;
  const list = screens();
  const y = window.scrollY;
  const h = window.innerHeight;
  settle();
  let el = target;
  if (!el) {
    const inside = list.find(s => { const t = topOf(s); return t <= y + 1 && y + h <= t + s.offsetHeight + 1; });
    if (inside && topOf(inside) >= min) return;
    el = list.filter(s => topOf(s) >= min - 1).sort((a, b) => Math.abs(topOf(a) - y) - Math.abs(topOf(b) - y))[0];
  }
  if (!el || Math.abs(topOf(el) - y) < 1) return;
  window.dispatchEvent(new CustomEvent('screenchange', { detail: el.id }));
  window.scrollTo({ top: topOf(el), behavior: 'instant' });
}

function scrollToTop(top: number, id: string, instant = false) {
  pendingY = top;
  pendingId = id || null;
  clearTimeout(clearTimer);
  clearTimer = setTimeout(settle, 1000); // browsers without scrollend
  // Lands exactly on the screen: a screen above can change height mid-scroll (the live table), and a
  // stalled or interrupted smooth scroll can stop short; either way the page would rest between two.
  window.addEventListener('scrollend', () => resnap(), { once: true });
  window.dispatchEvent(new CustomEvent('screenchange', { detail: id }));
  window.scrollTo(instant ? { top, behavior: 'instant' } : { top });
}

// True when `el` or an ancestor would scroll itself for a wheel or key in direction `dir`.
// Overflow of a pixel or two (subpixel rounding) does not count: it would eat a whole gesture.
export function scrollsInside(el: Element | null, dir: number) {
  for (; el && el !== document.documentElement && el !== document.body; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el);
    if ((overflowY !== 'auto' && overflowY !== 'scroll') || el.scrollHeight - el.clientHeight <= 2) continue;
    if (dir > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop >= 1) return true;
  }
  return false;
}

// The wide stats' one scale (--sz, page.tsx's fitStage): they are laid out at one reference size and zoomed (CSS zoom)
// to the stage's column. Under it a length is in layout px, one drawn px being 1/zoom of them; motion measures drawn
// boxes, so inside the zoom it is given them in layout px (StatsZoom), or its glides would travel zoom times too far.
export const statsZoom = () => (typeof window === 'undefined' || isPhone() ? 1 : parseFloat(document.documentElement.style.getPropertyValue('--sz')) || 1);
const toLayout = (p: { x: number; y: number }) => { const z = statsZoom(); return z === 1 ? p : { x: p.x / z, y: p.y / z }; };
export function StatsZoom({ children }: { children: React.ReactNode }) {
  return <MotionConfig transformPagePoint={toLayout}>{children}</MotionConfig>;
}

// The glide between a tile and its screen's card: ease-out, half a second.
export const GLIDE_MS = 500;
// Its last ~60 ms are under 3/10,000 of the way from rest (under 0.3px on the widest glide): drawn there, text raster under
// that leftover transform came out softer than the same text at rest, so the frame before a hand-over (often the glide's
// last step: a busy machine drops the landed frame) differed from the card in the title and names. Those frames draw at rest.
const glideEase = cubicBezier(0.22, 1, 0.36, 1);
export const GLIDE = { duration: GLIDE_MS / 1000, ease: (t: number) => { const v = glideEase(t); return v > 1 - 3e-4 ? 1 : v; } } as const;
export const NONE = { duration: 0 } as const;
// What a card adds to its tile (and the header extras) fades in just after the glide starts, and out quickly.
// OUT and IN are globals.css' add-out and add-in, which must keep their times.
export const OUT = { duration: 0.12, ease: 'easeOut' } as const;

// A tile of the overview: a title, a teaser and an "Open ↓" affordance. A click (or Enter or
// Space with the tile focused: it is a tab stop) calls onOpen, except on links and controls inside it.
// `focused`: the tile stands in its screen card's place; motion's layout animation turns that jump
// into a glide (transforms only, nothing under reduced motion). `fit` sets that place: a height in px
// or 'content', centred in the stage at the stage's width, or 'hug' (its content's width and height,
// centred); without it the tile fills the stage. `blank`: its data is still loading: the tile stands in blank at its
// place and size (a phone's, as tall as it last was with its data).
// `covered`: another tile is focused, and this one slides off the screen by `away` (back in when it
// is not). `lifted`: the tile focused last, on top while it glides back. `snap`: change without
// animating (the stage is hidden under a card). The body never cross-fades: the caller keeps the
// tile's content mounted so it grows into the card, and wraps what the card adds in <Added>.
// `extra` (the card's header extras) fades in the same way. The body scrolls inside itself when it overflows.
export default function Panel({
  id,
  title,
  aside,
  extra,
  focused = false,
  covered = false,
  away = {},
  lifted = false,
  snap = false,
  fit,
  blank = false,
  onOpen,
  className = '',
  children,
}: {
  id: string;
  title: React.ReactNode;
  aside?: React.ReactNode;
  extra?: React.ReactNode; // header extras of the card this tile stands in for, while focused
  focused?: boolean;
  covered?: boolean;
  away?: { x?: number; y?: number }; // which way it slides off, in viewport lengths (one clears the screen at any size)
  lifted?: boolean;
  snap?: boolean;
  fit?: number | 'content' | 'hug';
  blank?: boolean;
  onOpen: () => void;
  className?: string;
  children: React.ReactNode;
}) {
  const overview = !focused && !covered;
  const open = (e: React.SyntheticEvent) => {
    e.preventDefault();
    onOpen();
  };
  const move = snap ? NONE : GLIDE;
  // Measured only when the tile's place changes (opens, closes, slides off, its card's height): a phone's tiles
  // also move as the ones above them fill in, and a glide started then would leave the content inside, which
  // measures only when it changes, in its place from before.
  const place = `${focused}|${covered}|${fit}`;
  const [cell, size, attrs] = useRememberedBox<HTMLDivElement>(id, !blank);
  // A tile that hands over to a card of its own (Profiles, Matchups: it takes the card's header extras). Its "Open ↓"
  // fades, and it scrolls only once its glide has landed (no scrollbars mid-glide); Trends' tile stays as it was.
  const hands = extra !== undefined;
  const [landed, setLanded] = useState(place);
  // Back on the overview, a tile shows its top (the tile standing in for a card was scrolled as the card was).
  const scroller = useRef<HTMLDivElement>(null);
  // Its cell keeps its overview height while the tile is out (a phone's cell has no height but its tile's): a cell that
  // shrank would be layout-animated, and a transformed cell becomes the opened tile's containing block (squeezed to it).
  const [held, setHeld] = useState<number>();
  useLayoutEffect(() => {
    const el = cell.current;
    if (!hands || !overview || !el) return;
    const ro = new ResizeObserver(() => setHeld(parseFloat(getComputedStyle(el).height))); // exact: a rounded height still moves it
    ro.observe(el);
    return () => ro.disconnect();
  }, [hands, overview, cell]);
  useLayoutEffect(() => { if (!focused && scroller.current) scroller.current.scrollTop = 0; }, [focused]);
  // The slide lives on a wrapper (the grid cell), the glide on the section: motion drops an x/y
  // that changes in the same render as a layout snap. Untransformed, the wrapper is no containing
  // block, so a focused section still fills the whole grid.
  return (
    <motion.div
      ref={cell}
      {...attrs}
      style={hands && !overview ? { ...size, minHeight: held } : size}
      // A projection node, so the layout children inside (table rows, the matrix) measure through the
      // slide instead of chasing it when they re-render mid-slide.
      layout
      layoutDependency={place}
      initial={false}
      // In px (motion's projection can only factor numbers out of its measurements); only read when covered.
      animate={covered ? { x: (away.x ?? 0) * innerWidth / statsZoom(), y: (away.y ?? 0) * innerHeight / statsZoom() } : { x: 0, y: 0 }}
      transition={move}
      className={`flex flex-col min-h-0 min-w-0 ${className}`}
    >
    <motion.section
      layout
      layoutDependency={place}
      initial={false}
      transition={move}
      // The glide to the card's place has landed: StatsSections hands over to the card now.
      onLayoutAnimationComplete={focused ? () => { setLanded(place); window.dispatchEvent(new CustomEvent('glideend', { detail: id })); } : undefined}
      id={id}
      aria-labelledby={`${id}-title`}
      inert={covered}
      tabIndex={overview ? 0 : -1}
      onClick={overview ? e => {
        if (!(e.target as Element).closest('a, button, select, input, label')) open(e);
      } : undefined}
      onKeyDown={overview ? e => (e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget && open(e) : undefined}
      className={`${CARD} overflow-hidden ${!focused ? 'relative flex-1' : fit === undefined ? 'absolute inset-0' : fit === 'hug' ? `absolute ${HUG}` : `absolute inset-x-0 inset-y-0 mb-auto max-h-full ${fit === 'content' ? 'h-fit' : ''}`} ${lifted ? 'z-20' : 'z-0'} ${overview ? 'cursor-pointer' : ''} ${blank ? '[&>*]:invisible' : ''}`}
      style={{ boxShadow: CARD_SHADOW, height: focused && typeof fit === 'number' ? fit : undefined }}
    >
      <motion.div layout="position" layoutDependency={place} transition={move} className={HEADER}>
        <h2 id={`${id}-title`} className={TITLE} style={{ color: TEXT }}>
          {/* No link (the URL never names a stats screen): the tile itself is the one tab stop that opens it. */}
          <span className="hover:underline">{title}</span>
        </h2>
        <div className="relative flex items-center gap-4 min-w-0">
          {aside}
          <AnimatePresence initial={false}>
            {extra && <Swap key="extra" snap={snap}>{extra}</Swap>}
            {hands && overview && <Swap key="open" snap={snap} stay>{OPEN}</Swap>}
          </AnimatePresence>
          {!hands && overview && OPEN}
        </div>
      </motion.div>
      {/* A tile never scrolls (it opens its card instead); only the focused card may. */}
      <motion.div ref={scroller} layout layoutDependency={place} layoutScroll transition={move} className={`panel-scroll flex-1 min-h-0 min-w-0 flex flex-col [&>*]:shrink-0 ${focused && (!hands || snap || landed === place) ? 'overflow-auto' : 'overflow-hidden'}`}>
        {children}
      </motion.div>
    </motion.section>
    </motion.div>
  );
}

export const OPEN = <span aria-hidden className="text-[14px] font-medium whitespace-nowrap" style={{ color: BLUE }}>Open ↓</span>;
// A header extra or "Open ↓" coming or going: fades in place; one leaving steps out of the header's flow at its right
// end, so the header never wraps or shifts while the two cross-fade. `stay`: it leaves where it was in the tile ("Open ↓"
// as the tile opens: the header takes the card's width at once, and its right end lies outside the tile's box).
// Each fade starts once the frame that draws its cause (the glide's first step, the overview back) has been painted, two
// frames on: started in that frame, one a busy machine held past the fade drew it whole, and it came or went at once.
// One there from the first render, or snapped in, shows at once.
// A fade of the CSS variable --fade on `el`: over its time (ease-out), but never more than MAX_STEP in one drawn frame. A
// busy machine that held a frame past a purely time-based fade drew it whole at once (glide-clean: the Leader 0.09 →
// 1.00 between two frames); a purely per-frame one ran several times its length at a low frame rate and held the
// hand-over (matchups-wraps). IN: 300 ms after 80 ms; OUT: 120 ms. Returns a cancel.
const IN_FADE = [300, 80] as const, OUT_FADE = [120, 0] as const, MAX_STEP = 0.34;
function stepFade(el: HTMLElement, to: number, [ms, delay]: readonly [number, number], done?: () => void) {
  const was = parseFloat(el.style.getPropertyValue('--fade'));
  let v = Number.isNaN(was) ? 1 - to : was;
  const from = v;
  if (matchMedia('(prefers-reduced-motion: reduce)').matches || from === to) { el.style.setProperty('--fade', String(to)); done?.(); return () => {}; }
  let t0 = 0, id = 0;
  const tick = (now: number) => {
    t0 ||= now;
    const t = Math.min(1, Math.max(0, (now - t0 - delay) / ms)), want = t >= 1 ? to : from + (to - from) * (1 - (1 - t) ** 2);
    v = to > from ? Math.min(want, v + MAX_STEP) : Math.max(want, v - MAX_STEP);
    el.style.setProperty('--fade', String(v));
    if (v === to) { done?.(); return; }
    id = requestAnimationFrame(tick);
  };
  id = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(id);
}

function Swap({ snap, stay = false, children }: { snap: boolean; stay?: boolean; children: React.ReactNode }) {
  const [present, safeToRemove] = usePresence();
  const first = useContext(PresenceContext)?.initial === false;
  const [shown, setShown] = useState<boolean | null>(snap || first || null); // null: not yet shown
  const [start] = useState(shown ? 1 : 0); // the first value of --fade (React never sets it again)
  const live = useRef(present);
  useLayoutEffect(() => { live.current = present; });
  useEffect(() => {
    if (!present && shown === null) return safeToRemove?.(); // gone before it came in: nothing to fade
    let id = requestAnimationFrame(() => (id = requestAnimationFrame(() => setShown(present))));
    return () => cancelAnimationFrame(id);
  }, [present]); // eslint-disable-line react-hooks/exhaustive-deps -- once per arrival or departure
  const ref = useRef<HTMLDivElement>(null), at = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current, box = el?.offsetParent as HTMLElement | null;
    if (!stay || !el || !box) return;
    // Layout offsets (no transforms), from the box's offset parent (the section), which the header does not move.
    if (present) at.current = el.offsetLeft + box.offsetLeft;
    else if (at.current !== null) el.style.left = `${at.current - box.offsetLeft}px`;
  });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || shown === null) return;
    if (shown && snap) { el.style.setProperty('--fade', '1'); return; }
    return stepFade(el, shown ? 1 : 0, shown ? IN_FADE : OUT_FADE, () => { if (!live.current) safeToRemove?.(); });
  }, [shown]); // eslint-disable-line react-hooks/exhaustive-deps -- once per change of shown
  return (
    // A variable, not opacity, fades (globals.css' add-in): an opacity fade leaves its text in a layer of its own a while after.
    <div ref={ref} className={present ? '' : `absolute ${stay ? '' : 'right-0'} inset-y-0 flex items-center`} style={{ '--fade': start, opacity: 'var(--fade)' } as React.CSSProperties}>
      {children}
    </div>
  );
}

// Something the card adds around its tile's content: fades in as the tile glides open (nothing when `still`).
export function Added({ still = false, className, style, children }: { still?: boolean; className?: string; style?: React.CSSProperties; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [start] = useState(still ? 1 : 0);
  useLayoutEffect(() => (still || !ref.current ? undefined : stepFade(ref.current, 1, IN_FADE)), []); // eslint-disable-line react-hooks/exhaustive-deps -- on mount
  return <div ref={ref} className={`added ${className ?? ''}`} style={{ ...style, '--fade': start, opacity: 'var(--fade)' } as React.CSSProperties}>{children}</div>;
}


// The pill that pages on to the next main screen: "Stats ↓" under the table, "About ↓" under the overview.
export const NEXT_BUTTON = 'flex items-center gap-2 rounded-full border px-5 py-2 text-[15px] font-semibold bg-white hover:bg-[rgba(55,53,47,0.04)] shadow-sm';
export const NEXT_STYLE = { color: 'rgb(55, 53, 47)', borderColor: 'rgba(55, 53, 47, 0.2)' };

// A card as big as its content, centred across the overview's box and at its top (the opened Matchups card): every opened
// card starts the same gap under the top bar, never floating mid-screen.
export const HUG = 'inset-0 mx-auto mb-auto w-fit h-fit max-w-full max-h-full';

