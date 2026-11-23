'use client'

// Phone draft A (app/a): under the table and its caption, the rest of the first screen above the tab bar holds one
// thing (owner, 2026-11-23: "too many components ... both shouldn't be on the screen"): Trends' lines (default) or, at
// ?fill=pnl, this session's Profits & Losses. Exactly that space, never under the tab bar (on a real phone, whose browser
// bars take about a fifth of the screen, 250 to 350px). A tap anywhere on it opens Trends (owner, 2026-11-22: "If they
// click on it, then they should get the expanded graph").
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import LLMLogo, { modelColor } from '@/components/LLMLogo';
import FitName from '@/components/FitName';
import { LandingChart, Tile } from '@/components/PhoneTiles';
import { MUTED, seatedModels, type StatsResponse } from '@/lib/stats';
import { replayStarted, skipReplay } from '@/lib/timeline';
import { formatAmount, useBigBlind } from '@/lib/amounts';
import type { PlayerState } from '@/lib/api';

type Fill = 'trends' | 'pnl';
const noSub = () => () => {};
const useFill = () => useSyncExternalStore(noSub, (): Fill => (new URLSearchParams(location.search).get('fill') === 'pnl' ? 'pnl' : 'trends'), (): Fill => 'trends');
// Under this the fill is nothing: a chart a smear under its title; P&L's rows under 18px.
const LEAST = { trends: 110, pnl: 24 + 28 + 18 * 9 };

export default function LandingFill({ stats, players }: { stats: StatsResponse | null; players: PlayerState[] }) {
  const fill = useFill();
  const bb = useBigBlind();
  const box = useRef<HTMLDivElement>(null);
  // Where the fill starts on the page, and the height that leaves it (100svh, steady while iOS's address bar hides and
  // shows, less --bar-h, which it inherits from the page: the tab bar, and the connection bar while that shows).
  const [top, setTop] = useState<number | null>(null);
  const [h, setH] = useState(0);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const at = () => {
      setTop(Math.round(el.getBoundingClientRect().top + window.scrollY));
      setH(el.clientHeight);
    };
    at();
    // The table or the caption above changing height moves the fill; its own height follows from that.
    const ro = new ResizeObserver(at);
    ro.observe(document.body);
    ro.observe(el);
    if (el.parentElement) ro.observe(el.parentElement);
    return () => ro.disconnect();
  }, []);
  // The first screen shows the lines at their end, so Trends opens on those (owner: a tap gives "the expanded graph"), not
  // on a replay from the first hand; its Replay button still plays it.
  useEffect(() => { if (!replayStarted()) skipReplay(); }, []);
  const field = useMemo(() => seatedModels(stats?.models ?? [], stats?.seated), [stats]);
  return (
    <div ref={box} data-landing-fill={fill} className="relative w-full flex flex-col"
      style={top === null ? { visibility: 'hidden' } : { height: `max(0px, calc(100svh - ${top}px - var(--bar-h, 0px) - 12px))` }}>
      {h >= LEAST[fill] && (fill === 'pnl'
        ? <Tile part="race" title="Profits & Losses" note={`this session${bb ? ' · BB' : ''}`} label="Open Trends" className="flex-1"><Pnl players={players} /></Tile>
        : <Tile part="race" title="Trends" note="bb/100" label="Open Trends" className="flex-1"><LandingChart models={field} /></Tile>)}
    </div>
  );
}

// This session's Profits & Losses (WinningsPanel's figures), ranked, each row with its Trends line's colour; a new rank
// moves a row at once (the panel's sliding rows "jiggle", owner 2026-11-22). The rows share the height they are given.
function Pnl({ players }: { players: PlayerState[] }) {
  const bb = useBigBlind();
  const ranked = [...players].sort((a, b) => (b.winnings || 0) - (a.winnings || 0));
  return (
    <ol className="absolute inset-0 grid" style={{ gridTemplateRows: `repeat(${ranked.length || 1}, minmax(0, 1fr))` }}>
      {ranked.map(p => {
        const w = p.winnings || 0;
        return (
          <li key={p.id} className="flex items-center gap-2 min-w-0">
            <span aria-hidden className="w-[3px] h-4 rounded-full shrink-0" style={{ background: modelColor(p.name) }} />
            <LLMLogo model={p.name} size={16} />
            <div className="flex-1 min-w-0"><FitName name={p.name} className="text-[13px] font-medium" style={{ color: 'rgb(55, 53, 47)' }} /></div>
            <span data-chips={Math.abs(w)} className="text-[13px] font-bold tabular-nums shrink-0" style={{ color: w > 0 ? 'rgb(15, 123, 108)' : w < 0 ? 'rgb(200, 50, 50)' : MUTED }}>
              {w > 0 ? '+' : w < 0 ? '−' : ''}{formatAmount(Math.abs(w), bb, false)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
