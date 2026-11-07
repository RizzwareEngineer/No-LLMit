'use client';

import { useRef, useSyncExternalStore } from 'react';
import { AnimatePresence, motion, useInView } from 'motion/react';
import NumberFlow, { type Format } from '@number-flow/react';
import { MUTED, TEXT } from '@/lib/stats';

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

// Scroll one screen down (1) or up (-1); a screen taller than the window (the phone table)
// moves one window at a time inside it. Smooth through scroll-behavior in globals.css, which
// prefers-reduced-motion turns off. Announces the target screen so the zoom can start at once.
// Returns false at either end of the page, where there is nowhere to go.
export function pageBy(dir: 1 | -1) {
  if (performance.now() < heldUntil) return true; // swallowed, not refused: the wheel lock still arms
  const y = pendingY ?? window.scrollY;
  const h = window.innerHeight;
  const list = screens();
  const tops = list.map(topOf);
  let top = dir > 0 ? tops.find(t => t > y + 1) : tops.findLast(t => t < y - 1);
  if (top === undefined) return false;
  top = dir > 0 ? Math.min(top, y + h) : Math.max(top, y - h);
  const at = top;
  // A fractional screen top (a table screen 709.14px tall) must still name its screen.
  scrollToTop(Math.min(top, document.documentElement.scrollHeight - h), list[tops.findIndex(t => Math.abs(t - at) < 2)]?.id ?? '');
  return true;
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
  window.addEventListener('scrollend', settle, { once: true });
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

// The glide between a tile and its screen's card: ease-out, half a second. Fades run a little shorter.
export const GLIDE_MS = 500;
const GLIDE = { duration: GLIDE_MS / 1000, ease: [0.22, 1, 0.36, 1] } as const;
const FADE = { duration: 0.3, ease: 'easeOut' } as const;
const NONE = { duration: 0 } as const;
// The cross-fade inside a gliding tile: the old content goes quickly, the new comes in just after,
// so the two barely overlap.
const OUT = { duration: 0.12, ease: 'easeOut' } as const;
const IN = { duration: 0.3, delay: 0.08, ease: 'easeOut' } as const;

// A tile of the overview: a linked title, a teaser and an "Open ↓" affordance. A click (or Enter or
// Space with the tile focused) calls onOpen, except on links and controls inside it.
// `focused`: the tile fills the stage, in its screen card's place; motion's layout animation turns
// that jump into a glide (transforms only, nothing under reduced motion). `covered`: another tile
// is focused, and this one fades out. `lifted`: the tile focused last, on top while it glides back.
// `snap`: change without animating (the stage is hidden under a card). A new `body` key cross-fades
// the body (a tile's teaser to its card's content); `extra` fades in and out the same way. The body scrolls inside itself when it overflows.
export default function Panel({
  id,
  href,
  title,
  aside,
  extra,
  focused = false,
  covered = false,
  lifted = false,
  snap = false,
  body = 'tile',
  onOpen,
  className = '',
  children,
}: {
  id: string;
  href: string;
  title: React.ReactNode;
  aside?: React.ReactNode;
  extra?: React.ReactNode; // header extras of the card this tile stands in for, while focused
  focused?: boolean;
  covered?: boolean;
  lifted?: boolean;
  snap?: boolean;
  body?: string;
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
  return (
    <motion.section
      layout
      initial={false}
      animate={{ opacity: covered ? 0 : 1 }}
      transition={{ ...move, opacity: snap ? NONE : FADE }}
      id={id}
      aria-labelledby={`${id}-title`}
      inert={covered}
      tabIndex={overview ? 0 : -1}
      onClick={overview ? e => {
        const t = e.target as Element;
        if (t.closest(`#${id}-title a`) || !t.closest('a, button, select, input, label')) open(e);
      } : undefined}
      onKeyDown={overview ? e => (e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget && open(e) : undefined}
      className={`${CARD} overflow-hidden ${focused ? 'absolute inset-0' : `relative ${className}`} ${lifted ? 'z-20' : 'z-0'} ${overview ? 'cursor-pointer' : ''}`}
      style={{ boxShadow: CARD_SHADOW }}
    >
      <motion.div layout="position" transition={move} className={HEADER}>
        <h2 id={`${id}-title`} className={TITLE} style={{ color: TEXT }}>
          {/* Not a tab stop: the tile itself is the one stop that opens it. */}
          <a href={href} tabIndex={-1} className="hover:underline">{title}</a>
        </h2>
        <div className="flex items-center gap-4">
          {aside}
          <AnimatePresence initial={false}>
            {extra && (
              <motion.div key="extra" initial={{ opacity: 0 }} animate={{ opacity: 1, transition: snap ? NONE : IN }} exit={{ opacity: 0, transition: OUT }}>
                {extra}
              </motion.div>
            )}
          </AnimatePresence>
          {overview && <span aria-hidden className="text-[14px] font-medium" style={{ color: 'rgb(35, 131, 226)' }}>Open ↓</span>}
        </div>
      </motion.div>
      <AnimatePresence initial={false} mode="popLayout">
        <motion.div
          key={body}
          layout
          initial={{ opacity: 0 }}
          animate={{ opacity: 1, transition: snap ? NONE : IN }}
          exit={{ opacity: 0, transition: OUT }}
          transition={move}
          className="panel-scroll flex-1 min-h-0 min-w-0 flex flex-col [&>*]:shrink-0 overflow-auto"
        >
          {children}
        </motion.div>
      </AnimatePresence>
    </motion.section>
  );
}

export const SHADOW = 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.1) 0px 2px 4px';

// One chrome for every stats card (overview tiles, the zoomed Race panel and the Stats and
// Pairwise cards): same radius, ring, shadow and padding, so paging changes only the content.
// card-chrome (globals.css) dims the card as the next one slides over it.
export const CARD = 'card-chrome flex flex-col min-h-0 min-w-0 bg-white p-4 rounded-lg';
export const CARD_SHADOW = 'rgba(15, 15, 15, 0.08) 0px 0px 0px 1px, rgba(15, 15, 15, 0.06) 0px 4px 16px';
export const HEADER = 'mb-2 min-h-8 flex flex-wrap items-center justify-between gap-x-4 gap-y-1';
export const TITLE = 'text-[20px] leading-8 font-bold';

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
