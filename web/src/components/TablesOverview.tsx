'use client';

import { memo, useEffect, useRef } from 'react';
import PokerTable from '@/components/PokerTable';
import Fit from '@/components/Fit';
import LLMLogo from '@/components/LLMLogo';
import WinningsPanel from '@/components/WinningsPanel';
import { TableBigBlind, formatAmount, useBigBlind } from '@/lib/amounts';
import { MUTED, TEXT } from '@/lib/stats';
import type { TableView } from '@/lib/stream';

// The tables overview (lib/tableSwitches' ?tables=1): every table at once, each a small live copy of the desktop table
// seen from far away (semantic zoom: only what reads at that size), with its profit and loss. A click zooms into one,
// growing the detail back in (page.tsx).

type KeyedTable = TableView & { key: string };

// The desktop table's box in layout px: 1000 across, four rows of 128 and its frame (PokerTable). In the overview it is
// drawn small and seen from far away (PokerTable's lod, TableFar): each seat its logo and cards, the felt its pot and board.
const TABLE_W = 1000, TABLE_H = 514;
// The label line over each table; the Profits & Losses panel beside it (the single-table page's, its rows closer), or
// with ?pnl=row the slim row under it; the gaps between tables across and down.
const LABEL_H = 24, PANEL_W = 208, PANEL_GAP = 12, ROW_H = 26, ROW_GAP = 6, ROW_MIN_W = 9 * 60, GX = 32, GY = 18;
const CARD = { boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.1) 0px 2px 4px' };
const UP = 'rgb(15, 123, 108)', DOWN = 'rgb(200, 50, 50)';
// The stats tile-to-card glide's curve (Section's glideEase), shorter: a table is one picture, not a card's content.
export const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
export const ZOOM_MS = 360;

const stakesOf = (t: TableView) => t.gameState?.stakes ?? { smallBlind: 0, bigBlind: 0 };
// "5/10 · 200 bb": the stakes and the deepest a seat starts (the rebuy), in big blinds.
const tableLabel = (t: TableView) => {
  const { smallBlind, bigBlind } = stakesOf(t);
  return `${smallBlind}/${bigBlind}${t.startingStack && bigBlind ? ` · ${t.startingStack / bigBlind} bb` : ''}`;
};

export type PnlVariant = 'panel' | 'row';
// The overview's grid for `n` tables in a `w` x `h` box: the columns and rows, the small table's scale `s` and its
// drawn width, and each cell's size (the table with its label and its profit and loss). The largest tables win. The
// stage's edges use the same columns for their neighbours above and below.
export function gridFor(n: number, w: number, h: number, pnl: PnlVariant = 'panel') {
  let best = { cols: 1, rows: Math.max(1, n), s: 0, tw: 0, th: 0, cellW: 0, cellH: 0 };
  for (let cols = 1; cols <= Math.max(1, n); cols++) {
    const rows = Math.ceil(n / cols), across = (w - (cols - 1) * GX) / cols, down = (h - (rows - 1) * GY) / rows;
    if (pnl === 'row' && across < ROW_MIN_W) continue;
    // Never over its own size (one table is the desktop table, not a blow-up of it).
    const tw = Math.floor(Math.min(TABLE_W, pnl === 'panel' ? across - PANEL_GAP - PANEL_W : across,
      ((pnl === 'panel' ? down - LABEL_H : down - LABEL_H - ROW_GAP - ROW_H) / TABLE_H) * TABLE_W));
    if (tw <= best.tw) continue;
    const th = Math.floor(TABLE_H * tw / TABLE_W);
    best = { cols, rows, s: tw / TABLE_W, tw, th,
      cellW: pnl === 'panel' ? tw + PANEL_GAP + PANEL_W : Math.max(tw, ROW_MIN_W),
      cellH: LABEL_H + th + (pnl === 'row' ? ROW_GAP + ROW_H : 0) };
  }
  return best;
}

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
// cell or edge round it is the control. `far`: seen from far away (the overview's level of detail): its seats keep their
// names for screen readers; without it (the stage's edges) it is a picture only.
// Memoized: every stream message renders the page, and a table unchanged by it keeps its object (useGameState).
const SmallTable = memo(function SmallTable({ t, width, far = false }: { t: TableView; width: number; far?: boolean }) {
  return (
    <TableBigBlind.Provider value={stakesOf(t).bigBlind || null}>
      <div data-small-table inert={!far || undefined} aria-hidden={!far || undefined} className={far ? 'pointer-events-none' : undefined} style={{ width }}>
        <Fit w={TABLE_W}><PokerTable {...smallTable(t)} still lod={far ? { k: TABLE_W / width } : null} /></Fit>
      </div>
    </TableBigBlind.Provider>
  );
});

