'use client';

import { useEffect, useRef } from 'react';
import { ClockCounterClockwise, Pause, Play } from '@phosphor-icons/react';
import { BLUE, MUTED, TEXT } from '@/lib/stats';
import { SHADOW } from '@/components/ui';
import type { ReplayDraft } from '@/lib/replayDraft';
import { Timeline, pauseReplay, playReplay, resumeReplay, seekReplay, skipReplay, useReplayHand, useReplayHeld } from '@/lib/timeline';

// The replay drafts' controls (lib/replayDraft): replay is a mode of the whole Stats screen, on the one clock that Trends,
// Profiles and Matchups already share (lib/timeline). Live is the default; the viewer enters Replay and leaves it on purpose.
//  A: one bar at the Stats screen's head: "Live" with the red dot and a Replay pill; in Replay the same row is the transport
//     (play/pause, the scrubber over the hands, Hand N of M, Back to live).
//  B: a Live | Replay switch at the head; in Replay the transport docks at the screen's foot (ReplayStrip; a phone keeps it
//     in the head's one row), and the three tiles take a blue outline (globals.css, [data-replay-mode]).
// Every tile carries the same "Replay · hand N" tag (ReplayTag) while replaying. Space toggles play inside the transport,
// Escape goes back to live. Under reduced motion, Replay opens held at the first hand: nothing moves until Play.

const LIVE_RED = 'rgb(220, 38, 38)'; // the page's Live dot (StickyBar)
export const REPLAY_TINT = 'rgba(31, 111, 196, 0.1)';
const ROW = 'flex items-center gap-3 h-8 min-w-0 text-[14px] whitespace-nowrap tabular-nums';
// A pill as the page's other small buttons in a header (white, hairline ring), 28px tall in the 32px row.
const PILL = 'flex shrink-0 items-center gap-1.5 h-7 rounded-full px-3 font-medium bg-white hover:bg-[rgba(55,53,47,0.04)]';
const PILL_STYLE = { color: TEXT, boxShadow: 'rgba(15, 15, 15, 0.12) 0px 0px 0px 1px, rgba(15, 15, 15, 0.06) 0px 1px 2px' };
const fmt = (n: number) => n.toLocaleString('en-US');
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

export const enterReplay = () => { playReplay(); if (reduced()) pauseReplay(); };

function Dot({ on }: { on: boolean }) {
  return <span aria-hidden className="inline-block size-2 shrink-0 rounded-full" style={on ? { background: LIVE_RED } : { boxShadow: `inset 0 0 0 1.5px ${MUTED}` }} />;
}

// Escape goes back to live; Space toggles play (except on a button of its own: Space presses it).
function useKeys(replaying: boolean, held: boolean) {
  return (e: React.KeyboardEvent) => {
    if (!replaying) return;
    const t = e.target as Element;
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); skipReplay(); }
    else if (e.key === ' ' && !t.closest('button:not([data-replay-play])')) { e.preventDefault(); e.stopPropagation(); if (held) resumeReplay(); else pauseReplay(); }
  };
}

// After Back to live (or the replay ending) with focus inside the bar, focus goes to what enters replay again;
function useFocusBack(replaying: boolean) {
  const bar = useRef<HTMLDivElement>(null);
  const was = useRef(replaying);
  useEffect(() => {
    const el = bar.current, r = el?.getBoundingClientRect();
    const seen = !!el && !!r && r.width > 0 && r.bottom > 0 && r.top < innerHeight && el.checkVisibility({ opacityProperty: true });
    const inside = !!el && (el.contains(document.activeElement) || (document.activeElement === document.body && seen));
    // ...and entering replay from the bar (A's Replay pill goes), to its play button, so Space plays and pauses at once.
    if (inside && was.current !== replaying) bar.current!.querySelector<HTMLElement>(replaying ? '[data-replay-play]' : '[data-stats-replay]')?.focus({ preventScroll: true });
    was.current = replaying;
  }, [replaying]);
  return bar;
}

function PlayButton({ held }: { held: boolean }) {
  return (
    <button
      type="button"
      data-replay-play
      aria-label={held ? 'Play' : 'Pause'}
      onClick={() => (held ? resumeReplay() : pauseReplay())}
      className="flex size-7 shrink-0 items-center justify-center rounded-full text-white hover:opacity-90"
      style={{ background: BLUE }}
    >
      {held ? <Play size={14} weight="fill" aria-hidden /> : <Pause size={14} weight="fill" aria-hidden />}
    </button>
  );
}

function Scrubber({ hand, total }: { hand: number; total: number }) {
  return (
    <input
      type="range"
      data-replay-scrubber
      aria-label="Replay hand"
      aria-valuetext={`Hand ${fmt(hand)} of ${fmt(total)}`}
      min={0}
      max={total}
      step={1}
      value={hand}
      onChange={e => seekReplay(+e.target.value / total)}
      className="replay-scrubber w-0 min-w-0 flex-1"
      style={{ '--at': `${(hand / Math.max(1, total)) * 100}%` } as React.CSSProperties}
    />
  );
}

// "Hand N of M" (a phone: "N / M"), right-aligned in the box "Hand M of M" takes, so the row never shifts as N grows a digit.
function Count({ hand, total, short = false }: { hand: number; total: number; short?: boolean }) {
  const text = (n: number) => <>{!short && 'Hand '}<b style={{ color: TEXT }}>{fmt(n)}</b>{short ? '/' : ' of '}{fmt(total)}</>;
  return (
    <span data-replay-count className="grid shrink-0 text-right" style={{ color: MUTED }}>
      <span aria-hidden className="invisible col-start-1 row-start-1">{text(total)}</span>
      <span className="col-start-1 row-start-1">{text(hand)}</span>
    </span>
  );
}

