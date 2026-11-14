'use client';

import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { GLIDE, NONE } from '@/components/Section';
import LLMLogo from '@/components/LLMLogo';
import { DASH, MIN_HANDS, MIN_PAIR_HANDS, MUTED, ModelStats, TEXT, bb100Among, bb100Of, chips, modelHref, netColor, plural, signed, signedBrief, useChanges } from '@/lib/stats';

// A cell's bb/100 at the grid's one font size, in full (+1234.5: a pair with few hands together reaches four
// digits) where it fits, else rounded to a whole, else shortened (+1.2k, a phone's narrow cells), else none (the
// tint and the tooltip carry it). Never clipped. Screen readers get the full figure.
// Its width in em, tabular figures (calibrated in the browser: a figure or sign 0.62em, a comma or point 0.29, k 0.53).
const ems = (t: string) => [...t].reduce((w, c) => w + (c === ',' || c === '.' ? 0.29 : c === 'k' ? 0.53 : 0.62), 0);
export function fitFigure(n: number, room: number, px: number) {
  return [signed(n), signed(n, 0), signedBrief(n)].find(t => ems(t) * px <= room) ?? '';
}
// On the tile↔card glide the figure travels with the matrix and grows from the tile's size to the card's (motion
// layout, measured only when `at` changes), never shrinking first.
const Fit = memo(function Fit({ n, room, px, at, move }: { n: number; room: number; px: number; at: boolean; move: typeof GLIDE | typeof NONE }) {
  return <motion.span aria-hidden layout layoutDependency={at} transition={move} className="inline-block">{fitFigure(n, room, px)}</motion.span>;
});

// A changed cell flashes toward its new tint (a stronger shade of it fading to it, 400ms) as its figure
// changes; it never moves or scales. A Total (no tint of its own) flashes in its figure's colour.
const playing = new WeakMap<Element, Animation>(); // not el.getAnimations(), which forces a style recalc per cell
function flash(el: HTMLElement) {
  playing.get(el)?.cancel(); // a newer change replaces one still playing
  const to = el.style.backgroundColor;
  const from = to ? to.replace(/[\d.]+\)$/, a => `${Math.min(1, parseFloat(a) + 0.25).toFixed(3)})`) : `rgba(${el.style.color.match(/\d+/g)!.slice(0, 3).join(', ')}, 0.18)`;
  playing.set(el, el.animate([{ backgroundColor: from }, { backgroundColor: to || 'rgba(0, 0, 0, 0)' }], { duration: 400, easing: 'ease-out' }));
}

// The grid's names column and its row of column logos, on the tile (StatsSections sizes the tile with them).
// The tile has no Total column (owner, 2026-11-08: "no need for a [Total] column for preview of matchups"); the card does.
export const NAMES = 140; // row names on a phone's tile, at most (from md: --names, the longest name in full)
export const TOTALS = 72; // the card's Total column (14px figures)
export const STRIP = 18; // the column logos' row (28 in the card: 24px logos)
// The tile's figures: one size for every cell and total, whatever the window (the card's are 14px).
export const TILE_PX = 11;
// A figure keeps this much of its cell clear on each side: never edge to edge.
const PAD = 2.5;
// The Total column's definition, on its header.
export const TOTAL_TITLE = 'Big blinds won from the models shown per 100 hands dealt in with one of them.\nThe row\'s cells averaged, each weighted by their hands together.';
const NEVER_MET = 'never sat together';
// A pair's or a row's figure under its sample rule is drawn at this opacity.
const FAINT = 0.4;
// The cell readout's width: its longest line (two long names around a figure) on one line, never wrapped.
const TIP_W = 380;

