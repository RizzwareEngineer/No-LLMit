'use client';

import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { MUTED, TEXT } from '@/lib/stats';
import { Caveats, Eyebrow, Footer, Hours, How, Intro, LABEL, Next, RULE, Race, Support, Thesis } from '@/components/about/content';

// About's layout, a "spec sheet": the thesis, then the topics on a dial, each with its name in a gutter on the left (Arena's
// labelled rules); the ask and the race in a column of their own on the right. On a phone: the thesis, the ask, the
// race, then the dial. Laid out by its own width (container queries).

// `soft`: the topic's words when the row is behind (its blur and fade); the label beside them is never blurred.
function Row({ as: H, title, soft, children }: { as: 'h2' | 'h3'; title: string; soft: React.CSSProperties; children: React.ReactNode }) {
  return (
    <section className="grid gap-x-6 gap-y-2 @2xl:grid-cols-[112px_minmax(0,1fr)] py-3.5 [@media(min-height:960px)]:py-5 border-t" style={{ borderColor: RULE }}>
      <H className={`${LABEL} @2xl:pt-px`} style={{ color: MUTED }}>{title}</H>
      <div data-dial-body className="min-w-0 motion-safe:transition-[filter,opacity] motion-safe:duration-[400ms]" style={{ ...soft, transitionTimingFunction: EASE }}>{children}</div>
    </section>
  );
}

const TOPICS = [['How it works', How], ['Caveats', Caveats], ['Hours', Hours], ['What’s next', Next]] as const;
// How much of the row above the focused one shows; past the tallest row, twice that shows below.
const PEEK = 40;
// The rows behind the focused one, by distance: further back, smaller and fainter (`opacity`, the whole row: its label
// only fades), the topic's words a little blurred and fainter still (`soft`: 0.45 and 0.25 in all), so the row next to
// the focused one can still be read and every label stays sharp.
const BACK = [
  { transform: 'none', opacity: 1, soft: { filter: 'none', opacity: 1 } },
  { transform: 'scale(0.96)', opacity: 0.7, soft: { filter: 'blur(1px)', opacity: 0.65 } },
  { transform: 'scale(0.92)', opacity: 0.5, soft: { filter: 'blur(1.5px)', opacity: 0.5 } },
];
const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

