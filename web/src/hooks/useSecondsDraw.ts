'use client';

import { useLayoutEffect } from 'react';

// Each edge's step is posted at user-blocking priority (scheduler.postTask, where the browser has it; a setTimeout
// elsewhere), and for the last FRAMES_MS before the edge it is also checked on every animation frame. A plain timer due
// inside a long task (the stats' commit after a load, at 4x CPU) waited behind the frame that follows a long task and
// React's next posted tasks, so frames were painted with a second the engine no longer had (clock-after-load); the
// frame's own callback draws the new second before that frame is painted.
const FRAMES_MS = 300;
type PostTask = (cb: () => void, o: { priority: 'user-blocking'; delay: number; signal: AbortSignal }) => Promise<unknown>;
const postTask = (): PostTask | null => {
  const s = (globalThis as { scheduler?: { postTask?: PostTask } }).scheduler;
  return typeof s?.postTask === 'function' && typeof AbortController === 'function' ? s.postTask.bind(s) : null;
};
// Runs `cb` after `delay` ms, as early as the page's other work allows; returns its cancel.
function atEdge(cb: () => void, delay: number): () => void {
  const post = postTask();
  if (post) {
    const c = new AbortController();
    post(cb, { priority: 'user-blocking', delay, signal: c.signal }).catch(() => {}); // aborted: nothing to run
    return () => c.abort();
  }
  const t = setTimeout(cb, delay);
  return () => clearTimeout(t);
}
// Runs `cb` once, at `delay` ms from now or at the first animation frame past it, whichever comes first; returns its cancel.
function atEdgeOrFrame(cb: () => void, delay: number): () => void {
  const due = Date.now() + delay;
  let done = false, raf = 0;
  const once = () => { if (!done) { done = true; stop(); cb(); } };
  const frame = () => { raf = 0; if (Date.now() >= due) once(); else raf = requestAnimationFrame(frame); };
  const edge = atEdge(once, delay);
  const arm = atEdge(() => { if (!done && !raf) raf = requestAnimationFrame(frame); }, Math.max(0, delay - FRAMES_MS));
  const stop = () => { edge(); arm(); if (raf) cancelAnimationFrame(raf); raf = 0; };
  return () => { done = true; stop(); };
}

// Draws a figure that changes on whole seconds (the shot clock, the next hand's countdown) straight to its DOM node, from
// its own timer, not through React: a render each second, synchronous so a slow phone's long tasks could not hold it
// back, re-rendered the whole table and threw away the stats' transition render each time; and a timer whose own
// synchronous render committed a waiting stream update outlived its effect (review 4, findings 3 to 5).
// `ms(now)` is the time left at `now` (null: nothing to count, draw gets null). draw gets the whole seconds left (rounded
// up, never below 0) on every commit, before its frame is painted, then on each whole-second edge while `running`, so it
// never shows a second the engine no longer has. The timer is cleared, and a live flag dropped, on cleanup, so a step can
// never schedule past its effect. `ms` and `running` are read at each step: callers read the clock as it arrived
// (lib/stream's arrivedClock), not as last committed, so a move that waits behind a transition render still stops the
// count at its second edge, and nothing is drawn that the engine never had.
export function useSecondsDraw(ms: ((now: number) => number) | null, draw: (seconds: number | null) => void, running: boolean | (() => boolean) = true) {
  useLayoutEffect(() => {
    if (!ms) {
      draw(null);
      return;
    }
    let live = true;
    let cancel: (() => void) | undefined;
    const step = () => {
      if (!live) return;
      const left = ms(Date.now());
      draw(Math.max(0, Math.ceil(left / 1000)));
      if ((typeof running === 'function' ? running() : running) && left > 0) cancel = atEdgeOrFrame(step, (left % 1000 || 1000) + 1);
    };
    step();
    return () => {
      live = false;
      cancel?.();
    };
  });
}
