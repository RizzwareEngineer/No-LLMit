'use client';

import { useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AnimatePresence, motion, useInView, useIsPresent } from 'motion/react';
import NumberFlow, { type Format } from '@number-flow/react';
import { MUTED, TEXT } from '@/lib/stats';
import { useRememberedBox } from '@/lib/boxes';

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

// A smooth scroll to the screen `id` (the header's About link).
export function pageTo(id: string) {
  const el = document.getElementById(id);
  if (el) scrollToTop(topOf(el), id);
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

function scrollToTop(top: number, id: string) {
  pendingY = top;
  pendingId = id || null;
  clearTimeout(clearTimer);
  clearTimer = setTimeout(settle, 1000); // browsers without scrollend
  // Lands exactly on the screen: a screen above can change height mid-scroll (the live table), and a
  // stalled or interrupted smooth scroll can stop short; either way the page would rest between two.
  window.addEventListener('scrollend', () => resnap(), { once: true });
  window.dispatchEvent(new CustomEvent('screenchange', { detail: id }));
  window.scrollTo({ top });
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

// The glide between a tile and its screen's card: ease-out, half a second.
export const GLIDE_MS = 500;
export const GLIDE = { duration: GLIDE_MS / 1000, ease: [0.22, 1, 0.36, 1] } as const;
export const NONE = { duration: 0 } as const;
// What a card adds to its tile (and the header extras) fades in just after the glide starts, and out quickly.
const OUT = { duration: 0.12, ease: 'easeOut' } as const;
const IN = { duration: 0.3, delay: 0.08, ease: 'easeOut' } as const;

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
  useLayoutEffect(() => { if (!focused && scroller.current) scroller.current.scrollTop = 0; }, [focused]);
  // The slide lives on a wrapper (the grid cell), the glide on the section: motion drops an x/y
  // that changes in the same render as a layout snap. Untransformed, the wrapper is no containing
  // block, so a focused section still fills the whole grid.
  return (
    <motion.div
      ref={cell}
      {...attrs}
      style={size}
      // A projection node, so the layout children inside (table rows, the matrix) measure through the
      // slide instead of chasing it when they re-render mid-slide.
      layout
      layoutDependency={place}
      initial={false}
      // In px (motion's projection can only factor numbers out of its measurements); only read when covered.
      animate={covered ? { x: (away.x ?? 0) * innerWidth, y: (away.y ?? 0) * innerHeight } : { x: 0, y: 0 }}
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
      className={`${CARD} overflow-hidden ${!focused ? 'relative flex-1' : fit === undefined ? 'absolute inset-0' : fit === 'hug' ? `absolute ${HUG}` : `absolute inset-x-0 inset-y-0 my-auto max-h-full ${fit === 'content' ? 'h-fit' : ''}`} ${lifted ? 'z-20' : 'z-0'} ${overview ? 'cursor-pointer' : ''} ${blank ? '[&>*]:invisible' : ''}`}
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

const OPEN = <span aria-hidden className="text-[14px] font-medium whitespace-nowrap" style={{ color: 'rgb(35, 131, 226)' }}>Open ↓</span>;
// A header extra or "Open ↓" coming or going: fades in place; one leaving steps out of the header's flow at its right
// end, so the header never wraps or shifts while the two cross-fade. `stay`: it leaves where it was in the tile ("Open ↓"
// as the tile opens: the header takes the card's width at once, and its right end lies outside the tile's box).
function Swap({ snap, stay = false, children }: { snap: boolean; stay?: boolean; children: React.ReactNode }) {
  const present = useIsPresent();
  const ref = useRef<HTMLDivElement>(null), at = useRef<number | null>(null);
  useLayoutEffect(() => {
    const el = ref.current, box = el?.offsetParent as HTMLElement | null;
    if (!stay || !el || !box) return;
    // Layout offsets (no transforms), from the box's offset parent (the section), which the header does not move.
    if (present) at.current = el.offsetLeft + box.offsetLeft;
    else if (at.current !== null) el.style.left = `${at.current - box.offsetLeft}px`;
  });
  return (
    <motion.div ref={ref} initial={{ opacity: 0 }} animate={{ opacity: 1, transition: snap ? NONE : IN }} exit={{ opacity: 0, transition: OUT }} className={present ? '' : `absolute ${stay ? '' : 'right-0'} inset-y-0 flex items-center`}>
      {children}
    </motion.div>
  );
}

// Something the card adds around its tile's content: fades in as the tile glides open (nothing when `still`).
export function Added({ still = false, className, style, children }: { still?: boolean; className?: string; style?: React.CSSProperties; children: React.ReactNode }) {
  return <motion.div initial={still ? false : { opacity: 0 }} animate={{ opacity: 1, transition: IN }} className={`added ${className ?? ''}`} style={style}>{children}</motion.div>;
}

export const SHADOW = 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.1) 0px 2px 4px';

// The pill that pages on to the next main screen: "Stats ↓" under the table, "About ↓" under the overview.
export const NEXT_BUTTON = 'flex items-center gap-2 rounded-full border px-5 py-2 text-[15px] font-semibold bg-white hover:bg-[rgba(55,53,47,0.04)] shadow-sm';
export const NEXT_STYLE = { color: 'rgb(55, 53, 47)', borderColor: 'rgba(55, 53, 47, 0.2)' };

// One chrome for every stats card (overview tiles, the zoomed Race panel and the Stats and
// Pairwise cards): same radius, ring, shadow and padding, so paging changes only the content.
// card-chrome (globals.css) dims the card as the next one slides over it.
export const CARD = 'card-chrome flex flex-col min-h-0 min-w-0 bg-white p-4 rounded-lg';
export const CARD_SHADOW = 'rgba(15, 15, 15, 0.08) 0px 0px 0px 1px, rgba(15, 15, 15, 0.06) 0px 4px 16px';
export const HEADER = 'mb-2 min-h-8 flex flex-wrap items-center justify-between gap-x-4 gap-y-1';
export const TITLE = 'text-[20px] leading-8 font-bold';
// A card as big as its content, centred in the overview's box (the opened Matchups card).
export const HUG = 'inset-0 m-auto w-fit h-fit max-w-full max-h-full';

// A row of mutually exclusive buttons (the Race range, the Pairwise view).
export function Segmented<T extends string | number>({ label, options, value, onChange }: {
  label: string;
  options: { label: string; value: T; disabled?: boolean }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex shrink-0 rounded p-0.5 text-[14px]" style={{ background: 'rgba(55, 53, 47, 0.06)' }}>
      {options.map(o => (
        <button
          key={o.label}
          onClick={() => onChange(o.value)}
          disabled={o.disabled}
          aria-pressed={value === o.value}
          className="rounded px-3 py-0.5 font-medium disabled:opacity-40"
          style={value === o.value ? { background: 'white', color: TEXT, boxShadow: SHADOW } : { color: MUTED }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// A number that counts up from zero the first time it scrolls into view, then rolls to new
// values. NumberFlow skips the animation under prefers-reduced-motion.
export function CountUp({ value, format, suffix }: { value: number; format?: Format; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const seen = useInView(ref, { once: true });
  return (
    <span ref={ref}>
      <NumberFlow value={seen ? value : 0} format={format} suffix={suffix} />
    </span>
  );
}