// Big blinds the row model won from the column model per 100 hands they were both dealt in. With `focus`,
// one model's opponents as a list (the drawer); without it, the full grid of row model against column
// model, in bb/100 rank order, with a Total column (TOTAL_TITLE) on the right.
export default memo(function HeadToHead({
  models,
  focus,
  bigBlind = 0,
  zoomed = false,
  mini = false,
  snap = false,
  hand = null,
  fitTo,
  leader,
}: {
  models: ModelStats[];
  focus?: ModelStats;
  bigBlind?: number; // the big blind, for bb/100
  zoomed?: boolean; // the Pairwise screen: larger type
  mini?: boolean; // the overview tile: the same grid, no links or readout (the tile opens the screen)
  snap?: boolean; // switch between tile and card without gliding (the stage is hidden under the card)
  hand?: number | null; // the hand History is replaying, when `models` are as of then (null: now)
  fitTo?: number; // the card's matrix box holds this many models (the seated lineup); more keep that cell size and scroll
  leader?: string | null; // the Leader line's model: its row, and the opponent it did best against, are marked
}) {
  const outer = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ row: string; col: string; x: number; y: number; below: boolean } | null>(null);
  // Rows and columns in overall rank order (bb/100 over the range shown, the Leader's unit), like a chess
  // crosstable; the Total column is the row's bb/100 against the models shown.
  const sorted = [...models].sort((a, b) => b.bb100 - a.bb100);
  const names = new Set(sorted.map(m => m.name));
  const among = new Map(sorted.map(m => [m.name, bb100Among(m, names, bigBlind)]));
  const cellOf = (row: ModelStats, col: string) => {
    const v = row.vs?.[col];
    const hands = v?.hands ?? 0;
    const bb = v ? bb100Of(v.net_chips, bigBlind, hands) : null;
    return { v, hands, bb };
  };
  // Every figure in the grid as shown, keyed row|column (row| for the Total); a pair that never met counts as 0.
  const shown: Record<string, number> = {};
  if (!focus) for (const row of sorted) {
    for (const col of sorted) if (col !== row) shown[`${row.name}|${col.name}`] = Math.round((cellOf(row, col.name).bb ?? 0) * 10) / 10;
    shown[`${row.name}|`] = Math.round(among.get(row.name)!.bb100 * 10) / 10;
  }
  // The cells whose figure changed (a hand History replays, or a new hand) flash once each, all together, in the
  // frame their figures change (a layout effect: before that frame is painted).
  const { deltas, seq } = useChanges(shown);
  useLayoutEffect(() => {
    if (!deltas.size || !outer.current) return;
    for (const el of outer.current.querySelectorAll<HTMLElement>('[data-cell]')) if (deltas.has(el.dataset.cell!)) flash(el);
  }, [seq, deltas]);
  // A cell's width, for the figures that fit it (layout size: a glide's transform does not change it).
  const square = useRef<HTMLDivElement>(null);
  const [cell, setCell] = useState(0);
  useEffect(() => {
    const el = square.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setCell(el.offsetWidth / models.length));
    ro.observe(el);
    return () => ro.disconnect();
  }, [models.length]);
  if (focus) {
    const rows = Object.entries(focus.vs ?? {}).sort((a, b) => b[1].net_chips - a[1].net_chips);
    if (rows.length === 0) return <p className="text-[13px]" style={{ color: MUTED }}>No shared pots yet.</p>;
    return (
      <table className="w-full text-[12px] tabular-nums">
        <caption className="sr-only">{focus.name} against each opponent</caption>
        <thead>
          <tr className="border-b border-notion" style={{ color: MUTED }}>
            <th scope="col" className="text-left font-medium p-2">Opponent</th>
            <th scope="col" className="text-right font-medium p-2">Pots</th>
            <th scope="col" className="text-right font-medium p-2">Net</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-black/10">
          {rows.map(([name, v]) => (
            <tr key={name} className="lift">
              <th scope="row" className="text-left font-medium p-2">
                <a href={modelHref(name)} className="flex items-center gap-2 hover:underline" style={{ color: TEXT }}>
                  <LLMLogo model={name} size={18} />
                  {name}
                </a>
              </th>
              <td className="text-right p-2">{v.pots}</td>
              <td className="text-right p-2 font-bold" style={{ color: netColor(v.net_chips) }}>{chips(v.net_chips)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    );
  }

  // The replay keeps the grid from its first hand, empty or not.
  if (hand === null && !models.some(m => Object.keys(m.vs ?? {}).length > 0)) {
    return <p className="text-[13px]" style={{ color: MUTED }}>No shared pots yet.</p>;
  }

  // Diverging tint: green when the row model won, red when it lost, stronger with the bb/100, on the scale of
  // the pairs past the sample rule (a thin pair's wild figure never flattens the rest; it is capped at the top).
  const bbs = sorted.flatMap(row => sorted.map(col => cellOf(row, col.name))).filter(c => c.bb !== null);
  const maxCell = Math.max(1, ...(bbs.some(c => c.hands >= MIN_PAIR_HANDS) ? bbs.filter(c => c.hands >= MIN_PAIR_HANDS) : bbs).map(c => Math.abs(c.bb!)));
  const tint = (n: number) => `rgba(${n > 0 ? '15, 123, 108' : '200, 50, 50'}, ${(0.08 + 0.5 * Math.sqrt(Math.min(1, Math.abs(n) / maxCell))).toFixed(3)})`;
  const show = (e: React.MouseEvent, row: string, col: string) => {
    // Not until the pointer has moved since a tile opened or closed (StatsSections' data-still), nor twice for one cell.
    if (outer.current!.closest('[data-still]') || (tip?.row === row && tip.col === col)) return;
    const o = outer.current!.getBoundingClientRect();
    const r = e.currentTarget.getBoundingClientRect();
    const below = r.top - o.top < 90; // no room above the cell: show it underneath
    setTip({ row, col, x: Math.min(Math.max(r.left - o.left + r.width / 2, TIP_W / 2), o.width - TIP_W / 2), y: below ? r.bottom - o.top + 4 : r.top - o.top - 4, below });
  };
  const tipRow = tip && sorted.find(m => m.name === tip.row);
  const tipCell = tipRow && cellOf(tipRow, tip.col);
  // The Leader's row, and the column of the opponent it did best against (past the sample rule), marked in the headers.
  const lead = leader ? sorted.find(m => m.name === leader) : undefined;
  const from = lead && sorted.map(col => ({ col: col.name, ...cellOf(lead, col.name) })).filter(c => c.col !== lead.name && c.bb !== null && c.hands >= MIN_PAIR_HANDS).sort((a, b) => b.bb! - a.bb!)[0];
  const HOT = 'rgba(35, 131, 226, 0.12)';
  // The matrix is n×n cells, Mw wide and Mh tall, under one short row of column logos (the row names to its left
  // say who each row is), and grows from the tile into the card as one piece (motion layout on its box, one
  // shape: no stretch). Row names sit to its left and (the card only) the totals to its right, edge to edge.
  // On the tile (a size container) the names take their longest's width and the matrix the rest, as tall as the
  // tile: from md its cells are wider than tall, on a phone (whose tile is sized for it) square, the names taking
  // what is left. In the card it is --card-m by --card-mh (StatsSections: the tile's shape across the block; a
  // phone's is square, globals.css) for `fitTo` models; more models keep that cell size, so the grid outgrows the
  // card's box and scrolls inside it, the names and the logos pinned (sticky) like a spreadsheet's headers. The
  // card hugs it. One font size per place: 14px in the card, like Profiles' cells; TILE_PX on the tile. A figure
  // keeps PAD clear each side and is shortened (+1.2k, +12) only when it does not fit that.
  const n = sorted.length;
  const grow = mini ? 1 : n / Math.max(1, Math.min(n, fitTo ?? n));
  const px = mini ? TILE_PX : 14;
  const strip = mini ? STRIP : 28;
  const totals = mini ? 0 : TOTALS;
  const namesW = mini ? `clamp(0px, 100cqw - (100cqh - ${strip}px), var(--names, ${NAMES}px))` : 'auto';
  const Mw = mini ? `calc(100cqw - ${namesW})` : `calc(var(--card-m-phone, var(--card-m)) * ${grow})`;
  const Mh = mini ? `min(100cqh - ${strip}px, 100cqw - ${namesW})` : `calc(var(--card-m-phone, var(--card-mh)) * ${grow})`; // never taller than wide
  const slot = { height: `calc(${Mh} / ${n})` }; // a side column's row
  const rowH = { height: `calc((${Mh} - ${n + 2}px) / ${n})` }; // a matrix row: a cell inside the 1px spacing (n + 2 of them down, with the logos' row)
  const room = cell - 1 - 2 * PAD; // the cell inside its 1px spacing and its padding
  const pin = mini ? '' : 'sticky bg-white'; // the card scrolls a grid bigger than its box: headers pinned
  // Tile↔card: the matrix grows as one piece; the names, logos and figures inside it travel with it at their own
  // size (motion layout corrects them for the matrix's scale), like Profiles' cells; the Total column fades in.
  const move = snap ? NONE : GLIDE;
  return (
    <div ref={outer} className={`relative flex flex-col ${mini ? 'flex-1 min-h-0' : 'w-max'}`}>{/* w-max: as wide as the grid, so the pinned names can follow a sideways scroll */}
      {/* On the tile, a size container: the matrix takes what its names leave. No scroller of its own. */}
      {/* Centred, but never past the left edge: a card that scrolls (a phone, All models) keeps the names pinned. */}
      <div className={`flex justify-center-safe tabular-nums ${mini ? 'flex-1 min-h-0' : ''}`} style={{ containerType: mini ? 'size' : undefined, fontSize: px }} onMouseLeave={() => setTip(null)}>
        {/* No overflow-hidden in the card: it would make the column the sticky container of its own top spacer. */}
        <div className={`shrink-0 flex flex-col ${mini ? 'overflow-hidden' : `${pin} left-0 z-[2]`}`} style={{ width: namesW }}>
          <span className={`block shrink-0 ${pin && `${pin} top-0 z-[1]`}`} style={{ height: strip }} />
          {/* Model names as in Profiles (14px bold); the Leader on the highlight. */}
          {sorted.map(row => (
            <a key={row.name} href={mini ? undefined : modelHref(row.name)} style={{ ...slot, color: TEXT }} title={row.name} className={`flex items-center justify-end min-w-0 pr-1 whitespace-nowrap text-[14px] font-bold ${mini ? '' : 'hover:underline'}`}>
              <motion.span layout="position" layoutDependency={mini} transition={move} translate="no" className="truncate rounded-sm px-1" style={{ background: row.name === leader ? HOT : undefined }}>{row.name}</motion.span>
            </a>
          ))}
        </div>
        <motion.div ref={square} layout layoutDependency={mini} transition={move} className="shrink-0" style={{ width: Mw, height: `calc(${Mh} + ${strip}px)` }}>
          <table className="w-full h-full table-fixed border-separate border-spacing-px">
            <caption className="sr-only">Matchups: big blinds each row model won from each column model per 100 hands they were dealt in together, in bb/100 rank order</caption>
            {/* A zero-width first column holds each row's header for screen readers (the names column shows it). */}
            <colgroup><col style={{ width: 0 }} />{Array.from({ length: n }, (_, i) => <col key={i} style={{ width: `${100 / n}%` }} />)}</colgroup>
            <thead>
              <tr style={{ height: strip - 1 }}>
                <th aria-hidden className="p-0" />
                {/* Opaque when pinned (the highlight over white, a white 1px ring over the cell spacing): scrolled cells never show through. */}
                {sorted.map(m => (
                  <th key={m.name} scope="col" className={`p-0 font-medium rounded-sm ${pin && `${pin} top-0 z-[1]`}`} title={m.name} style={{ background: m.name === from?.col ? `linear-gradient(${HOT}, ${HOT}) white` : undefined, boxShadow: pin ? '0 0 0 1px white' : undefined }}>
                    <motion.span layout layoutDependency={mini} transition={move} className="flex justify-center"><LLMLogo model={m.name} size={zoomed ? 24 : 16} /></motion.span>
                    <span className="sr-only">{m.name}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map(row => (
                <tr key={row.name} style={rowH}>
                  <th scope="row" className="p-0 overflow-hidden"><span className="sr-only">{row.name}</span></th>
                  {sorted.map(col => {
                    const { v, hands, bb } = cellOf(row, col.name);
                    const self = row.name === col.name;
                    if (self || bb === null) {
                      // Itself, or a pair that never sat together: an empty cell (the card's readout says so).
                      return (
                        <td key={col.name} data-cell={`${row.name}|${col.name}`} className="p-0 rounded-sm" style={{ background: self ? 'rgba(55, 53, 47, 0.16)' : 'rgba(55, 53, 47, 0.04)' }} onMouseMove={mini || self ? undefined : e => show(e, row.name, col.name)}>
                          {!self && <span className="sr-only">{row.name} and {col.name} {NEVER_MET}</span>}
                        </td>
                      );
                    }
                    return (
                      <td
                        key={col.name}
                        data-cell={`${row.name}|${col.name}`}
                        data-hands={hands}
                        className="relative p-0 text-center rounded-sm whitespace-nowrap overflow-hidden"
                        style={{ color: TEXT, background: tint(bb), opacity: hands < MIN_PAIR_HANDS ? FAINT : undefined, outline: tip?.row === row.name && tip.col === col.name ? `2px solid ${TEXT}` : undefined }}
                        onMouseMove={mini ? undefined : e => show(e, row.name, col.name)}
                      >
                        <Fit n={bb} room={room} px={px} at={mini} move={move} />
                        <span className="sr-only">{signed(bb)} bb/100 vs {col.name} over {plural(hands, 'hand')} together{v!.pots ? `, ${plural(v!.pots, 'pot')}` : ''}</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </motion.div>
        {/* The row's bb/100 against the models shown, bold in its colour. The card only. */}
        {/* Pinned at the right from md; a phone's card is too narrow to give it a lane of its own (scroll to it, as before). */}
        {!mini && <motion.div layout="position" layoutDependency={mini} transition={move} className="add-in shrink-0 flex flex-col font-bold md:sticky md:right-0 md:bg-white z-[2]" style={{ width: totals }}>
          {/* A column header: 13px muted, like Profiles'. */}
          <span style={{ height: strip, color: MUTED }} className={`shrink-0 flex items-end pl-2 text-[13px] leading-none font-medium ${pin} top-0`} title={TOTAL_TITLE}>Total</span>
          {sorted.map(row => {
            const t = among.get(row.name)!;
            const none = row.hands === 0 || t.hands === 0; // no hands together yet at the replay's hand
            return (
              <div key={row.name} data-cell={`${row.name}|`} data-hands={t.hands} style={{ ...slot, color: none ? MUTED : netColor(t.bb100), opacity: !none && t.hands < MIN_HANDS ? FAINT : undefined }} className="flex items-center pl-2 whitespace-nowrap">
                {none ? DASH : <>
                  <span aria-hidden>{fitFigure(t.bb100, totals - 8, px)}</span>
                  <span className="sr-only">{row.name} {signed(t.bb100)} bb/100 against the models shown over {plural(t.hands, 'hand')} together</span>
                </>}
              </div>
            );
          })}
        </motion.div>}
      </div>
      {/* The hovered cell's readout floats over the grid, clamped inside it. One sentence per line. */}
      {tip && tipCell && (
        <div
          role="tooltip"
          className="absolute z-10 pointer-events-none rounded bg-white px-2.5 py-2 text-[13px] leading-snug tabular-nums whitespace-nowrap"
          style={{ width: TIP_W, left: tip.x, top: tip.y, transform: `translate(-50%, ${tip.below ? '0' : '-100%'})`, color: TEXT, boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.2) 0px 3px 8px' }}
        >
          {tipCell.bb === null ? (
            <div><span className="font-bold">{tip.row}</span> and <span className="font-bold">{tip.col}</span> {NEVER_MET}.</div>
          ) : (
            <>
              <div>
                <span className="font-bold">{tip.row}</span>{' '}
                <span className="font-bold" style={{ color: netColor(tipCell.bb) }}>{signed(tipCell.bb)} bb/100</span> against <span className="font-bold">{tip.col}</span>
              </div>
              <div style={{ color: MUTED }}>{plural(tipCell.hands, 'hand')} together, {chips(tipCell.v!.net_chips)} chips.</div>
              {tipCell.hands < MIN_PAIR_HANDS && <div style={{ color: MUTED }}>Under {MIN_PAIR_HANDS} hands together: mostly luck so far.</div>}
            </>
          )}
        </div>
      )}
    </div>
  );
});
