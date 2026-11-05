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
let clearTimer: ReturnType<typeof setTimeout> | undefined;
const settle = () => {
  pendingY = null;
  clearTimeout(clearTimer);
};

// Scroll one screen down (1) or up (-1); a screen taller than the window (the phone table)
// moves one window at a time inside it. Smooth through scroll-behavior in globals.css, which
// prefers-reduced-motion turns off. Announces the target screen so the zoom can start at once.
export function pageBy(dir: 1 | -1) {
  const y = pendingY ?? window.scrollY;
  const h = window.innerHeight;
  const list = screens();
  const tops = list.map(topOf);
  let top = dir > 0 ? tops.find(t => t > y + 1) : tops.findLast(t => t < y - 1);
  if (top === undefined) return;
  top = dir > 0 ? Math.min(top, y + h) : Math.max(top, y - h);
  top = Math.min(top, document.documentElement.scrollHeight - h);
  pendingY = top;
  clearTimeout(clearTimer);
  clearTimer = setTimeout(settle, 1000); // browsers without scrollend
  window.addEventListener('scrollend', settle, { once: true });
  window.dispatchEvent(new CustomEvent('screenchange', { detail: list[tops.indexOf(top)]?.id ?? '' }));
  window.scrollTo({ top });
}

// True when `el` or an ancestor would scroll itself for a wheel or key in direction `dir`.
export function scrollsInside(el: Element | null, dir: number) {
  for (; el && el !== document.documentElement && el !== document.body; el = el.parentElement) {
    const { overflowY } = getComputedStyle(el);
    if (overflowY !== 'auto' && overflowY !== 'scroll') continue;
    if (dir > 0 ? el.scrollTop + el.clientHeight < el.scrollHeight - 1 : el.scrollTop > 0) return true;
  }
  return false;
}

const SPRING = { type: 'spring', stiffness: 260, damping: 32 } as const;

// A stats panel: a small linked title and a card. `focused` lifts it out of the overview grid
// to fill the stage; motion's layout animation turns that jump into a zoom (transforms only,
// and nothing under reduced motion). The body scrolls inside itself when it overflows.
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
  return (
    <motion.section
      layout
      transition={SPRING}
      id={id}
      aria-labelledby={`${id}-title`}
      inert={covered}
      className={`flex flex-col min-h-0 min-w-0 bg-white p-3 ${focused ? 'absolute inset-0 z-20' : `relative z-0 ${className}`}`}
      style={{ borderRadius: 4, boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.1) 0px 2px 4px' }}
    >
      <motion.div layout="position" transition={SPRING} className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id={`${id}-title`} className="text-[14px] font-bold" style={{ color: TEXT }}>
          <a href={href} className="hover:underline">{title}</a>
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