// The topics as a dial, like a watch's list: one row in focus, sharp and in front; the others blurred behind it. With the
// pointer on the dial, one wheel gesture or swipe turns it one row (past either end, and off the dial, the page has the
// wheel); a click on a blurred row, focus inside it, or ↑ ↓ brings that row forward. Every row stays in the page for
// screen readers. Under reduced motion it turns without animating.
function Dial({ as }: { as: 'h2' | 'h3' }) {
  const [at, setAt] = useState(0);
  const atRef = useRef(0);
  const turn = (i: number) => { atRef.current = i; setAt(i); };
  const box = useRef<HTMLDivElement>(null), list = useRef<HTMLDivElement>(null);
  // The rows' heights, measured on the client; until then only the first row shows (the window's height is CSS's own).
  const [hs, setHs] = useState<number[] | null>(null);
  const [ready, setReady] = useState(false);
  useLayoutEffect(() => {
    const rows = [...list.current!.children] as HTMLElement[];
    const measure = () => setHs(rows.map(r => r.offsetHeight));
    measure();
    const ro = new ResizeObserver(measure);
    rows.forEach(r => ro.observe(r));
    // Rows slide only after they first took their places (they fade in there); focus moving into a row jumps it forward,
    // so the focused control is at once where it stays (as the browser's own focus scroll is instant).
    const f = requestAnimationFrame(() => requestAnimationFrame(() => setReady(true)));
    return () => { ro.disconnect(); cancelAnimationFrame(f); };
  }, []);

  useEffect(() => {
    const el = box.current!;
    // One gesture turns one row: events in its direction keep the lock alive, so a flick's momentum never turns twice.
    let lockUntil = 0, lockDir = 0, elsewhereUntil = 0;
    const off = (e: Event) => !(e.target instanceof Element) || !!e.target.closest('dialog');
    const away = (e: WheelEvent) => { if (!el.contains(e.target as Node)) elsewhereUntil = e.timeStamp + 250; };
    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || off(e) || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      const now = e.timeStamp, dir = e.deltaY > 0 ? 1 : -1;
      // A gesture that began off the dial (the flick that paged here), or a wheel the pointer is not over, stays the page's.
      if (now < elsewhereUntil || !el.matches(':hover')) { elsewhereUntil = now + 250; return; }
      if (now < lockUntil && (dir === lockDir || Math.abs(e.deltaY) < 10)) {
        e.preventDefault(); // the page leaves a prevented wheel alone
        lockUntil = Math.max(lockUntil, now + 200);
        return;
      }
      const next = atRef.current + dir;
      if (next < 0 || next >= TOPICS.length) return;
      e.preventDefault();
      if (Math.abs(e.deltaY) < 4) return;
      lockUntil = now + 700; lockDir = dir;
      turn(next);
    };
    // A swipe decides on its first move: along the dial, it turns it (once); otherwise, or past an end, the page scrolls.
    let start: { x: number; y: number } | null = null, mine: boolean | null = null;
    const onStart = (e: TouchEvent) => { start = { x: e.touches[0].clientX, y: e.touches[0].clientY }; mine = null; };
    const onMove = (e: TouchEvent) => {
      if (mine) e.preventDefault();
      if (mine !== null || !start || off(e)) return;
      const dx = e.touches[0].clientX - start.x, dy = e.touches[0].clientY - start.y;
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 8) return;
      const next = atRef.current + (dy < 0 ? 1 : -1);
      mine = Math.abs(dy) > Math.abs(dx) && next >= 0 && next < TOPICS.length;
      if (mine) { e.preventDefault(); turn(next); }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('wheel', away, { passive: true });
    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    return () => {
      el.removeEventListener('wheel', onWheel);
      window.removeEventListener('wheel', away);
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
    };
  }, []);

  const onKey = (e: React.KeyboardEvent) => {
    const dir = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0, next = at + dir;
    if (!dir || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || next < 0 || next >= TOPICS.length) return;
    if ((e.target as Element).closest('input, textarea, select, dialog')) return;
    e.preventDefault(); // the page leaves a prevented key alone
    turn(next);
  };

  // The visible window: the tallest row with a peek above and two below (the rows share one grid cell, so its height
  // is CSS's before any measuring); the rows slide so the focused one sits a peek from the top, held at either end so no
  // empty band shows. The edge that hides rows fades out.
  const tops = hs ? hs.map((_, i) => hs.slice(0, i).reduce((x, h) => x + h, 0)) : null;
  const total = hs ? hs.reduce((x, h) => x + h, 0) : 0, H = hs ? Math.max(...hs) + 3 * PEEK : 0;
  const y = tops ? Math.min(Math.max(tops[at] - PEEK, 0), Math.max(total - H, 0)) : 0;
  const fadeTop = y > 0 ? PEEK : 0, fadeBottom = !tops || y < total - H - 1 ? PEEK : 0;
  const mask = `linear-gradient(to bottom, transparent, #000 ${fadeTop}px, #000 calc(100% - ${fadeBottom}px), transparent)`;
  // Whether the row under a press was in focus before it: a click on a blurred row only brings it forward.
  const wasAt = useRef<boolean | null>(null);
  return (
    // The focus ring is on this outer box, drawn inside its edge: the inner box is masked and clipped (it would fade the
    // ring), and About's screen clips what is outside the dial.
    <div
      ref={box}
      data-dial
      role="group"
      aria-label="About, one topic at a time (↑ ↓ to turn)"
      tabIndex={0}
      onKeyDown={onKey}
      className="order-3 @4xl:order-none border-b outline-none focus-visible:[outline:2px_solid_rgb(35,131,226)] focus-visible:[outline-offset:-2px] rounded-sm"
      style={{ borderColor: RULE }}
    >
      <div className="overflow-clip" style={{ paddingBottom: 3 * PEEK, maskImage: mask, WebkitMaskImage: mask }}>
        <div ref={list} className="grid items-start [&>*]:[grid-area:1/1]">
          {TOPICS.map(([title, Body], i) => {
            const d = Math.min(Math.abs(i - at), 2), back = BACK[d];
            const shift = tops ? tops[i] - y : 0;
            return (
              <div
                key={title}
                data-dial-row={title}
                aria-current={i === at || undefined}
                onPointerDownCapture={() => { wasAt.current = i === at; }}
                onClickCapture={e => {
                  if ((e.target as Element).closest('dialog')) return;
                  if (wasAt.current === false) { e.preventDefault(); e.stopPropagation(); turn(i); }
                  wasAt.current = null;
                }}
                onFocusCapture={() => { if (i !== atRef.current) { setReady(false); turn(i); requestAnimationFrame(() => requestAnimationFrame(() => setReady(true))); } }}
                className={`${ready ? 'motion-safe:transition-[transform,opacity]' : 'motion-safe:transition-opacity'} motion-safe:duration-[400ms] ${d ? 'cursor-pointer select-none' : ''}`}
                style={{
                  transform: `translateY(${shift}px)${back.transform === 'none' ? '' : ` ${back.transform}`}`,
                  opacity: tops || !i ? back.opacity : 0,
                  transitionTimingFunction: EASE,
                }}
              >
                <Row as={as} title={title} soft={back.soft}><Body /></Row>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// The About content: the /about page, and the home page's last screen (where the page's own h1 is the table's title, so
// About's first heading is an h2). Its parent sets the width (the stats overview's block on the home page). Memoized: the
// stats re-render as each hand lands and as screens change; only its Race reads them, through PageStats (about/content).
export default memo(function About({ heading = 'h1' }: { heading?: 'h1' | 'h2' }) {
  const Sub = heading === 'h1' ? 'h2' : 'h3';
  return (
    <article data-about className="@container flex flex-col gap-6 text-[16px] leading-normal" style={{ color: TEXT }}>
      <div className="flex flex-col gap-6 @4xl:grid @4xl:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] @4xl:gap-x-14">
        {/* Each column's parts join one stack on a phone (display: contents), in reading order there. */}
        <div className="contents @4xl:flex @4xl:flex-col @4xl:min-w-0">
          <header className="flex flex-col gap-3 @4xl:pb-6">
            <Eyebrow />
            <Thesis as={heading} />
            <Intro />
          </header>
          <Dial as={Sub} />
        </div>
        <div className="contents @4xl:flex @4xl:flex-col @4xl:gap-8 @4xl:min-w-0">
          <Support as={Sub} className="order-1 @4xl:order-none" />
          {/* The figure's height: the drawing as before plus its caption (59px: 10px gap, 21px label, 4px gap, 24px leader line). */}
          <Race className="order-2 @4xl:order-none @4xl:flex-1" art="h-[calc(clamp(200px,40cqw,300px)_+_59px)] @4xl:h-auto @4xl:min-h-[259px]" />
        </div>
      </div>
      <Footer />
    </article>
  );
});
