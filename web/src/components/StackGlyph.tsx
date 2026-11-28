'use client';

import { createContext, useContext, useLayoutEffect, useRef, useState } from 'react';

// ?tables=1&stacks=1|2 (a draft, the overview only): each seat's stack drawn without numbers, seen from far away
// (PokerTable's lod), in the room the faded name and stack leave. In big blinds, so tables of different stakes compare.
// 1: the felt's own chips in stepped columns, under the grown logo; 2: a thin meter on the seat's left edge with a tick
// at the table's starting stack; 3: 1 with the chips short of the starting stack as dashed outlines. The felt's bets and the pot's chips are drawn on 1's scale too.
// Without the switch, or on the page's own (near) table, nothing here is drawn.

export type StackDraft = { variant: 1 | 2 | 3; bb: number; start: number } | null;
// PokerTable provides it when it is drawn far (or zooming) and the switch is on.
export const StackDraftContext = createContext<StackDraft>(null);
export const useStackDraft = () => useContext(StackDraftContext);
// The table's big blind and starting stack in chips (the overview's SmallTable, the page's stage), for the scale and the
// meter's tick.
export const TableDepth = createContext<{ bb: number; start: number } | null>(null);
// ?stacks=1|2 with ?tables=1 (lib/tableSwitches), drawn far: the draft PokerTable provides.
export const useStackDraftFor = (variant: 1 | 2 | 3 | null, far: boolean): StackDraft => {
  const t = useContext(TableDepth);
  return variant && far && t && t.bb > 0 ? { variant, bb: t.bb, start: t.start } : null;
};

// The scale: chips = 0.632 x the square root of the stack in big blinds, so 1000 bb is 20 chips (three columns of seven,
// the room there is), 300 bb 11, 100 bb 6, 20 bb 3, 1 bb 1. A square root keeps a 20 bb stack visible beside a 1000 bb
// one (linear, 20 bb would be a fifth of a chip) while every step up still adds chips (monotonic). Over 1000 bb: the
// four columns and a "more" cue.
export const PER_COL = 7, MAX_COLS = 3, CAP_BB = 1000;
export const chipsFor = (bbs: number) => (bbs <= 0 ? 0 : Math.min(20, Math.max(1, Math.round(0.632 * Math.sqrt(bbs)))));
// The meter's share (0..1) on the same square-root scale, full at CAP_BB.
export const meterFor = (bbs: number) => (bbs <= 0 ? 0 : Math.min(1, Math.sqrt(bbs / CAP_BB)));

// The felt's chip (ChipStack's: black edge, white face, the inner ring), drawn half again as large: seen from far away
// its 14px chip is a 6px dot. Same colours and the same stroke weight for its size.
const CHIP = { face: '#ffffff', edge: '#37352f' };
const R = 10, T = 4, GAP = 17, SW = 0.9;
export const columnsSize = (n: number, more = false) => {
  const cols = Math.max(1, Math.ceil(n / PER_COL)), tall = Math.min(PER_COL, Math.max(1, n));
  return { w: (cols - 1) * GAP + R * 2 + 2 + (more ? 8 : 0), h: tall * T + R + 4 };
};

