'use client'

import { useLayoutEffect, useRef, useState, type HTMLAttributes, type ReactNode } from 'react';

// Phone draft A (app/a): a desktop layout `w` px wide (the table; the stats overview) drawn as one picture at its box's
// width, at its own proportions.
// A transform, not CSS zoom: zoom shrinks each font size too, and an iPhone browser draws zoomed text no smaller than its
// minimum (owner's iPhone, 2026-11-22: 11px text at 0.4 drew twice its boxes, names cut to "L.", badges sliced). A
// transform draws the layout as laid out, smaller; text-size-adjust keeps a browser's text zoom off the picture.
// `contain`: no taller than its parent either (a box of fixed height, as the stats window's), centred across its width
// where the height is the limit (a phone held sideways).
export default function Fit({ w, contain = false, children, className = '', ...rest }: { w: number; contain?: boolean; children: ReactNode } & HTMLAttributes<HTMLDivElement>) {
  const box = useRef<HTMLDivElement>(null), inner = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState<{ z: number; h: number; x: number } | null>(null);
  useLayoutEffect(() => {
    const el = box.current, t = inner.current, room = contain ? el?.parentElement : null;
    if (!el || !t) return;
    const measure = () => {
      const h = t.offsetHeight, z = Math.min(el.clientWidth / w, room && h ? room.clientHeight / h : Infinity), x = (el.clientWidth - w * z) / 2;
      setFit(f => (f && f.z === z && f.h === h && f.x === x ? f : { z, h, x }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    ro.observe(t); // the layout's own height (a seat's row growing) sets the box's
    if (room) ro.observe(room);
    return () => ro.disconnect();
  }, [w, contain]);
  return (
    // Until measured, no height and nothing out of it (clipped, not hidden: what is inside can take focus at once, as the
    // stats overview's tiles do coming back from a card). A layout at its full height, even unseen, pushed the page past
    // its window for a frame (the overview remounting after Back), and the browser re-snapped the page to the table.
    <div ref={box} {...rest} className={`w-full ${className}`} style={fit ? { height: fit.h * fit.z } : { height: 0, overflow: 'hidden' }}>
      <div ref={inner} style={{ width: w, transform: fit ? `${fit.x ? `translateX(${fit.x}px) ` : ''}scale(${fit.z})` : undefined, transformOrigin: '0 0', WebkitTextSizeAdjust: '100%', textSizeAdjust: '100%' }}>{children}</div>
    </div>
  );
}
