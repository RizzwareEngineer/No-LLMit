'use client';

import { useLayoutEffect } from 'react';

// Draws a figure that changes on whole seconds (the shot clock, the next hand's countdown) straight to its DOM node, from
// its own timer, not through React: a render each second, synchronous so a slow phone's long tasks could not hold it
// back, re-rendered the whole table and threw away the stats' transition render each time; and a timer whose own
// synchronous render committed a waiting stream update outlived its effect (review 4, findings 3 to 5).
// `ms(now)` is the time left at `now` (null: nothing to count, draw gets null). draw gets the whole seconds left (rounded
// up, never below 0) on every commit, before its frame is painted, then on each whole-second edge while `running`, so it
// never shows a second the engine no longer has. The timer is cleared, and a live flag dropped, on cleanup, so a step can
// never schedule past its effect.
export function useSecondsDraw(ms: ((now: number) => number) | null, draw: (seconds: number | null) => void, running = true) {
  useLayoutEffect(() => {
    if (!ms) {
      draw(null);
      return;
    }
    let live = true;
    let t: ReturnType<typeof setTimeout> | undefined;
    const step = () => {
      if (!live) return;
      const left = ms(Date.now());
      draw(Math.max(0, Math.ceil(left / 1000)));
      if (running && left > 0) t = setTimeout(step, (left % 1000 || 1000) + 1);
    };
    step();
    return () => {
      live = false;
      clearTimeout(t);
    };
  });
}
