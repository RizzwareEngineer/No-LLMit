'use client';

import { useLayoutEffect, useRef } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from '@phosphor-icons/react';
import { NEXT_BUTTON, NEXT_STYLE } from '@/components/Section';
import { EASE } from '@/components/TablesOverview';

// Inside a table opened from the tables overview (lib/tableSwitches' ?tables=1): the way to each neighbour on the
// overview's grid as an arrow button, the Stats button's pill (one family: height, radius, border, shadow, font,
// weight), laid round the table as a compass (page.tsx places them). "All tables" and About are the same pill.

export type Dir = 'left' | 'right' | 'up' | 'down';
const ICON = { left: ArrowLeft, right: ArrowRight, up: ArrowUp, down: ArrowDown };
// The arrow is on the side it points to: "← 1/2 · 100 bb", "5/10 · 200 bb →", "↑ 1/2 · 100 bb", "25/50 · 500 bb ↓".
const LEADS = { left: true, up: true, right: false, down: false };
// The table moves are the quieter kind: the same pill, the arrow muted (Stats, the page's own way on, keeps it dark).
const QUIET = 'rgba(55, 53, 47, 0.6)';
export const PILL_GAP = 8, PILL_PAD = 20, PILL_ICON = 16;

// A pill's width for its label, in px (the label in the pill's font, as the browser measures it): text, gap, arrow,
// padding and border.
let ctx: CanvasRenderingContext2D | null = null;
export function pillWidth(label: string, font: string) {
  ctx ??= document.createElement('canvas').getContext('2d');
  if (!ctx) return label.length * 9 + 2 * PILL_PAD + PILL_ICON + PILL_GAP + 2;
  ctx.font = font;
  return Math.ceil(ctx.measureText(label).width + PILL_ICON + PILL_GAP + 2 * PILL_PAD + 2);
}

// Fades in once mounted (with the panels, as the zoom or the slide lands); page.tsx fades it out before the next one.
export function useFadeIn<T extends HTMLElement>(given?: React.RefObject<T | null>) {
  const own = useRef<T>(null), ref = given ?? own;
  useLayoutEffect(() => {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    ref.current?.animate([{ opacity: 0 }, { opacity: 1 }], { duration: reduced ? 0 : 220, easing: EASE, fill: 'backwards' });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- on mount
  return ref;
}

export function NavPill({ dir, label, at, vertical, still, onGo, onMeasure }: {
  dir: Dir; label: string; at: { left: number; top: number }; vertical: boolean; still: boolean; onGo: () => void;
  onMeasure?: (label: string, width: number) => void; // its width as drawn (its length on its side), for where it goes
}) {
  const ref = useFadeIn<HTMLButtonElement>(), Icon = ICON[dir];
  useLayoutEffect(() => {
    const e = ref.current;
    if (e && onMeasure) onMeasure(label, vertical ? e.offsetHeight : e.offsetWidth);
  });
  const icon = <Icon size={PILL_ICON} weight="bold" aria-hidden style={{ color: QUIET, flexShrink: 0 }} />;
  return (
    <button ref={ref} type="button" data-table-nav={dir} aria-label={`Go to table ${label.replace(' · ', ', ')}`} onClick={onGo}
      className={`absolute z-20 whitespace-nowrap tabular-nums outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[rgb(31,111,196)] ${NEXT_BUTTON} ${vertical ? '[writing-mode:vertical-rl]' : ''}`}
      style={{ ...NEXT_STYLE, ...at, ...(vertical ? { padding: '20px 8px' } : null), pointerEvents: still ? 'none' : undefined }}>
      {LEADS[dir] && icon}{label}{!LEADS[dir] && icon}
    </button>
  );
}
