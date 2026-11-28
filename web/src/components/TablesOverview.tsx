'use client';

import { memo, useState } from 'react';
import PokerTable from '@/components/PokerTable';
import Fit from '@/components/Fit';
import { TableDepth } from '@/components/StackGlyph';
import { TableBigBlind } from '@/lib/amounts';
import { MUTED, TEXT } from '@/lib/stats';
import type { TableView } from '@/lib/stream';
import { shellTables } from '@/lib/shells';
import { parseShells, useShellsKey } from '@/lib/tableSwitches';

// The tables overview (lib/tableSwitches' ?tables=1): every table at once, each the desktop table itself drawn small
// and seen from far away (PokerTable's lod: the text too small to read faded out, its logos and cards grown in place).
// A click zooms into one, the same table growing into the page's (page.tsx); its profit and loss shows there.

type KeyedTable = TableView & { key: string };

// The desktop table's box in layout px: 1000 across, four rows of 128 and its frame (PokerTable).
const TABLE_W = 1000, TABLE_H = 514;
// The label line over each table; the gaps between tables, across and down the same.
const LABEL_H = 24, GX = 20, GY = 20;
const CARD = { boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.1) 0px 2px 4px' };
const DOWN = 'rgb(200, 50, 50)';
// The stats tile-to-card glide's curve (Section's glideEase), shorter: a table is one picture, not a card's content.
export const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';
export const ZOOM_MS = 360;

const stakesOf = (t: TableView) => t.gameState?.stakes ?? { smallBlind: 0, bigBlind: 0 };
// "5/10 · 200 bb": the stakes and the deepest a seat starts (the rebuy), in big blinds.
export const tableLabel = (t: TableView) => {
  const { smallBlind, bigBlind } = stakesOf(t);
  return `${smallBlind}/${bigBlind}${t.startingStack && bigBlind ? ` · ${t.startingStack / bigBlind} bb` : ''}`;
};