const colorOf = (v: number) => (v > 0 ? UP : v < 0 ? DOWN : MUTED);
// The row's numbers: in chips over 10,000 in thousands, so nine fit under a small table on one line.
const short = (v: number, bb: number | null) => {
  const a = Math.abs(v), sign = v > 0 ? '+' : v < 0 ? '−' : '';
  return sign + (!bb && a >= 10000 ? `${(a / 1000).toLocaleString('en-US', { maximumFractionDigits: 1 })}k` : formatAmount(a, bb, false));
};

// A number that flashes its colour when it changes, in place: its box is the text's, so nothing round it moves.
function Amount({ value, bb }: { value: number; bb: number | null }) {
  const ref = useRef<HTMLSpanElement>(null), was = useRef(value);
  useEffect(() => {
    if (was.current === value) return;
    const up = value > was.current;
    was.current = value;
    ref.current?.animate([{ backgroundColor: up ? 'rgba(15, 123, 108, 0.18)' : 'rgba(200, 50, 50, 0.16)' }, { backgroundColor: 'rgba(0, 0, 0, 0)' }], { duration: 900, easing: 'ease-out' });
  }, [value]);
  return <span ref={ref} className="rounded-sm text-[12px] leading-4 font-bold tabular-nums whitespace-nowrap" style={{ color: colorOf(value) }}>{short(value, bb)}</span>;
}

// ?pnl=row: the table's nine models in rank order, each its logo and its number, on one slim line under the table.
function PnlRow({ t, width }: { t: KeyedTable; width: number }) {
  const shown = useBigBlind(), bb = shown ? stakesOf(t).bigBlind || null : null;
  const ranked = [...(t.gameState?.players ?? [])].sort((a, b) => (b.winnings || 0) - (a.winnings || 0));
  return (
    <ol data-pnl-row aria-label={`Profits & Losses, ${tableLabel(t)}${bb ? ', in big blinds' : ''}`} className="flex items-center justify-between bg-white rounded px-2"
      style={{ ...CARD, width, height: ROW_H, marginTop: ROW_GAP }}>
      {ranked.map(p => (
        <li key={p.id} className="flex items-center gap-1" aria-label={`${p.name} ${short(p.winnings || 0, bb)}`}>
          <LLMLogo model={p.name} size={16} />
          <Amount value={p.winnings || 0} bb={bb} />
        </li>
      ))}
    </ol>
  );
}

// One table: its label line and the small table, as one link into the table, and its profit and loss beside it (the
// single-table page's panel, at its own text size) or, ?pnl=row, under it.
function Cell({ t, tw, th, cellW, pnl, onOpen }: { t: KeyedTable; tw: number; th: number; cellW: number; pnl: PnlVariant; onOpen: (key: string) => void }) {
  const { bigBlind } = stakesOf(t), label = tableLabel(t);
  return (
    <div data-overview-item className={`flex ${pnl === 'row' ? 'flex-col items-center' : 'flex-row items-start'}`} style={{ width: cellW, gap: pnl === 'row' ? 0 : PANEL_GAP }}>
      <a
        href={`?tables=1&t=${t.key}`}
        data-overview-cell={t.key}
        aria-label={`Table ${label.replace(' · ', ', ')}`}
        onClick={e => { if (e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey) { e.preventDefault(); onOpen(t.key); } }}
        className="group block rounded outline-none focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[rgb(31,111,196)]"
        style={{ width: tw }}
      >
        <div data-cell-label className="flex items-center gap-2 whitespace-nowrap overflow-hidden" style={{ height: LABEL_H - 4, marginBottom: 4 }}>
          <span className="text-[14px] leading-5 font-bold tabular-nums" style={{ color: TEXT }}>{label}</span>
          {t.notice && <span className="text-[13px] leading-5 font-medium" style={{ color: DOWN }}>{t.notice.kind === 'closed' ? 'Closed' : 'Paused'}</span>}
        </div>
        {/* Hover and focus: it lifts a little with a blue ring, the cursor a hand: it opens. */}
        <div data-cell-table className="relative rounded transition-[transform,box-shadow] duration-150 ease-out group-hover:-translate-y-0.5 group-hover:shadow-[0_0_0_2px_rgba(31,111,196,0.6),0_8px_20px_rgba(15,15,15,0.14)] group-focus-visible:-translate-y-0.5 group-focus-visible:shadow-[0_0_0_2px_rgba(31,111,196,0.6),0_8px_20px_rgba(15,15,15,0.14)]" style={{ width: tw, height: th }}>
          <SmallTable t={t} width={tw} far />
        </div>
      </a>
      {pnl === 'row' ? <PnlRow t={t} width={cellW} /> : (
        <div data-overview-pnl className="flex flex-col shrink-0" style={{ width: PANEL_W, height: LABEL_H + th }}>
          <TableBigBlind.Provider value={bigBlind || null}>
            <WinningsPanel players={t.gameState?.players ?? []} box={`pnl:${t.key}`} dense />
          </TableBigBlind.Provider>
        </div>
      )}
    </div>
  );
}

