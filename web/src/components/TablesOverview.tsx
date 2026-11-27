'use client';

import { useLayoutEffect, useRef, useState } from 'react';
import PokerTable from '@/components/PokerTable';
import Fit from '@/components/Fit';
import FitName from '@/components/FitName';
import LLMLogo from '@/components/LLMLogo';
import { TableBigBlind, formatAmount, useBigBlind } from '@/lib/amounts';
import { MUTED, TEXT } from '@/lib/stats';
import type { TableView } from '@/lib/stream';

// The tables overview (lib/tableSwitches' ?tables=1): every table at once, each a small live copy of the desktop table
// with its profit and loss beside it, and the profit and loss across all tables. A click zooms into one (page.tsx).

export type KeyedTable = TableView & { key: string };

// The desktop table's box in layout px: 1000 across, four rows of 128 and its frame (PokerTable).
const TABLE_W = 1000, TABLE_H = 514;
const GAP = 16, LABEL_H = 22, PNL_W = 172, ALL_W = 204, ROW_H = 17, PNL_HEAD = 20;
const CARD = { boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.1) 0px 2px 4px' };
// The stats tile-to-card glide's curve (Section's glideEase), shorter: a table is one picture, not a card's content.
export const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
export const ZOOM_MS = 360;

const stakesOf = (t: TableView) => t.gameState?.stakes ?? { smallBlind: 0, bigBlind: 0 };
// "5/10 · 200 bb": the stakes and the deepest a seat starts (the rebuy), in big blinds.
export const tableLabel = (t: TableView) => {
  const { smallBlind, bigBlind } = stakesOf(t);
  return `${smallBlind}/${bigBlind}${t.startingStack && bigBlind ? ` · ${t.startingStack / bigBlind} bb` : ''}`;
};

// The columns of the overview's grid for `n` tables in a `w` x `h` box, and the small table's scale: the most columns
// that keep the tables largest. The stage's edges use the same columns for their neighbours above and below.
export function gridFor(n: number, w: number, h: number) {
  let best = { cols: 1, rows: n, s: 0 };
  for (let cols = 1; cols <= n; cols++) {
    const rows = Math.ceil(n / cols);
    const cellW = (w - ALL_W - GAP - (cols - 1) * GAP) / cols, cellH = (h - (rows - 1) * GAP) / rows;
    const s = Math.min((cellW - PNL_W - 12) / TABLE_W, (cellH - LABEL_H) / TABLE_H);
    if (s > best.s + 1e-6) best = { cols, rows, s };
  }
  return best;
}
// The overview's box was last this size (its columns give the edges their neighbours); the window's until it is laid out.
let lastBox: [number, number] | null = null;
export const colsNow = (n: number) => gridFor(n, ...(lastBox ?? [innerWidth - 48, innerHeight * 0.65])).cols;

// PokerTable's props for a table drawn small (page.tsx works out the focused table's own).
function smallTable(t: TableView) {
  const g = t.gameState, d = t.display, complete = g?.street === 'complete';
  const winnersByIdx: Record<number, { amount: number; handDesc: string }> = {};
  if (complete) for (const w of g?.winners ?? []) {
    const e = (winnersByIdx[w.playerIdx] ??= { amount: 0, handDesc: w.handDesc || w.handType });
    e.amount += w.amount;
  }
  const onClock = d?.phase === 'thinking' || d?.phase === 'reasoning';
  return {
    players: g?.players ?? [], currentPlayerIdx: d?.playerIdx ?? g?.currentPlayerIdx ?? -1, communityCards: g?.communityCards ?? [],
    pot: g?.pot ?? 0, winnersByIdx, nextDealAt: complete ? t.dealAt : null, thinkingPlayerIdx: onClock ? d.playerIdx : undefined,
    buttonDetermination: t.buttonDetermination, notice: t.notice, street: g?.street ?? 'preflop', handNumber: g?.handNumber ?? 0,
    display: d, clock: onClock ? t.clock : null,
  };
}

