'use client';

import { useRef } from 'react';
import { motion, useInView } from 'motion/react';
import NumberFlow, { type Format } from '@number-flow/react';
import { TEXT } from '@/lib/stats';

// A page section under the live table: an anchor, a heading, and a card that fades and rises in
// the first time it scrolls into view. minHeight reserves room while its data loads.
export default function Section({
  id,
  title,
  aside,
  minHeight,
  children,
}: {
  id: string;
  title: React.ReactNode;
  aside?: React.ReactNode;
  minHeight?: number;
  children: React.ReactNode;
}) {
  return (
    <motion.section
      id={id}
      aria-labelledby={`${id}-title`}
      className="scroll-mt-14 mt-10"
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '0px 0px -80px 0px' }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id={`${id}-title`} className="text-[18px] font-bold" style={{ color: TEXT }}>
          <a href={`#${id}`} className="hover:underline">{title}</a>
        </h2>
        {aside}
      </div>
      <div
        className="bg-white rounded p-3"
        style={{ minHeight, boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.1) 0px 2px 4px' }}
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
