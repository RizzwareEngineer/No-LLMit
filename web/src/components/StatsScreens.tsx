'use client';

import { memo, startTransition, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { StatsResponse } from '@/lib/stats';
import { PHONE, isDraftA } from '@/lib/layout';
import { isPaging } from '@/components/Section';
import { ABOUT_PART, ABOUT_WINDOW, SCREENS, WINDOW, aboutLayout } from '@/lib/statsScreens';

// Everything below the table screen (the stats and About, StatsSections) is loaded and mounted only once the page needs
// it (useStatsMount): the prerendered page and the hydration hold just its screens, empty, at their places and heights
// (StatsHold), so a phone's first load is the table's work alone (its code, its hydration, its first state). Then the
// stats mount in a transition, in the layout shown, over the same screens.
// The chunk is loaded first and only then is the component put in state, in a transition: no React.lazy and no Suspense.
// A lazy that suspends commits a fallback and finishes on a retry lane, which never expires and which every
// default-lane update (each typed character of a reason, each stream message) restarts, so the stats stayed empty while
// a reason typed. A transition lane is not interrupted by those and expires after 5 s. Nothing renders synchronously each
// second (the shot clock and the countdown draw their seconds outside React, useSecondsDraw), which would throw away a
// transition's half-built render. And a chunk
// that fails to load (a deploy replaced it, the phone went offline) never reaches React: the stand-in stays and says so in
// one line (a chunk a deploy replaced does not come back, so it asks for a reload), and the next trigger, a click
// included, tries again (a blip recovers).
let StatsSections: typeof import('@/components/StatsSections').default | null = null; // once loaded
const loadStats = () => import('@/components/StatsSections').catch(() => import('@/components/StatsSections')).then(m => { StatsSections = m.default; });

const noSub = () => () => {};
const onPhoneChange = (cb: () => void) => { const m = matchMedia(PHONE); m.addEventListener('change', cb); return () => m.removeEventListener('change', cb); };
const usePhone = () => useSyncExternalStore(onPhoneChange, () => matchMedia(PHONE).matches, () => false);

export default memo(function StatsScreens(props: { stats: StatsResponse | null; error: string | null }) {
  const phone = usePhone();
  const hold = useRef<HTMLDivElement>(null);
  const [on, failed] = useStatsMount(hold);
  // One swap, from the stand-in to the stats (a screen reader on a stand-in's section loses it once, not twice).
  return on && StatsSections ? <KeepScroll><StatsSections {...props} /></KeepScroll> : <StatsHold ref={hold} phone={phone} failed={failed} />;
});

// Where the page was scrolled to before the stats mounted. Their screens replace the hold's (new elements), and the
// browser re-snaps a page resting on a removed snap point (a reload below the table restores the scroll there before
// they mount): it went back to the top. So the page is put back where it was, before that frame is painted.
// Only a jump of more than half a window, and never while a paged scroll runs: a scroll the viewer is making moves less
// than that in a frame. lastY follows every scroll until the swap (a re-snap's own scroll event comes a frame later).
// Seeded with where the page is when this module runs: a viewer may have scrolled, or the browser restored a scroll,
// before the JS ran, and no scroll event follows that.
let lastY = typeof window !== 'undefined' ? window.scrollY : 0;
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
// first gesture that could scroll there (a key, the wheel, a touch, a click: the Stats and About buttons scroll by script). Never in the hydration or the first state's render,
// which the table's first paint waits on, nor on a timer while the viewer watches the table (their mount is a long task
// on a slow phone).
function useStatsMount(hold: React.RefObject<HTMLDivElement | null>): [boolean, boolean] {
  const [on, setOn] = useState(false);
  const [failed, setFailed] = useState(false); // the load failed, both tries (loadStats)
  useEffect(() => {
    if (on) return;
    let done = false, live = true;
    const go = () => {
      if (done) return;
      done = true;
      lastY = window.scrollY;
      loadStats().then(() => { if (live) startTransition(() => setOn(true)); }, () => { done = false; if (live) setFailed(true); });
    };
    // The hold itself (the same element in both layouts: its screens change when a phone swaps the wide ones after hydrating).
    const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) go(); }, { rootMargin: '25% 0px' });
    if (hold.current) io.observe(hold.current);
    const gestures = ['keydown', 'wheel', 'touchstart', 'pointerdown'] as const;
    gestures.forEach(g => window.addEventListener(g, go, { passive: true, capture: true }));
    return () => {
      live = false;
      io.disconnect();
      gestures.forEach(g => window.removeEventListener(g, go, { capture: true }));
    };
  }, [on, hold]);
  return [on, failed];
}

// The stats' screens before they mount: the same snap points, ids and heights as StatsSections' (so paging, the tab bar
// and the snap points work at once, and nothing moves when they mount), empty.
function StatsHold({ phone, failed, ref }: { phone: boolean; failed: boolean; ref: React.Ref<HTMLDivElement> }) {
  const draftA = useSyncExternalStore(noSub, isDraftA, () => false);
  const split = useSyncExternalStore(noSub, () => aboutLayout() === 'split', () => false); // About as two windows
  // A failed load says so on every screen, one line in the middle (a reload fetches the page's current code).
  const note = failed ? <p role="status" className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-[13px] leading-5 whitespace-nowrap" style={{ color: 'rgb(55, 53, 47)' }}>Stats did not load. Reload the page.</p> : null;
  // Phone draft A: one stats window (the overview), then About.
  if (phone) return (
    <div ref={ref} className="stats-room relative w-full">
      {draftA ? <section id="stats" data-screen aria-label="Stats" className={WINDOW}>{note}</section> : <>
        <section id="race" data-screen aria-label="Trends" className={WINDOW}><div id="stats" aria-hidden className="absolute top-0" />{note}</section>
        <section id="stats-table" data-screen aria-label="Profiles" className={WINDOW}>{note}</section>
        <section id="pairwise" data-screen aria-label="Matchups" className={WINDOW}>{note}</section>
      </>}
      {split ? <>
        <section id="about" data-screen aria-label="About" className={ABOUT_PART}>{note}</section>
        <section id="about-ask" data-screen data-end aria-label="About, continued" className={ABOUT_PART}>{note}</section>
      </> : <section id="about" data-screen data-end aria-label="About" className={ABOUT_WINDOW}>{note}</section>}
    </div>
  );
  return (
    <div ref={ref} className="stats-room relative isolate w-full">
      {SCREENS.map(id => (
        <div key={id} id={id} data-screen data-end={id === 'about' || undefined} data-back={id === 'race' ? 'up' : id === 'pairwise' ? 'down' : undefined} aria-hidden={!failed || undefined} className="relative h-svh snap-start snap-always">{note}</div>
      ))}
    </div>
  );
}