// The grid, centred in its box (`w` x `h`: the first screen between the header and the Stats button, page.tsx), the last
// row's tables centred under the others. Laid out from the box's size as given, in the render that mounts it: the zoom
// out measures a cell straight away.
export default function TablesOverview({ tables, w, h, pnl, onOpen }: { tables: KeyedTable[]; w: number; h: number; pnl: PnlVariant; onOpen: (key: string) => void }) {
  const { cols, tw, th, cellW } = gridFor(tables.length, w, h, pnl);
  return (
    <div data-overview className="absolute inset-0 flex items-center justify-center">
      {tw > 0 && (
        <div data-overview-grid className="flex flex-wrap justify-center" style={{ width: cols * cellW + (cols - 1) * GX, columnGap: GX, rowGap: GY }}>
          {tables.map(t => <Cell key={t.key} t={t} tw={tw} th={th} cellW={cellW} pnl={pnl} onOpen={onOpen} />)}
        </div>
      )}
    </div>
  );
}

// A neighbouring table at the stage's edge (page.tsx measures the room): with room, its live table (or, ?edges=outline,
// only its outline) faded and partly out of the box, its label in the box's free corner next to the stage, never over
// its seats; without room, a slim tab with its label at that edge. A click or the arrow key goes there.
export type EdgeRoom = { box: { left: number; top: number; width?: number; height?: number; transform?: string }; tab: boolean };
const ARROW = { left: '←', right: '→', up: '↑', down: '↓' };
export function Edge({ t, dir, variant, room, width, onGo }: {
  t: KeyedTable; dir: 'left' | 'right' | 'up' | 'down'; variant: 'live' | 'outline'; room: EdgeRoom; width: number; onGo: () => void;
}) {
  const label = tableLabel(t), { box } = room, bw = box.width ?? 0, bh = box.height ?? 0;
  const pill = `rounded bg-white px-1.5 text-[12px] leading-5 font-bold whitespace-nowrap tabular-nums`;
  const name = `Table ${label.replace(' · ', ', ')}`;
  if (room.tab) return (
    <button type="button" data-edge={dir} data-edge-tab aria-label={name} onClick={onGo} style={{ ...box, color: TEXT, ...CARD }}
      className={`absolute z-20 flex items-center justify-center gap-1 ${pill} opacity-70 hover:opacity-100 focus-visible:opacity-100 transition-opacity outline-none focus-visible:outline-2 focus-visible:outline-[rgb(31,111,196)] ${dir === 'left' || dir === 'right' ? '[writing-mode:vertical-rl]' : ''}`}>
      <span aria-hidden className="[writing-mode:horizontal-tb]" style={{ color: MUTED }}>{ARROW[dir]}</span>{label}
    </button>
  );
  const h = TABLE_H * (width / TABLE_W), side = dir === 'left' || dir === 'right';
  // The table runs out of the box on the side away from the stage, so the part showing is the side nearest it.
  const place = dir === 'left' ? { right: 0, top: (bh - h) / 2 } : dir === 'right' ? { left: 0, top: (bh - h) / 2 }
    : dir === 'up' ? { bottom: 0, left: (bw - width) / 2 } : { top: 0, left: (bw - width) / 2 };
  // The label in the free room the table leaves: over it beside the stage (left, right), beside it (up, down).
  const labelAt = side ? { top: Math.max(0, (bh - h) / 2 - 26), ...(dir === 'left' ? { right: 0 } : { left: 0 }) } : { left: 0, top: '50%', transform: 'translateY(-50%)' };
  return (
    <button type="button" data-edge={dir} aria-label={name} onClick={onGo}
      className="group absolute z-20 rounded outline-none focus-visible:outline-2 focus-visible:outline-[rgb(31,111,196)]" style={box}>
      <div className="absolute inset-0 overflow-hidden opacity-35 group-hover:opacity-60 group-focus-visible:opacity-60 transition-opacity">
        <div className="absolute" style={{ ...place, width, height: h }}>
          {variant === 'live' ? <SmallTable t={t} width={width} />
            : <div className="w-full h-full rounded" style={{ boxShadow: 'inset 0 0 0 1.5px rgba(55, 53, 47, 0.45)' }} />}
        </div>
      </div>
      <span data-edge-label className={`absolute ${pill} opacity-80 group-hover:opacity-100`} style={{ ...labelAt, color: TEXT, ...CARD }}>{label}</span>
    </button>
  );
}
