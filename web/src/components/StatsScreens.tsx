'use client';

import { Suspense, lazy, memo, startTransition, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { StatsResponse } from '@/lib/stats';
import { PHONE } from '@/lib/layout';
import { isPaging } from '@/components/Section';
import { ABOUT_WINDOW, SCREENS, WINDOW } from '@/lib/statsScreens';

// Everything below the table screen (the stats and About, StatsSections) is loaded and mounted only once the page needs
// it (useStatsMount): the prerendered page and the hydration hold just its screens, empty, at their places and heights
// (StatsHold), so a phone's first load is the table's work alone (its code, its hydration, its first state). Then the
// stats mount in a transition, in the layout shown, over the same screens.
const StatsSections = lazy(() => import('@/components/StatsSections'));

const onPhoneChange = (cb: () => void) => { const m = matchMedia(PHONE); m.addEventListener('change', cb); return () => m.removeEventListener('change', cb); };
const usePhone = () => useSyncExternalStore(onPhoneChange, () => matchMedia(PHONE).matches, () => false);

export default memo(function StatsScreens(props: { stats: StatsResponse | null; error: string | null }) {
  const phone = usePhone();
  const hold = useRef<HTMLDivElement>(null);
  const on = useStatsMount(hold);
  const stand = <StatsHold ref={hold} phone={phone} />;
  return on ? <Suspense fallback={stand}><KeepScroll><StatsSections {...props} /></KeepScroll></Suspense> : stand;
});

// Where the page was scrolled to before the stats mounted. Their screens replace the hold's (new elements), and the
// browser re-snaps a page resting on a removed snap point (a reload below the table restores the scroll there before
// they mount): it went back to the top. So the page is put back where it was, before that frame is painted.
// Only a jump of more than half a window, and never while a paged scroll runs: a scroll the viewer is making moves less
// than that in a frame. lastY follows every scroll until the swap (a re-snap's own scroll event comes a frame later).
let lastY = 0;
if (typeof window !== 'undefined') window.addEventListener('scroll', () => { lastY = window.scrollY; }, { passive: true });
function KeepScroll({ children }: { children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const y = lastY;
    const keep = () => { if (!isPaging() && Math.abs(window.scrollY - y) > window.innerHeight / 2) window.scrollTo({ top: y, behavior: 'instant' }); };
    keep(); // reading scrollY lays the page out: a re-snap then has happened
    // And after the frame's layout, before its paint, should the re-snap come only then.
    const box = ref.current?.parentElement, ro = new ResizeObserver(() => { keep(); ro.disconnect(); });
    if (box) ro.observe(box);
    const stop = () => ro.disconnect();
    const t = setTimeout(stop, 500);
    return () => { clearTimeout(t); stop(); };
  }, []);
  return <><span ref={ref} hidden />{children}</>;
}

// When the stats mount: as their screens come within a quarter of a window of it (a scroll, a page key, the tab bar, a
// link to About; at once on a desktop, whose table screen is one window tall), or on the
// first gesture that could scroll there (a key, the wheel, a touch). Never in the hydration or the first state's render,
// which the table's first paint waits on, nor on a timer while the viewer watches the table (their mount is a long task
// on a slow phone).
function useStatsMount(hold: React.RefObject<HTMLDivElement | null>) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    if (on) return;
    let done = false;
    const go = () => { if (!done) { done = true; startTransition(() => setOn(true)); } };
    // The hold itself (the same element in both layouts: its screens change when a phone swaps the wide ones after hydrating).
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) go(); }, { rootMargin: '25% 0px' });
    if (hold.current) io.observe(hold.current);
    const gestures = ['keydown', 'wheel', 'touchstart'] as const;
    gestures.forEach(g => window.addEventListener(g, go, { passive: true, capture: true }));
    return () => {
      io.disconnect();
      gestures.forEach(g => window.removeEventListener(g, go, { capture: true }));
    };
  }, [on, hold]);
  return on;
}

// The stats' screens before they mount: the same snap points, ids and heights as StatsSections' (so paging, the tab bar
// and the snap points work at once, and nothing moves when they mount), empty.
function StatsHold({ phone, ref }: { phone: boolean; ref: React.Ref<HTMLDivElement> }) {
  if (phone) return (
    <div ref={ref} className="stats-room relative w-full">
      <section id="race" data-screen aria-label="Trends" className={WINDOW}><div id="stats" aria-hidden className="absolute top-0" /></section>
      <section id="stats-table" data-screen aria-label="Profiles" className={WINDOW} />
      <section id="pairwise" data-screen aria-label="Matchups" className={WINDOW} />
      <section id="about" data-screen data-end aria-label="About" className={ABOUT_WINDOW} />
    </div>
  );
  return (
    <div ref={ref} className="stats-room relative isolate w-full">
      {SCREENS.map(id => (
        <div key={id} id={id} data-screen data-end={id === 'about' || undefined} data-back={id === 'race' ? 'up' : id === 'pairwise' ? 'down' : undefined} aria-hidden className="h-svh snap-start snap-always" />
      ))}
    </div>
  );
}