// `n` chips in stepped columns of PER_COL, left to right, the last one partial. 0: one chip's outline (a busted seat
// shows an empty place, not nothing). `fresh`: the chips from this index on drop in (a real stack change). `upTo` (3):
// the places from n up to it drawn as dashed outlines, the chips the seat is short of its starting stack.
export function ChipColumns({ n, more = false, fresh = -1, upTo = 0 }: { n: number; more?: boolean; fresh?: number; upTo?: number }) {
  const ref = useRef<SVGSVGElement>(null);
  useLayoutEffect(() => {
    if (fresh < 0 || !ref.current) return;
    ref.current.querySelectorAll<SVGGElement>('[data-chip]').forEach((g, i) => {
      if (i >= fresh) g.animate([{ opacity: 0, transform: 'translateY(-3px)' }, { opacity: 1, transform: 'none' }], { duration: 220, easing: 'ease-out' });
    });
  }, [fresh, n]);
  const { w, h } = columnsSize(Math.max(n, upTo), more);
  const at = (i: number) => ({ cx: 1 + R + Math.floor(i / PER_COL) * GAP, cy: h - R / 2 - 2 - (i % PER_COL) * T });
  return (
    <svg ref={ref} data-chip-columns={n} width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden className="block shrink-0 overflow-visible">
      {n === 0 && upTo === 0 && <ellipse data-glyph-empty cx={1 + R} cy={h - R / 2 - 2} rx={R} ry={R / 2} fill="none" stroke={CHIP.edge} strokeOpacity={0.75} strokeWidth={SW} strokeDasharray="2.5 1.5" />}
      {Array.from({ length: Math.max(0, upTo - n) }, (_, k) => {
        const { cx, cy } = at(n + k);
        return (
          <g key={`o${k}`} data-glyph-short {...(n === 0 && k === 0 ? { 'data-glyph-empty': '' } : null)} fill="none" stroke={CHIP.edge} strokeOpacity={0.55} strokeWidth={SW} strokeDasharray="2.5 1.5">
            <path d={`M ${cx - R} ${cy} v ${T} a ${R} ${R / 2} 0 0 0 ${2 * R} 0 v ${-T}`} />
            <ellipse cx={cx} cy={cy} rx={R} ry={R / 2} />
          </g>
        );
      })}
      {Array.from({ length: n }, (_, i) => {
        const { cx, cy } = at(i);
        return (
          <g key={i} data-chip data-glyph-fill>
            <rect x={cx - R} y={cy} width={R * 2} height={T} fill={CHIP.edge} />
            <ellipse cx={cx} cy={cy + T} rx={R} ry={R / 2} fill={CHIP.edge} />
            <ellipse cx={cx} cy={cy} rx={R} ry={R / 2} fill={CHIP.face} stroke={CHIP.edge} strokeWidth={SW} />
            <ellipse cx={cx} cy={cy} rx={R - 3.4} ry={R / 2 - 1.7} fill="none" stroke={CHIP.edge} strokeWidth={SW} />
          </g>
        );
      })}
      {/* More than the cap: a small chevron after the last column, pointing up. */}
      {more && <path data-glyph-more d={`M ${w - 7} ${h - 12} l 3 -4 l 3 4`} fill="none" stroke={CHIP.edge} strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  );
}

// A change of the same seat's stack (the same player at the same table): its value before, else undefined. A first draw
// (a view change, a table drawn anew) has none, so it never animates.
function usePrevious(id: string, v: number) {
  const [r, setR] = useState<{ id: string; v: number; prev?: number }>({ id, v });
  if (r.id !== id) setR({ id, v });
  else if (r.v !== v) setR({ id, v, prev: r.v });
  return r.id === id ? r.prev : undefined;
}

// The seat's glyph, inside its 200x128 box (Player's inner box; px of the table). Seen far, the stack number's place is
// under the grown logo, and the cards fill the seat's right: 1 stands in the free room under the logo (where the action
// line fades out), its foot on the seat's; as the zoom grows the table it travels up to the stack number's place, shrinking
// to the number's height, and fades into it (--lod-t, --lod-o): the glyph becomes the number. 2 is a meter on the seat's
// left edge, beside the logo.
const FOOT = 124; // the glyph's foot seen far: 4px above the seat box's bottom edge
export function SeatStack({ stack, name }: { stack: number; name: string }) {
  const d = useStackDraft();
  const bbs = d ? stack / d.bb : 0;
  const prev = usePrevious(`${name}|${d?.bb}|${d?.variant}`, bbs);
  if (!d) return null;
  const fade = { opacity: 'calc(1 - var(--lod-o))' } as const;
  if (d.variant !== 2) {
    // 3: 1, with the chips short of the table's starting stack drawn as dashed outlines (below the buy-in shows as a pile
    // with an empty top; above it, all solid).
    const n = chipsFor(bbs), more = bbs > CAP_BB, upTo = d.variant === 3 && d.start > 0 ? chipsFor(d.start / d.bb) : 0, { h } = columnsSize(Math.max(n, upTo), more);
    const was = prev === undefined ? -1 : chipsFor(prev);
    return (
      <div data-stack-glyph={d.variant} data-bbs={Math.round(bbs)} aria-hidden className="absolute pointer-events-none origin-top-left"
        // Far: left 12 (the logo's edge), foot at FOOT. Near: on the stack number (left 40, top 28), at its height.
        style={{ ...fade, left: 'calc(12px + 28px * var(--lod-t))', top: `calc(${FOOT - h}px + ${28 - FOOT + h}px * var(--lod-t))`, transform: `scale(calc(1 - ${1 - 14 / h} * var(--lod-t)))` }}>
        <ChipColumns n={n} more={more} fresh={was >= 0 && n > was ? was : -1} upTo={upTo} />
      </div>
    );
  }
  // 2: the meter, 7 wide on the seat's left edge from the logo's top to the cards' foot; its tick the starting stack.
  const H = 104, share = meterFor(bbs), tick = d.start > 0 ? meterFor(d.start / d.bb) : null;
  return (
    <div data-stack-glyph="2" data-bbs={Math.round(bbs)} aria-hidden className="absolute pointer-events-none" style={{ ...fade, left: 2, top: 12, width: 8, height: H }}>
      <div className="absolute inset-0 rounded-[2px]" style={{ boxShadow: 'inset 0 0 0 1px rgba(55, 53, 47, 0.45)' }} />
      <div data-glyph-fill className="absolute left-0 right-0 bottom-0 rounded-[2px]" style={{ height: share * H, background: '#37352f', transition: prev === undefined ? undefined : 'height 260ms ease-out' }} />
      {tick !== null && <div data-glyph-tick className="absolute" style={{ left: -1, width: 10, bottom: tick * H - 1, height: 2, background: 'rgb(31, 111, 196)' }} />}
      {bbs > CAP_BB && <div data-glyph-more className="absolute left-0 right-0 -top-[5px] h-[4px] rounded-full" style={{ background: '#37352f' }} />}
    </div>
  );
}

// A bet's or the pot's chips seen far, on the seat glyph's scale, over the felt's own pile (which the zoom fades back in).
export function FarChips({ amount }: { amount: number }) {
  const d = useStackDraft();
  if (!d) return null;
  const bbs = amount / d.bb, n = Math.max(1, chipsFor(bbs));
  return (
    <span data-far-chips={Math.round(bbs)} aria-hidden className="absolute left-1/2 bottom-0 -translate-x-1/2 pointer-events-none" style={{ opacity: 'calc(1 - var(--lod-o))' }}>
      <ChipColumns n={n} more={bbs > CAP_BB} />
    </span>
  );
}