// The control at the Stats screen's head, one row. `phone`: draft B keeps its transport in this row too.
export function StatsReplayBar({ draft, tl, phone = false }: { draft: Exclude<ReplayDraft, null>; tl: Timeline | null; phone?: boolean }) {
  const hand = useReplayHand(tl);
  const held = useReplayHeld();
  const replaying = hand !== null;
  const total = tl?.hands ?? 0;
  const bar = useFocusBack(replaying);
  const keys = useKeys(replaying, held);
  if (draft === 'a') return (
    <div ref={bar} data-stats-replay-bar role="group" aria-label="Stats: live or replay" onKeyDown={keys} className={`${ROW} justify-between`}>
      {!replaying ? <>
        <span className="flex min-w-0 items-center gap-2" style={{ color: TEXT }} role="status">
          <Dot on />
          <span className="font-semibold">Live</span>
          <span className="truncate" style={{ color: MUTED }}>{tl ? (phone ? `${fmt(total)} hands` : `All ${fmt(total)} hands, as they are played`) : ''}</span>
        </span>
        <button type="button" data-stats-replay disabled={!tl} onClick={enterReplay} className={`${PILL} disabled:opacity-40`} style={PILL_STYLE}>
          <ClockCounterClockwise size={16} weight="bold" aria-hidden /> Replay
        </button>
      </> : <>
        <PlayButton held={held} />
        {!phone && <span className="shrink-0 font-semibold" style={{ color: BLUE }}>Replay</span>}
        <Scrubber hand={hand} total={total} />
        <Count hand={hand} total={total} short={phone} />
        <button type="button" data-stats-live aria-label={phone ? 'Back to live' : undefined} onClick={skipReplay} className={PILL} style={PILL_STYLE}>
          <Dot on={false} /> {phone ? 'Live' : 'Back to live'}
        </button>
      </>}
    </div>
  );
  // B: the switch; the transport beside it on a phone, at the screen's foot (ReplayStrip) wider.
  const seg = (on: boolean) => ({ background: on ? 'white' : undefined, color: on ? TEXT : MUTED, boxShadow: on ? SHADOW : undefined });
  return (
    <div ref={bar} data-stats-replay-bar role="group" aria-label="Stats: live or replay" onKeyDown={keys} className={`${ROW} ${phone ? '!gap-2' : 'justify-between'}`}>
      <div data-seg className="flex shrink-0 rounded p-0.5" style={{ background: 'rgba(55, 53, 47, 0.06)' }}>
        <button type="button" data-stats-live aria-pressed={!replaying} onClick={skipReplay} className={`flex items-center gap-1.5 rounded ${phone ? 'px-2' : 'px-3'} py-0.5 font-medium`} style={seg(!replaying)}>
          <Dot on={!replaying} /> Live
        </button>
        <button type="button" data-stats-replay aria-pressed={replaying} disabled={!tl} onClick={() => !replaying && enterReplay()} className={`flex items-center gap-1.5 rounded ${phone ? 'px-2' : 'px-3'} py-0.5 font-medium disabled:opacity-40`} style={replaying ? { ...seg(true), color: BLUE } : seg(false)}>
          {!(phone && replaying) && <ClockCounterClockwise size={15} weight="bold" aria-hidden />} Replay
        </button>
      </div>
      {phone ? (replaying ? <>
        <PlayButton held={held} />
        <Scrubber hand={hand} total={total} />
        <Count hand={hand} total={total} short />
      </> : <span className="truncate" style={{ color: MUTED }}>{tl ? `All ${fmt(total)} hands` : ''}</span>)
        : <span className="truncate" style={{ color: MUTED }}>{replaying ? 'All three stats replay together · timeline at the foot' : tl ? `All ${fmt(total)} hands, as they are played` : ''}</span>}
    </div>
  );
}

// Draft B's transport, docked at the Stats screen's foot (the band the overview's "About ↓" sits in) while replaying.
export function ReplayStrip({ tl }: { tl: Timeline | null }) {
  const hand = useReplayHand(tl);
  const held = useReplayHeld();
  const replaying = hand !== null;
  const keys = useKeys(replaying, held);
  if (!replaying) return null;
  const total = tl!.hands;
  return (
    <div data-replay-strip role="group" aria-label="Replay" onKeyDown={keys} className={`${ROW} w-full rounded-full bg-white pl-1 pr-4`} style={{ boxShadow: `0 0 0 1.5px ${BLUE}, rgba(15, 15, 15, 0.06) 0px 4px 16px` }}>
      <PlayButton held={held} />
      <Scrubber hand={hand} total={total} />
      <Count hand={hand} total={total} />
    </div>
  );
}

// The same small tag on every tile and card while replaying: "Replay · hand N". Out of the header's flow (beside the
// title), so nothing in the tile moves when it comes or goes.
export function ReplayTag({ tl }: { tl: Timeline | null }) {
  const hand = useReplayHand(tl);
  if (hand === null) return null;
  return (
    <span data-replay-tag className="absolute left-full top-1/2 ml-2 -translate-y-1/2 whitespace-nowrap rounded px-1.5 text-[12px] leading-5 font-semibold tabular-nums" style={{ color: BLUE, background: REPLAY_TINT }}>
      Replay · hand {fmt(hand)}
    </span>
  );
}
