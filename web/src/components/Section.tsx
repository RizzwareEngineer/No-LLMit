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

// A stats panel: a small linked title and a card. `focused` lifts it out of the overview grid
// to fill the stage; motion's layout animation turns that jump into a zoom (transforms only,
// and nothing under reduced motion). The body scrolls inside itself when it overflows.
// In the overview a click (or Enter or Space with the panel focused) scrolls to the panel's own screen,
// except on links and controls inside it.
export default function Panel({
  id,
  href,
  title,
  aside,
  focused,
  covered,
  className = '',
  children,
}: {
  id: string;
  href: string;
  title: React.ReactNode;
  aside?: React.ReactNode;
  focused: boolean;
  covered: boolean; // another panel fills the stage over this one
  className?: string;
  children: React.ReactNode;
}) {
  const overview = !focused && !covered;
  const zoom = (e: React.SyntheticEvent) => {
    e.preventDefault();
    history.replaceState(null, '', href); // shareable; fires no hashchange, so the #model= drawer is untouched
    goToScreen(href.slice(1));
  };
  return (
    <motion.section
      layout
      initial={false}
      // Covered panels fade out, so a panel-to-panel zoom never shows the overview between.
      animate={{ opacity: covered ? 0 : 1 }}
      transition={{ ...SPRING, opacity: { duration: 0.2 } }}
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
      style={{ borderRadius: 4, boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.1) 0px 2px 4px' }}
    >
      <motion.div layout="position" transition={SPRING} className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id={`${id}-title`} className="text-[14px] font-bold" style={{ color: TEXT }}>
          {/* Not a tab stop: the panel itself is the one stop that zooms. */}
          <a href={href} tabIndex={-1} className="hover:underline">{title}</a>
        </h2>
        {aside}
      </motion.div>
      <motion.div layout transition={SPRING} className="panel-scroll flex-1 min-h-0 min-w-0 flex flex-col [&>*]:shrink-0 overflow-auto">
        {children}
      </motion.div>
    </motion.section>
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
