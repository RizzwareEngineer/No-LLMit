'use client';

import { useRef } from 'react';
import { motion, useInView } from 'motion/react';
import NumberFlow, { type Format } from '@number-flow/react';
import { TEXT } from '@/lib/stats';

// The scroll-snap screens in use right now: phones snap every section, wider screens snap the
// stats grid as one (the others compute scroll-snap-align: none).
const screens = () =>
  [...document.querySelectorAll<HTMLElement>('[data-screen]')].filter(el => !getComputedStyle(el).scrollSnapAlign.startsWith('none'));

// Scroll one screen down (1) or up (-1). Smooth through scroll-behavior in globals.css, which
// prefers-reduced-motion turns off; scroll-snap still lands it on the screen's top.
export function pageBy(dir: 1 | -1) {
  const y = window.scrollY;
  const tops = screens().map(el => el.getBoundingClientRect().top + y);
  const top = dir > 0 ? tops.find(t => t > y + 1) : tops.findLast(t => t < y - 1);
  if (top !== undefined) window.scrollTo({ top });
}

// A stats panel: an anchor, a small heading, and a card that fades and rises in the first time it
// scrolls into view. The card fills the room its screen gives it; its children never shrink, so a
// tall table scrolls the card instead of being squeezed into a scroller of its own.
// On phones each section is its own snap screen; pt-14 keeps the heading clear of the sticky bar.
export default function Section({
  id,
  title,
  aside,
  className = '',
  children,
}: {
  id: string;
  title: React.ReactNode;
  aside?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <motion.section
      id={id}
      aria-labelledby={`${id}-title`}
      data-screen
      className={`flex flex-col h-dvh snap-start snap-normal pt-14 pb-4 md:h-auto md:min-h-0 md:snap-align-none md:p-0 ${className}`}
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '0px 0px -80px 0px' }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id={`${id}-title`} className="text-[14px] font-bold" style={{ color: TEXT }}>
          <a href={`#${id}`} className="hover:underline">{title}</a>
        </h2>
        {aside}
      </div>
      <div
        className="panel-scroll flex-1 min-h-0 flex flex-col [&>*]:shrink-0 overflow-auto bg-white rounded p-3"
        style={{ boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.1) 0px 2px 4px' }}
      >
        {children}
      </div>
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
