'use client';

import { useRef } from 'react';
import { motion, useInView } from 'motion/react';
import NumberFlow, { type Format } from '@number-flow/react';
import { TEXT } from '@/lib/stats';

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
  const y = pendingY ?? window.scrollY;
  const h = window.innerHeight;
  const list = screens();
  const tops = list.map(topOf);
  let top = dir > 0 ? tops.find(t => t > y + 1) : tops.findLast(t => t < y - 1);
  if (top === undefined) return false;
  top = dir > 0 ? Math.min(top, y + h) : Math.max(top, y - h);
  scrollToTop(Math.min(top, document.documentElement.scrollHeight - h), list[tops.indexOf(top)]?.id ?? '');
  return true;
}

// Scroll to the screen with this id (the overview's click-to-zoom).
export function goToScreen(id: string) {
  const el = document.getElementById(id);
  if (el) scrollToTop(topOf(el), id);
}

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

const SPRING = { type: 'spring', stiffness: 260, damping: 32 } as const;

// A panel of the overview: a small linked title and a card. A click (or Enter or Space with the
// panel focused) scrolls to the panel's own screen, except on links and controls inside it.
// `focused` (the Race panel only) lifts it out of the grid to fill the stage; motion's layout
// animation turns that jump into the page's one zoom (transforms only, nothing under reduced
// motion). `covered`: the zoomed panel sits over this one. The body scrolls inside itself when it overflows.
export default function Panel({
  id,
  href,
  land,
  title,
  aside,
  focused = false,
  covered = false,
  className = '',
  children,
}: {
  id: string;
  href: string;
  land: string; // the element on that screen that takes focus
  title: React.ReactNode;
  aside?: React.ReactNode;
  focused?: boolean;
  covered?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  const overview = !focused && !covered;
  const zoom = (e: React.SyntheticEvent) => {
    e.preventDefault();
    history.replaceState(null, '', href); // shareable; fires no hashchange, so the #model= drawer is untouched
    // Focus moves to the destination first: this panel goes inert under the zoom, and React putting
    // focus back on it would scroll it into view and cancel the scroll.
    document.getElementById(land)?.focus({ preventScroll: true });
    goToScreen(href.slice(1));
  };
  return (
    <motion.section
      layout={id === 'race-panel'}
      initial={false}
      transition={SPRING}
      id={id}
      aria-labelledby={`${id}-title`}
      inert={covered}
      tabIndex={overview ? 0 : -1}
      onClick={overview ? e => {
        const t = e.target as Element;
        if (t.closest(`#${id}-title a`) || !t.closest('a, button, select, input, label')) zoom(e);
      } : undefined}
      onKeyDown={overview ? e => (e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget && zoom(e) : undefined}
      className={`flex flex-col min-h-0 min-w-0 bg-white p-3 ${focused ? 'absolute inset-0 z-20' : `relative z-0 ${className}`} ${overview ? 'cursor-zoom-in' : ''}`}
      style={{ borderRadius: 4, boxShadow: SHADOW }}
    >
      <motion.div layout={id === 'race-panel' && 'position'} transition={SPRING} className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id={`${id}-title`} className={`font-bold ${focused ? 'text-[18px]' : 'text-[14px]'}`} style={{ color: TEXT }}>
          {/* Not a tab stop: the panel itself is the one stop that zooms. */}
          <a href={href} tabIndex={-1} className="hover:underline">{title}</a>
        </h2>
        {aside}
      </motion.div>
      <motion.div layout={id === 'race-panel'} transition={SPRING} className="panel-scroll flex-1 min-h-0 min-w-0 flex flex-col [&>*]:shrink-0 overflow-auto">
        {children}
      </motion.div>
    </motion.section>
  );
}

export const SHADOW = 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.1) 0px 2px 4px';

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
