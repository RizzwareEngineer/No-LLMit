'use client';

import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'motion/react';
import { GLIDE, NONE } from '@/components/Section';
import LLMLogo from '@/components/LLMLogo';
import NameForm from '@/components/NameForm';
import { DASH, MIN_HANDS, MIN_PAIR_HANDS, MUTED, ModelStats, TEXT, bb100Among, bb100Of, chips, modelHref, netColor, plural, signed, useChanges } from '@/lib/stats';
import { figureEms, fitFigure } from '@/lib/format';

// A cell's figure: lib/format's fitFigure (in full where it fits, never a form the cell clips). Screen readers get the full figure.
// On the tile↔card glide the figure travels with the matrix and grows from the tile's size to the card's (motion
// layout, measured only when `at` changes), never shrinking first.
const Fit = memo(function Fit({ n, room, full, px, at, move }: { n: number; room: number; full: number; px: number; at: boolean; move: typeof GLIDE | typeof NONE }) {
  return <motion.span aria-hidden layout layoutDependency={at} transition={move} className="inline-block">{fitFigure(n, room, px, full)}</motion.span>;
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
export const TOTALS = 72; // the card's Total column (14px figures; 13px from md)
export const STRIP = 18; // the column logos' row (28 in the card: 24px logos)
// The tile's figures: one size for every cell and total, whatever the window (the card's are 14px).
const TILE_PX = 13; // one figure size, tile and card (the wide stats scale as one unit: StatsSections' WIDE)
// A figure keeps this much of its cell clear on each side: never edge to edge.
const PAD = 2.5;
// The Total column's definition, on its header.
const TOTAL_TITLE = 'Big blinds won from the models shown per 100 hands dealt in with one of them.\nThe row\'s cells averaged, each weighted by their hands together.';
const NEVER_MET = 'never sat together';
// A pair's or a row's figure under its sample rule is drawn at this opacity.
export const FAINT = 0.4;
// Diverging tint: green when the row model won, red when it lost, stronger with the bb/100, on the scale of
// the pairs past the sample rule (a thin pair's wild figure never flattens the rest; it is capped at the top).
export function pairTint(cells: { bb: number | null; hands: number }[]) {
  const bbs = cells.filter(c => c.bb !== null);
  const maxCell = Math.max(1, ...(bbs.some(c => c.hands >= MIN_PAIR_HANDS) ? bbs.filter(c => c.hands >= MIN_PAIR_HANDS) : bbs).map(c => Math.abs(c.bb!)));
  return (n: number) => `rgba(${n > 0 ? '15, 123, 108' : '200, 50, 50'}, ${(0.08 + 0.5 * Math.sqrt(Math.min(1, Math.abs(n) / maxCell))).toFixed(3)})`;
}
// The cell readout hugs its longest line (two long names around a figure), up to TIP_MAX; it wraps only in a box
// narrower than that (a phone). It keeps TIP_M clear of the card's and the window's edges, TIP_GAP off its cell.
const TIP_MAX = 480;
const TIP_M = 8;
const TIP_GAP = 6;

// Big blinds the row model won from the column model per 100 hands they were both dealt in: the grid of row model
// against column model, in bb/100 rank order, with a Total column (TOTAL_TITLE) on the right.
export default memo(function HeadToHead({
  models,
  bigBlind,
  mini = false,
  snap = false,
  hand = null,
  fitTo,
  leader,
  phone = false,
}: {
  models: ModelStats[];
  bigBlind: number; // the big blind, for bb/100
  mini?: boolean; // the overview tile: the same grid, no links or readout (the tile opens the screen)
  snap?: boolean; // switch between tile and card without gliding (the stage is hidden under the card)
  hand?: number | null; // the hand History is replaying, when `models` are as of then (null: now)
  fitTo?: string[]; // the seated lineup: the card's matrix box holds them; more keep that cell size and scroll, and fade in as the card adds them
  leader?: string | null; // the Leader line's model: its row, and the opponent it did best against, are marked
  phone?: boolean; // a phone's card: logos for row names and no Total column, so nine columns fit its width; a key under the grid names each row with its Total
}) {
  const outer = useRef<HTMLDivElement>(null);
  // The hovered cell, its box on screen, and the card's chrome the readout is drawn in (outside the card's scroller,
  // so it is never cut by it and never adds to its scroll; the grid itself where there is no chrome).
  const [tip, setTip] = useState<{ row: string; col: string; at: DOMRect; host: HTMLElement } | null>(null);
  const tipEl = useRef<HTMLDivElement>(null);
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
  // A cell's width, for the figures that fit it (layout size: a glide's transform does not change it).
  // A callback ref (state): the grid can mount after this component (first drawn on "No shared pots yet."), and the
  // observer attaches when it does.
  const [square, setSquare] = useState<HTMLDivElement | null>(null);
  const [cell, setCell] = useState(0);
  // A phone's figures: the largest size up to 14px at which a four-digit figure's short form (+1.5k: never +1k, 31% off)
  // fits its cell whole, 5% over figureEms (drawn, +1.5k is 2.76em) and 2px short of the cell (it measures a little wide).
  const px = phone ? Math.max(9, Math.min(14, Math.floor((cell - 3) / (figureEms('+1.5k') * 1.05)))) : mini ? TILE_PX : 14;
  const totals = mini ? 0 : TOTALS;
  const room = cell - 1 - 2 * PAD; // the cell inside its 1px spacing and its padding
  const full = cell - 1; // the cell inside its spacing: a shortened figure (+1.5k) may use its padding (fitFigure)
  // A row's Total: in its own column (TOTALS wide), or a phone's key (a three-digit figure's room at 12px: 12px names fit
  // two to a line at 375, "DeepSeek Flash" and "Command R7B" whole).
  const totalFig = (n: number) => (phone ? fitFigure(n, 34, 12) : fitFigure(n, totals - 8, px));
  // Every figure in the grid exactly as drawn (fitFigure's text), keyed row|column (row| for the Total); a pair that never
  // met, or a row with no hands together, has none. Compared as text: a rounded number missed changes the text shows
  // (+12 to +13 across 12.5, a sign at zero, a negative half rounded the other way), which then drew a frame before their flash.
  const shown: Record<string, string> = {};
  for (const row of sorted) {
    for (const col of sorted) { const bb = col !== row ? cellOf(row, col.name).bb : null; if (bb !== null) shown[`${row.name}|${col.name}`] = fitFigure(bb, room, px, full); }
    const t = among.get(row.name)!;
    if (!mini && row.hands > 0 && t.hands > 0) shown[`${row.name}|`] = totalFig(t.bb100);
  }
  // The cells whose figure changed (a hand History replays, or a new hand) flash once each, all together, in the
  // frame their figures change (a layout effect: before that frame is painted). A new cell size (the glide, a resize)
  // redraws figures without a change of value: no flash.
  const { deltas, seq } = useChanges(shown, `${room}|${px}`);
  useLayoutEffect(() => {
    if (!deltas.size || !outer.current) return;
    for (const el of outer.current.querySelectorAll<HTMLElement>('[data-cell]')) if (deltas.has(el.dataset.cell!)) flash(el);
  }, [seq, deltas]);
  useEffect(() => {
    const el = square;
    if (!el) return;
    const ro = new ResizeObserver(() => setCell(el.offsetWidth / models.length));
    ro.observe(el);
    return () => ro.disconnect();
  }, [square, models.length]);
  // The readout goes above its cell, else below, else beside it (right, then left): the first place where it lies
  // whole inside the card and the window, never over the cell. Placed before it is painted, at its own size.
  useLayoutEffect(() => {
    const el = tipEl.current;
    if (!tip || !el) return;
    // k: drawn px per layout px (the wide stats' zoom): the readout is placed in its own layout px.
    const h = tip.host.getBoundingClientRect(), k = h.width / (tip.host.offsetWidth || h.width) || 1, r = tip.at, w = el.offsetWidth * k, ht = el.offsetHeight * k;
    const L = Math.max(h.left, 0) + TIP_M, R = Math.min(h.right, innerWidth) - TIP_M, T = Math.max(h.top, 0) + TIP_M, B = Math.min(h.bottom, innerHeight) - TIP_M;
    const x = Math.max(L, Math.min(r.left + r.width / 2 - w / 2, R - w)), y = Math.max(T, Math.min(r.top + r.height / 2 - ht / 2, B - ht));
    const spots = [[x, r.top - TIP_GAP - ht], [x, r.bottom + TIP_GAP], [r.right + TIP_GAP, y], [r.left - TIP_GAP - w, y]];
    const [left, top] = spots.find(([sx, sy]) => sx >= L && sx + w <= R && sy >= T && sy + ht <= B) ?? [x, Math.max(T, Math.min(spots[0][1], B - ht))];
    el.style.left = `${(left - h.left) / k - tip.host.clientLeft}px`;
    el.style.top = `${(top - h.top) / k - tip.host.clientTop}px`;
  }, [tip]);
  // A scroll (the grid sideways, or the page) moves the cell from under the readout: it closes until the pointer moves.
  useEffect(() => {
    if (!tip) return;
    const off = () => setTip(null);
    addEventListener('scroll', off, true);
    return () => removeEventListener('scroll', off, true);
  }, [tip]);
  // The replay keeps the grid from its first hand, empty or not.
  if (hand === null && !models.some(m => Object.keys(m.vs ?? {}).length > 0)) {
    return <p className="text-[13px]" style={{ color: MUTED }}>No shared pots yet.</p>;
  }

  const tint = pairTint(sorted.flatMap(row => sorted.map(col => cellOf(row, col.name))));
  const show = (e: React.MouseEvent, row: string, col: string) => {
    // Not until the pointer has moved since a tile opened or closed (StatsSections' data-still), nor twice for one cell.
    if (outer.current!.closest('[data-still]') || (tip?.row === row && tip.col === col)) return;
    setTip({ row, col, at: e.currentTarget.getBoundingClientRect(), host: outer.current!.closest<HTMLElement>('.card-chrome') ?? outer.current! });
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
  // card hugs it. One font size per place: 14px in the card (13px from md), like Profiles' cells; TILE_PX on the tile. A figure
  // keeps PAD clear each side and is shortened (+1.2k, +12) only when it does not fit that.
  const n = sorted.length;
  const grow = mini ? 1 : n / Math.max(1, Math.min(n, fitTo?.length ?? n));
  // A model outside the seated lineup (All models): its row and column are what the card adds, like Profiles' extra columns.
  // Its parts move when a re-sort does: their fade runs once, on `outer` (globals.css' .adds), from when they first show.
  const adds = (name: string) => (!mini && fitTo?.includes(name) === false ? 'add-in add-moves' : '');
  const extras = sorted.some(m => adds(m.name));
  const strip = mini ? STRIP : 28;
  const namesW = mini ? `clamp(0px, 100cqw - (100cqh - ${strip}px), var(--names, ${NAMES}px))` : 'auto';
  const Mw = mini ? `calc(100cqw - ${namesW})` : `calc(var(--card-m-phone, var(--card-m)) * ${grow})`;
  const Mh = mini ? `min(100cqh - ${strip}px, 100cqw - ${namesW})` : `calc(var(--card-m-phone, var(--card-mh)) * ${grow})`; // never taller than wide
  const slot = { height: `calc(${Mh} / ${n})` }; // a side column's row
  const rowH = { height: `calc((${Mh} - ${n + 2}px) / ${n})` }; // a matrix row: a cell inside the 1px spacing (n + 2 of them down, with the logos' row)
  const pin = mini ? '' : 'sticky bg-white'; // the card scrolls a grid bigger than its box: headers pinned
  // Tile↔card: the matrix grows as one piece; the names, logos and figures inside it travel with it at their own
  // size (motion layout corrects them for the matrix's scale), like Profiles' cells; the Total column fades in.
  const move = snap ? NONE : GLIDE;
  return (
    // `adds`: All models' rows and columns fade in once, from here, as they first show (globals.css).
    <div ref={outer} className={`relative flex flex-col ${mini ? 'flex-1 min-h-0' : phone ? 'w-max flex-1' : 'w-max'} ${extras ? 'adds' : ''}`}>{/* w-max: as wide as the grid, so the pinned names can follow a sideways scroll */}
      {/* On the tile, a size container: the matrix takes what its names leave. No scroller of its own. */}
      {/* Centred, but never past the left edge: a card that scrolls (a phone, All models) keeps the names pinned. */}
      <div className={`flex justify-center-safe tabular-nums ${mini ? 'flex-1 min-h-0' : 'text-[14px] md:text-[13px]'}`} style={{ containerType: mini ? 'size' : undefined, fontSize: mini || phone ? px : undefined }} onMouseLeave={() => setTip(null)}>
        {/* No overflow-hidden: in the card it would make the column the sticky container of its own top spacer, and on the tile
            it cut the names gliding back from the card's wider column (a phone's: each name truncates itself). */}
        <div className={`shrink-0 flex flex-col ${mini ? '' : `${pin} left-0 z-[2]`}`} style={{ width: namesW }}>
          <span className={`block shrink-0 ${pin && `${pin} top-0 z-[1]`}`} style={{ height: strip }} />
          {/* Model names as in Profiles (14px bold; from md 500, 12px on the tile and 13px in the card: owner 2026-11-15, not
              bigger or bolder than at 67% zoom); the Leader on the highlight. */}
          {sorted.map(row => (
            // One element on the tile and in the card (no remount as the glide runs): a real link (never an anchor without an href).
            // On the tile it is no tab stop and lets a click through to the tile, which opens the card.
            <a key={row.name} data-row-name href={modelHref(row.name)} tabIndex={mini ? -1 : undefined} style={{ ...slot, color: TEXT }} title={row.name} aria-label={phone ? row.name : undefined} className={`${mini ? 'pointer-events-none' : ''} flex items-center justify-end min-w-0 pr-1 whitespace-nowrap ${mini ? 'text-[13px] font-medium' : 'text-[14px] font-bold md:font-medium md:text-[13px] hover:underline'} ${adds(row.name)}`}>
              <motion.span layout="position" layoutDependency={mini} transition={move} translate="no" className="truncate rounded-sm px-1" style={{ background: row.name === leader ? HOT : undefined }}>{phone ? <LLMLogo model={row.name} size={24} /> : row.name}</motion.span>
            </a>
          ))}
        </div>
        <motion.div ref={setSquare} layout layoutDependency={mini} transition={move} className="shrink-0" style={{ width: Mw, height: `calc(${Mh} + ${strip}px)` }}>
          <table className="w-full h-full table-fixed border-separate border-spacing-px">
            <caption className="sr-only">Matchups: big blinds each row model won from each column model per 100 hands they were dealt in together, in bb/100 rank order</caption>
            {/* A zero-width first column holds each row's header for screen readers (the names column shows it). */}
            <colgroup><col style={{ width: 0 }} />{Array.from({ length: n }, (_, i) => <col key={i} style={{ width: `${100 / n}%` }} />)}</colgroup>
            <thead>
              <tr style={{ height: strip - 1 }}>
                <th aria-hidden className="p-0" />
                {/* Opaque when pinned (the highlight over white, a white 1px ring over the cell spacing): scrolled cells never show through. */}
                {sorted.map(m => (
                  <th key={m.name} scope="col" className={`p-0 font-medium rounded-sm ${pin && `${pin} top-0 z-[1]`} ${adds(m.name)}`} title={m.name} style={{ background: m.name === from?.col ? `linear-gradient(${HOT}, ${HOT}) white` : undefined, boxShadow: pin ? '0 0 0 1px white' : undefined }}>
                    <motion.span layout layoutDependency={mini} transition={move} className="flex justify-center"><LLMLogo model={m.name} size={mini ? 16 : 24} /></motion.span>
                    <span className="sr-only">{m.name}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map(row => (
                <tr key={row.name} style={rowH} className={adds(row.name)}>
                  <th scope="row" className="p-0 overflow-hidden"><span className="sr-only">{row.name}</span></th>
                  {sorted.map(col => {
                    const { v, hands, bb } = cellOf(row, col.name);
                    const self = row.name === col.name;
                    const add = adds(row.name) ? '' : adds(col.name);
                    if (self || bb === null) {
                      // Itself, or a pair that never sat together: an empty cell (the card's readout says so).
                      return (
                        <td key={col.name} data-cell={`${row.name}|${col.name}`} className={`p-0 rounded-sm ${add}`} style={{ background: self ? 'rgba(55, 53, 47, 0.16)' : 'rgba(55, 53, 47, 0.04)' }} onMouseMove={mini || self ? undefined : e => show(e, row.name, col.name)}>
                          {!self && <span className="sr-only">{row.name} and {col.name} {NEVER_MET}</span>}
                        </td>
                      );
                    }
                    return (
                      <td
                        key={col.name}
                        data-cell={`${row.name}|${col.name}`}
                        data-hands={hands}
                        className={`relative p-0 text-center rounded-sm whitespace-nowrap overflow-hidden ${add}`}
                        style={{ color: TEXT, background: tint(bb), opacity: hands < MIN_PAIR_HANDS ? FAINT : undefined, outline: tip?.row === row.name && tip.col === col.name ? `2px solid ${TEXT}` : undefined }}
                        onMouseMove={mini ? undefined : e => show(e, row.name, col.name)}
                      >
                        <Fit n={bb} room={room} full={full} px={px} at={mini} move={move} />
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
        {!mini && !phone && <motion.div layout="position" layoutDependency={mini} transition={move} className="add-in shrink-0 flex flex-col font-bold md:font-medium md:sticky md:right-0 md:bg-white z-[2]" style={{ width: totals }}>
          {/* A column header: 13px muted, like Profiles'. */}
          <span style={{ height: strip, color: MUTED }} className={`shrink-0 flex items-end pl-2 text-[13px] leading-none font-medium ${pin} top-0`} title={TOTAL_TITLE}>Total</span>
          {sorted.map(row => {
            const t = among.get(row.name)!;
            const none = row.hands === 0 || t.hands === 0; // no hands together yet at the replay's hand
            // Faint by the row's own hands, as Profiles and the Leader: t.hands counts a hand once per opponent in it.
            return (
              <div key={row.name} data-cell={`${row.name}|`} data-hands={t.hands} style={{ ...slot, color: none ? MUTED : netColor(t.bb100), opacity: !none && row.hands < MIN_HANDS ? FAINT : undefined }} className={`flex items-center pl-2 whitespace-nowrap ${adds(row.name)}`}>
                {none ? DASH : <>
                  <span aria-hidden>{totalFig(t.bb100)}</span>
                  <span className="sr-only">{row.name} {signed(t.bb100)} bb/100 against the models shown, over {plural(row.hands, 'hand')} played</span>
                </>}
              </div>
            );
          })}
        </motion.div>}
      </div>
      {/* A phone's key, under the grid: each row's logo, name and Total, in the grid's order, two to a line. It takes the
          card's height left under the grid (StatsSections leaves it 116px under the matrix), its lines spread over it. Tight
          gaps and 14px logos: "Nemotron Super" and "DeepSeek Flash" fit whole at 375. */}
      {phone && (
        <ol className="sticky left-0 w-[100cqw] flex-1 mt-2 grid grid-cols-2 content-evenly gap-x-2 gap-y-0.5 text-[12px] tabular-nums">
          {sorted.map(row => {
            const t = among.get(row.name)!;
            const none = row.hands === 0 || t.hands === 0;
            return (
              <li key={row.name} className={`flex items-center gap-1 min-w-0 h-5 ${adds(row.name)}`}>
                <LLMLogo model={row.name} size={14} />
                <a data-key-name href={modelHref(row.name)} title={row.name} translate="no" className="block min-w-0 max-w-full truncate rounded-sm px-px font-medium" style={{ color: TEXT, background: row.name === leader ? HOT : undefined }}><NameForm name={row.name} /></a>
                <span data-cell={`${row.name}|`} data-hands={t.hands} title={TOTAL_TITLE} className="ml-auto shrink-0 font-bold" style={{ color: none ? MUTED : netColor(t.bb100), opacity: !none && row.hands < MIN_HANDS ? FAINT : undefined }}>{none ? DASH : <><span aria-hidden>{totalFig(t.bb100)}</span><span className="sr-only">{row.name} {signed(t.bb100)} bb/100 against the models shown, over {plural(row.hands, 'hand')} played</span></>}</span>
              </li>
            );
          })}
        </ol>
      )}
      {/* The hovered cell's readout floats over the card (placed by the layout effect above). One sentence per line. */}
      {tip && tipCell && createPortal(
        <div
          ref={tipEl}
          role="tooltip"
          className="absolute z-10 pointer-events-none rounded bg-white px-2.5 py-2 text-[13px] leading-snug tabular-nums w-max"
          style={{ left: 0, top: 0, maxWidth: `min(${TIP_MAX}px, 100% - ${2 * TIP_M}px, 100vw - ${2 * TIP_M}px)`, color: TEXT, boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.2) 0px 3px 8px' }}
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
        </div>,
        tip.host,
      )}
    </div>
  );
});
