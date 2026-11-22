'use client'

// Phone draft A (app/a): under the table and its caption, the rest of the first screen holds one live thing, sized to the
// space left (owner, 2026-11-22: "fill that space with either the P&L, or we just fill it with trends. If they click on
// it, then they should get the expanded graph"). ?fill=graph (default: the Trends lines alone, no controls), pnl (Profits
// & Losses, its rows re-sorting without a slide) or both (the graph, P&L under it). A tap opens the full Trends window.
import { useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import CumulativeChart from '@/components/CumulativeChart';
import WinningsPanel from '@/components/WinningsPanel';
import { pageTo } from '@/components/Section';
import { seatedModels, type StatsResponse } from '@/lib/stats';
import { useTimeline } from '@/lib/timeline';
import type { PlayerState } from '@/lib/api';

type Fill = 'graph' | 'pnl' | 'both';
const noSub = () => () => {};
const useFill = () => useSyncExternalStore(noSub, (): Fill => { const f = new URLSearchParams(location.search).get('fill'); return f === 'pnl' || f === 'both' ? f : 'graph'; }, (): Fill => 'graph');
const RING = { boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.1) 0px 2px 4px' };

export default function LandingFill({ stats, players }: { stats: StatsResponse | null; players: PlayerState[] }) {
  const fill = useFill();
  const box = useRef<HTMLButtonElement>(null);
  const [h, setH] = useState(0);
  // The space the first screen has left under the caption, above the tab bar.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const size = () => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      const bar = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--bar-h')) || 0;
      setH(Math.max(180, Math.round(window.innerHeight - top - bar - 12)));
    };
    size();
    const ro = new ResizeObserver(size);
    ro.observe(document.body);
    return () => ro.disconnect();
  }, []);
  const models = useMemo(() => stats?.models ?? [], [stats]);
  const field = useMemo(() => seatedModels(models, stats?.seated), [models, stats]);
  const hands = stats?.scope.hands;
  const fetched = useTimeline(hands === undefined ? undefined : Math.floor(hands / 25));
  const tl = useMemo(() => (fetched && hands !== undefined && hands > fetched.hands ? { ...fetched, hands } : fetched), [fetched, hands]);
  return (
    <button ref={box} type="button" data-landing-fill onClick={() => pageTo('race')} aria-label="Open Trends"
      className="mt-2 w-full text-left flex flex-col gap-2" style={{ height: h || undefined, visibility: h ? undefined : 'hidden' }}>
      {fill !== 'pnl' && (
        <div className="relative flex-1 min-h-0 w-full flex flex-col bg-white rounded overflow-hidden" style={RING}>
          {stats && tl ? <CumulativeChart race mini bigBlind={stats.scope.big_blind ?? 10} models={field} everyone={models} timeline={tl} /> : null}
        </div>
      )}
      {fill !== 'graph' && (
        <div className={`${fill === 'both' ? 'h-[46%]' : 'flex-1'} min-h-0 w-full flex flex-col`}>
          <WinningsPanel players={players} still />
        </div>
      )}
    </button>
  );
}