// The overview's grid for `n` tables in a `w` x `h` box: the columns and rows, the small table's scale `s` and its
// drawn width, and each cell's size (the table with its label). The largest tables win; about as large, the one with
// more rows. The stage's edges use the same columns for their neighbours above and below.
export function gridFor(n: number, w: number, h: number) {
  let best = { cols: 1, rows: Math.max(1, n), s: 0, tw: 0, th: 0, cellW: 0, cellH: 0 };
  for (let cols = 1; cols <= Math.max(1, n); cols++) {
    const rows = Math.ceil(n / cols), across = (w - (cols - 1) * GX) / cols, down = (h - (rows - 1) * GY) / rows;
    // One table may be drawn over its own size (seen from far away it is a picture, and it fills the screen); the zoom
    // in then ends a little smaller, on the single-table page's table.
    const tw = Math.floor(Math.min(TABLE_W * 1.6, across, ((down - LABEL_H) / TABLE_H) * TABLE_W));
    if (tw < best.tw * 1.02 && !(tw > best.tw * 0.98 && rows > best.rows)) continue;
    const th = Math.floor(TABLE_H * tw / TABLE_W);
    best = { cols, rows, s: tw / TABLE_W, tw, th, cellW: tw, cellH: LABEL_H + th };
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
// cell or edge round it is the control. `named`: the overview's, its seats keep their names for screen readers (without
// it, the stage's edges, a picture only). `far`: seen from far away (PokerTable's lod), when drawn smaller than the page's.
// Memoized: every stream message renders the page, and a table unchanged by it keeps its object (useGameState).
const SmallTable = memo(function SmallTable({ t, width, far = false, farther = false, named = false }: { t: TableView; width: number; far?: boolean; farther?: boolean; named?: boolean }) {
  return (
    <TableBigBlind.Provider value={stakesOf(t).bigBlind || null}>
      <TableDepth.Provider value={{ bb: stakesOf(t).bigBlind, start: t.startingStack ?? 0 }}>
      <div data-small-table inert={!named || undefined} aria-hidden={!named || undefined} className={named ? 'pointer-events-none' : undefined} style={{ width }}>
        <Fit w={TABLE_W}><PokerTable {...smallTable(t)} still lod={far ? { k: TABLE_W / width, farther } : null} /></Fit>
      </div>
      </TableDepth.Provider>
    </TableBigBlind.Provider>
  );
});

// One table: its label line and the small table, as one link into the table.
function Cell({ t, tw, th, far, farther = false, onOpen }: { t: KeyedTable; tw: number; th: number; far: boolean; farther?: boolean; onOpen: (key: string) => void }) {
  const label = tableLabel(t);
  return (
    <a
      href={`?tables=1&t=${t.key}`}
      data-overview-item
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
        <SmallTable t={t} width={tw} far={far} farther={farther} named />
      </div>
    </a>
  );
}

// A shell (?shells=N, lib/shells): the same table and label line, still, and no way in: not a link, no hover lift, the
// default cursor, and a "mock" tag beside its stakes so nobody takes it for a live table.
function ShellCell({ t, tw, th, far, farther = false }: { t: KeyedTable; tw: number; th: number; far: boolean; farther?: boolean }) {
  const label = tableLabel(t);
  return (
    <div data-overview-shell={t.key} aria-label={`Mock table ${label.replace(' · ', ', ')}, not live`} className="block cursor-default" style={{ width: tw }}>
      <div data-cell-label className="flex items-center gap-2 whitespace-nowrap overflow-hidden" style={{ height: LABEL_H - 4, marginBottom: 4 }}>
        <span className="text-[14px] leading-5 font-bold tabular-nums" style={{ color: TEXT }}>{label}</span>
        <span data-mock-tag className="rounded px-1 text-[11px] leading-4 font-bold uppercase tracking-wider" style={{ color: MUTED, boxShadow: 'inset 0 0 0 1px rgba(55, 53, 47, 0.25)' }}>mock</span>
      </div>
      <div data-cell-table className="relative rounded" style={{ width: tw, height: th }}>
        <SmallTable t={t} width={tw} far={far} farther={farther} />
      </div>
    </div>
  );
}

// ?shells=N&layout=c: a table drawn under this many px across is seen from farther still (PokerTable's lod.farther): the
// seats out of the hand show their logo only, the logos grow a little more. Over it and under the page's table: far.
export const FARTHER_W = 300;

// ?shells=N&layout=b: one table large (the featured: the most active live table) and the others as a wall beside it or
// under it, whichever gives the wall's tables more room while the featured one stays about twice their width.
export function featuredFor(n: number, w: number, h: number) {
  let best = { side: true, fw: 0, fh: 0, rail: gridFor(Math.max(1, n - 1), w, h), score: -1 };
  for (let f = 0.35; f <= 0.8; f += 0.01) {
    for (const side of [true, false]) {
      const fw = Math.floor(side ? Math.min(TABLE_W * 1.2, f * w, ((h - LABEL_H) / TABLE_H) * TABLE_W) : Math.min(TABLE_W * 1.2, w, ((f * h - LABEL_H) / TABLE_H) * TABLE_W));
      const fh = Math.floor(TABLE_H * fw / TABLE_W);
      const rail = side ? gridFor(n - 1, w - fw - GX, h) : gridFor(n - 1, w, h - fh - LABEL_H - GY);
      if (rail.tw <= 0 || fw <= 0) continue;
      const score = Math.min(fw, 2.2 * rail.tw) + 0.01 * fw;
      if (score > best.score) best = { side, fw, fh, rail, score };
    }
  }
  return best;
}
// The featured table's pot in its big blinds (how active it is).
const potBB = (t: TableView) => (t.gameState?.pot ?? 0) / (stakesOf(t).bigBlind || 1);

// The grid, centred in its box (`w` x `h`: the first screen between the header and the Stats button, page.tsx), the last
// row's tables centred under the others, the gaps between them even. Laid out from the box's size as given, in the
// render that mounts it: the zoom out measures a cell straight away.
// `nearW`: the page's own table's width; a small table drawn smaller than it is seen from far away (PokerTable's lod).
export default function TablesOverview({ tables, w, h, nearW, onOpen }: { tables: KeyedTable[]; w: number; h: number; nearW: number; onOpen: (key: string) => void }) {
  const shells = parseShells(useShellsKey());
  const all: (KeyedTable & { shell?: true })[] = shells ? [...tables, ...shellTables(tables.length, shells.n)] : tables;
  // b's featured table: the live table with the largest pot in big blinds, switched at most once a hand and only at a hand
  // boundary (the featured table's next hand), so the layout never thrashes.
  const [feat, setFeat] = useState<{ key: string; hand: number } | null>(null);
  const cand = shells?.layout === 'b' && tables.length ? tables.reduce((a, t) => (potBB(t) > potBB(a) ? t : a)) : null;
  const cur = feat && tables.find(t => t.key === feat.key);
  if (cand) {
    const hand = (t: TableView) => t.gameState?.handNumber ?? 0;
    if (!cur) setFeat({ key: cand.key, hand: hand(cand) });
    else if (hand(cur) !== feat.hand) setFeat(cand.key !== cur.key ? { key: cand.key, hand: hand(cand) } : { key: cur.key, hand: hand(cur) });
  }
  const cell = (t: KeyedTable & { shell?: true }, tw: number, th: number) => {
    const far = tw < nearW, farther = shells?.layout === 'c' && tw < FARTHER_W;
    return t.shell ? <ShellCell key={t.key} t={t} tw={tw} th={th} far={far} farther={farther} /> : <Cell key={t.key} t={t} tw={tw} th={th} far={far} farther={farther} onOpen={onOpen} />;
  };
  const featured = shells?.layout === 'b' ? (cur ?? cand) : null;
  if (featured) {
    const { side, fw, fh, rail } = featuredFor(all.length, w, h), rest = all.filter(t => t.key !== featured.key);
    return (
      <div data-overview data-overview-layout="b" className="absolute inset-0 flex items-center justify-center" style={{ flexDirection: side ? 'row' : 'column', gap: GX }}>
        <div data-overview-featured={featured.key}>{cell(featured as KeyedTable, fw, fh)}</div>
        <div data-overview-grid className="flex flex-wrap justify-center content-center" style={{ width: rail.cols * rail.cellW + (rail.cols - 1) * GX, columnGap: GX, rowGap: GY }}>
          {rest.map(t => cell(t, rail.tw, rail.th))}
        </div>
      </div>
    );
  }
  const { cols, tw, th, cellW } = gridFor(all.length, w, h);
  return (
    <div data-overview data-overview-layout={shells?.layout} className="absolute inset-0 flex items-center justify-center">
      {tw > 0 && (
        <div data-overview-grid className="flex flex-wrap justify-center" style={{ width: cols * cellW + (cols - 1) * GX, columnGap: GX, rowGap: GY }}>
          {all.map(t => cell(t, tw, th))}
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