// The desktop table drawn `width` px across as one picture (Fit's transform), in its own big blind. Not interactive: the
// cell or edge round it is the control.
export function SmallTable({ t, width }: { t: TableView; width: number }) {
  return (
    <TableBigBlind.Provider value={stakesOf(t).bigBlind || null}>
      <div data-small-table inert aria-hidden style={{ width }}>
        <Fit w={TABLE_W}><PokerTable {...smallTable(t)} still /></Fit>
      </div>
    </TableBigBlind.Provider>
  );
}

// Profits & Losses rows at the size of the sidebar's text, as many as fit in `h` px: the leaders, then the last.
function PnlRows({ rows, h, bb }: { rows: { name: string; value: number }[]; h: number; bb: number | null }) {
  const fit = Math.max(2, Math.floor((h - PNL_HEAD) / ROW_H));
  const sorted = [...rows].sort((a, b) => b.value - a.value);
  const shown = sorted.length > fit ? [...sorted.slice(0, fit - 1), sorted[sorted.length - 1]] : sorted;
  return (
    <ol className="flex flex-col">
      {shown.map((r, i) => {
        const color = r.value > 0 ? 'rgb(15, 123, 108)' : r.value < 0 ? 'rgb(200, 50, 50)' : MUTED;
        const gap = shown.length < sorted.length && i === shown.length - 1;
        return (
          <li key={r.name} className={`flex items-center gap-1.5 px-2 ${gap ? 'border-t border-dashed border-black/15' : ''}`} style={{ height: ROW_H }}>
            <LLMLogo model={r.name} size={13} />
            <div className="flex-1 min-w-0"><FitName name={r.name} className="text-[12px] leading-4 font-medium" style={{ color: TEXT }} /></div>
            <span className="text-[12px] leading-4 font-bold tabular-nums shrink-0" style={{ color }}>
              {r.value > 0 ? '+' : r.value < 0 ? '−' : ''}{formatAmount(Math.abs(r.value), bb, false)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function PnlBox({ title, unit, rows, h, bb, width }: { title: string; unit?: string; rows: { name: string; value: number }[]; h: number; bb: number | null; width: number }) {
  return (
    <div className="bg-white rounded overflow-hidden shrink-0" style={{ ...CARD, width, height: h }}>
      <div className="flex items-center justify-between px-2 border-b border-notion" style={{ height: PNL_HEAD }}>
        <span className="text-[11px] font-medium uppercase tracking-wider whitespace-nowrap" style={{ color: TEXT }}>{title}</span>
        {unit && <span className="text-[11px] font-medium uppercase tracking-wider" style={{ color: MUTED }}>{unit}</span>}
      </div>
      <PnlRows rows={rows} h={h} bb={bb} />
    </div>
  );
}

// One table's cell: its label line, the small table and its Profits & Losses, as one link into the table.
function Cell({ t, s, onOpen }: { t: KeyedTable; s: number; onOpen: (key: string) => void }) {
  const shown = useBigBlind(), { bigBlind } = stakesOf(t), bb = shown ? bigBlind : null;
  const g = t.gameState, w = Math.floor(TABLE_W * s), h = Math.ceil(TABLE_H * s);
  const label = tableLabel(t);
  return (
    <a
      href={`?tables=1&t=${t.key}`}
      data-overview-cell={t.key}
      aria-label={`Table ${label.replace(' · ', ', ')}`}
      onClick={e => { if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) { e.preventDefault(); onOpen(t.key); } }}
      className="group flex flex-col rounded outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[rgb(31,111,196)]"
    >
      <div className="flex items-baseline gap-3 whitespace-nowrap text-[13px] tabular-nums" style={{ height: LABEL_H, color: MUTED }}>
        <span className="font-bold" style={{ color: TEXT }}>{label}</span>
        <span>Hand #{g?.handNumber || '–'}</span>
        <span>Pot {formatAmount(g?.pot ?? 0, bb)}</span>
        {t.notice && <span>{t.notice.kind === 'closed' ? 'Closed' : 'Paused'}</span>}
      </div>
      <div className="flex gap-3 items-start">
        <div className="transition-shadow rounded group-hover:shadow-[0_0_0_2px_rgba(31,111,196,0.35)]"><SmallTable t={t} width={w} /></div>
        <PnlBox title="Profits & Losses" unit={bb ? 'BB' : undefined} width={PNL_W} h={h} bb={bb} rows={(g?.players ?? []).map(p => ({ name: p.name, value: p.winnings || 0 }))} />
      </div>
    </a>
  );
}

// The grid, centred in its box (the table screen under the header), and the all-tables column beside it.
export default function TablesOverview({ tables, onOpen }: { tables: KeyedTable[]; onOpen: (key: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<[number, number] | null>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const measure = () => { lastBox = [el.clientWidth, el.clientHeight]; setSize(s => (s && s[0] === lastBox![0] && s[1] === lastBox![1] ? s : lastBox)); };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const { cols, rows, s } = size ? gridFor(tables.length, ...size) : { cols: 1, rows: 1, s: 0 };
  const cellH = Math.ceil(TABLE_H * s) + LABEL_H;
  // Across all tables in big blinds (stakes differ: chips do not add up), by model.
  const sums = new Map<string, number>();
  for (const t of tables) {
    const bb = stakesOf(t).bigBlind;
    for (const p of t.gameState?.players ?? []) if (bb) sums.set(p.name, (sums.get(p.name) ?? 0) + (p.winnings || 0) / bb);
  }
  return (
    <div ref={box} data-overview className="absolute inset-0 flex items-center justify-center">
      {s > 0 && (
        <div className="flex gap-4 items-start">
          <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${cols}, auto)` }}>
            {tables.map(t => <Cell key={t.key} t={t} s={s} onOpen={onOpen} />)}
          </div>
          <div style={{ paddingTop: LABEL_H }}>
            <PnlBox title="All tables" unit="BB" width={ALL_W} h={Math.max(rows * cellH + (rows - 1) * GAP - LABEL_H, 9 * ROW_H + PNL_HEAD)} bb={1}
              rows={[...sums].map(([name, value]) => ({ name, value }))} />
          </div>
        </div>
      )}
    </div>
  );
}

// A neighbouring table at the stage's edge, faded and partly out of its box (page.tsx places the box): its live table, or
// (?edges=outline) only its outline and label. A click or the arrow key goes there.
export function Edge({ t, dir, variant, box, width, onGo }: {
  t: KeyedTable; dir: 'left' | 'right' | 'up' | 'down'; variant: 'live' | 'outline'; box: { left: number; top: number; width: number; height: number };
  width: number; onGo: () => void;
}) {
  const h = TABLE_H * (width / TABLE_W), label = tableLabel(t);
  // The table runs out of the box on the side away from the stage, so the part showing is the side nearest it.
  const place = dir === 'left' ? { right: 0, top: (box.height - h) / 2 } : dir === 'right' ? { left: 0, top: (box.height - h) / 2 }
    : dir === 'up' ? { bottom: 0, left: (box.width - width) / 2 } : { top: 0, left: (box.width - width) / 2 };
  const labelAt = dir === 'left' ? 'right-2 top-1/2' : dir === 'right' ? 'left-2 top-1/2' : 'left-1/2 -translate-x-1/2 top-1/2';
  return (
    <button
      type="button"
      data-edge={dir}
      aria-label={`Table ${label.replace(' · ', ', ')}`}
      onClick={onGo}
      className="absolute overflow-hidden rounded opacity-35 hover:opacity-60 focus-visible:opacity-60 transition-opacity outline-none focus-visible:outline-2 focus-visible:outline-[rgb(31,111,196)]"
      style={box}
    >
      <div className="absolute" style={{ ...place, width, height: h }}>
        {variant === 'live' ? <SmallTable t={t} width={width} />
          : <div className="w-full h-full rounded" style={{ boxShadow: 'inset 0 0 0 1.5px rgba(55, 53, 47, 0.45)' }} />}
      </div>
      <span className={`absolute ${labelAt} -translate-y-1/2 rounded bg-white px-1.5 text-[13px] font-bold whitespace-nowrap`} style={{ color: TEXT, ...CARD }}>{label}</span>
    </button>
  );
}
