'use client';

import { memo, useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { Added, GLIDE } from '@/components/Section';
import LLMLogo from '@/components/LLMLogo';
import { DASH, MUTED, ModelStats, TEXT, VsStats, chips, modelHref, netAmong, netColor, plural, signed, useChanges } from '@/lib/stats';

// `models` sorted by net chips against each other (netAmong), with that net.
const byNet = (models: ModelStats[]) => {
  const names = new Set(models.map(m => m.name));
  return models.map(m => ({ m, net: netAmong(m, names) })).sort((a, b) => b.net - a.net);
};

// The chip leader among `models` (against each other only) and the opponent it took the most from.
export function pairwiseLeader(models: ModelStats[]) {
  const [top] = byNet(models);
  if (!top || top.net <= 0) return null;
  const names = new Set(models.map(m => m.name));
  const [from, v] = Object.entries(top.m.vs ?? {}).filter(([n]) => names.has(n)).sort((a, b) => b[1].net_chips - a[1].net_chips)[0] ?? [];
  return { leader: top.m.name, total: top.net, from: v && v.net_chips > 0 ? { name: from!, net: v.net_chips } : null };
}

// Two short sentences: the chip leader's net chips against the models shown (the Net the
// Pairwise rows add up to), then the opponent it took the most from.
// `scope` names the time range and the set the net is counted over ("this session, among the 9
// at the table"), so the figure is never read as the model's overall result.
export function pairwiseVerdict(models: ModelStats[], scope: string) {
  const top = pairwiseLeader(models);
  if (!top) return `Nobody is up yet (${scope}).`;
  const fmt = (n: number) => n.toLocaleString();
  return `${top.leader} is up ${fmt(top.total)} ${scope}.` + (top.from ? ` It took the most from ${top.from.name}, ${fmt(top.from.net)}.` : '');
}

// +53,743 as +54k, for cells too narrow for the full figure. The formats are built once: the grid
// re-renders on every hand History replays.
const COMPACT = [0, 1].map(d => Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: d }));
const short = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${COMPACT[Math.abs(n) < 1e4 ? 1 : 0].format(Math.abs(n)).toLowerCase()}`;

// A figure sized by its own cell (an inline-size container): the full figure where it fits at a
// readable size, else the short one shrunk to the width, and in a sliver too narrow for 9px text
// none (the tint and the tooltip carry it). Never clipped. Screen readers get the full figure.
// Memoized: while History replays only the cells whose figure changed render again.
const Fit = memo(function Fit({ n }: { n: number }) {
  return (
    <div className="@container w-full" aria-hidden>
      <span className="hidden @min-[70px]:inline" style={{ fontSize: 'min(1em, 19cqi)' }}>{chips(n)}</span>
      <span className="hidden @min-[30px]:inline @min-[70px]:hidden" style={{ fontSize: 'min(1em, 29cqi)' }}>{short(n)}</span>
    </div>
  );
});

// A changed cell: a light tint in the colour of the change and a 1px nudge (tint only under reduced
// motion), once, 300ms; `delay` staggers the cells that changed together into a quiet ripple.
const playing = new WeakMap<Element, Animation>(); // not el.getAnimations(), which forces a style recalc per cell
function wiggle(el: HTMLElement, delta: number, delay: number, still: boolean) {
  playing.get(el)?.cancel(); // a newer change replaces one still playing
  const glow = (a: number) => `inset 0 0 0 100px rgba(${delta > 0 ? '15, 123, 108' : '200, 50, 50'}, ${a})`;
  playing.set(el, el.animate(
    still
      ? [{ boxShadow: glow(0.16) }, { boxShadow: glow(0) }]
      : [{ boxShadow: glow(0.16), transform: 'translateX(0)' }, { transform: 'translateX(1px)', offset: 0.3 }, { boxShadow: glow(0), transform: 'translateX(0)' }],
    { duration: 300, delay, easing: 'ease-out' },
  ));
}

// Chips won from each opponent in pots they both played. With `focus`, one model's opponents
// as a list (the drawer); without it, the full grid of row model against column model, rows
// and columns sorted by net chips against the models shown, with a Net column on the right.
export default memo(function HeadToHead({
  models,
  focus,
  bigBlind = 0,
  zoomed = false,
  mini = false,
  hand = null,
}: {
  models: ModelStats[];
  focus?: ModelStats;
  bigBlind?: number; // for bb/100 in the cell readout
  zoomed?: boolean; // the Pairwise screen: larger type
  mini?: boolean; // the overview tile: the same grid, no links or readout (the tile opens the screen)
  hand?: number | null; // the hand History is replaying, when `models` are as of then (null: now)
}) {
  const outer = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ row: string; col: string; x: number; y: number; below: boolean } | null>(null);
  const reduce = useReducedMotion();
  // Rows and columns in overall rank order (net chips over the range shown, the leader's unit),
  // like a chess crosstable; the Total column sums the row's cells.
  const nets = byNet(models);
  const sorted = [...models].sort((a, b) => b.net_chips - a.net_chips);
  const netOf = new Map(nets.map(r => [r.m.name, r.net]));
  // Every figure in the grid as shown, keyed row|column (row| for the Total); an empty cell counts as 0.
  const shown: Record<string, number> = {};
  if (!focus) for (const row of sorted) {
    for (const col of sorted) if (col !== row) shown[`${row.name}|${col.name}`] = row.vs?.[col.name]?.net_chips ?? 0;
    shown[`${row.name}|`] = netOf.get(row.name)!;
  }
  // The cells whose figure changed (a hand History replays, or a new hand) play once each, rippling.
  const { deltas, seq } = useChanges(shown);
  useEffect(() => {
    if (!deltas.size || !outer.current) return;
    const cells = new Map([...outer.current.querySelectorAll<HTMLElement>('[data-cell]')].map(el => [el.dataset.cell!, el]));
    const gap = Math.min(20, 240 / deltas.size); // a big change (Skip) still ripples within a quarter second
    let i = 0;
    for (const [k, d] of deltas) { const el = cells.get(k); if (el) wiggle(el, d, i++ * gap, !!reduce); }
  }, [seq, deltas, reduce]);
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

  const maxCell = Math.max(1, ...sorted.flatMap(m => Object.values(m.vs ?? {}).map(v => Math.abs(v.net_chips))));
  const maxTotal = Math.max(1, ...nets.map(r => Math.abs(r.net)));
  // Diverging tint: green when the row model won, red when it lost, stronger with the amount.
  const tint = (n: number) => `rgba(${n > 0 ? '15, 123, 108' : '200, 50, 50'}, ${(0.08 + 0.5 * Math.sqrt(Math.abs(n) / maxCell)).toFixed(3)})`;
  const bb100 = (net: number, pots: number) => (bigBlind && pots ? signed((net / bigBlind / pots) * 100) : null);
  const show = (e: React.MouseEvent, row: string, col: string) => {
    const o = outer.current!.getBoundingClientRect();
    const r = e.currentTarget.getBoundingClientRect();
    const below = r.top - o.top < 90; // no room above the cell: show it underneath
    setTip({ row, col, x: Math.min(Math.max(r.left - o.left + r.width / 2, 130), o.width - 130), y: below ? r.bottom - o.top + 4 : r.top - o.top - 4, below });
  };
  const tipV = tip && sorted.find(m => m.name === tip.row)?.vs[tip.col];
  // The verdict's leader (row) and the model it took the most from (column), marked in the headers.
  const top = pairwiseLeader(sorted);
  const HOT = 'rgba(35, 131, 226, 0.12)';
  // Square cells: the header row and the label column are one cell each, so the matrix is k×k squares
  // and grows from the tile into the card as one piece (motion layout on its box, one aspect: no
  // stretch). The card adds the row names to its left and the totals to its right, outside the square.
  const k = sorted.length + 1;
  const side = mini ? '0px' : 'clamp(64px, 20cqw, 240px)';
  const S = `min(100cqh, 100cqw - 2 * ${side})`;
  const slot = { height: `calc(${S} / ${k})` }; // a side column's row
  const rowH = { height: `calc((${S} - ${k + 1}px) / ${k})` }; // a matrix row, inside the 1px border spacing
  return (
    <div ref={outer} className="relative flex-1 min-h-0 flex flex-col">
      {/* A size container: the square takes the largest size that fits it. No scroller of its own. */}
      <div className="flex-1 min-h-0 flex justify-center" style={{ containerType: 'size' }} onMouseLeave={() => setTip(null)}>
        {!mini && (
          <Added className="shrink-0 flex flex-col tabular-nums" style={{ width: side }}>
            <span className="block" style={slot} />
            {sorted.map(row => (
              <a key={row.name} href={modelHref(row.name)} style={{ ...slot, color: TEXT }} title={row.name} className={`flex items-center justify-end min-w-0 pr-2 hover:underline ${row.name === top?.leader ? 'font-bold' : 'font-medium'}`}>
                <span className="truncate" style={{ fontSize: 'clamp(12px, 1.6cqh, 16px)' }}>{row.name}</span>
              </a>
            ))}
          </Added>
        )}
        <motion.div layout layoutDependency={mini} transition={GLIDE} className="shrink-0" style={{ width: S, height: S }}>
          <table className="w-full h-full table-fixed tabular-nums border-separate border-spacing-px" style={{ fontSize: `clamp(9px, calc(${S} / ${k} * 0.3), 20px)` }}>
            <caption className="sr-only">Matchups: chips each row model won from each column model, sorted by net chips</caption>
            <colgroup>{Array.from({ length: k }, (_, i) => <col key={i} style={{ width: `${100 / k}%` }} />)}</colgroup>
            <thead>
              <tr style={rowH}>
                <th aria-hidden />
                {sorted.map(m => (
                  <th key={m.name} scope="col" className="p-0 font-medium rounded-sm" title={m.name} style={{ background: m.name === top?.from?.name ? HOT : undefined }}>
                    <span className="flex justify-center"><LLMLogo model={m.name} size={zoomed ? 24 : 16} /></span>
                    <span className="sr-only">{m.name}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map(row => (
                <tr key={row.name} style={rowH}>
                  <th scope="row" className="p-0 rounded-sm" title={row.name} style={{ background: row.name === top?.leader ? HOT : undefined }}>
                    <span className="flex justify-center"><LLMLogo model={row.name} size={zoomed ? 24 : 16} /></span>
                    <span className="sr-only">{row.name}</span>
                  </th>
                  {sorted.map(col => {
                    const v = row.vs?.[col.name];
                    if (row.name === col.name || !v) {
                      return <td key={col.name} data-cell={`${row.name}|${col.name}`} className="p-0 text-center rounded-sm" style={{ color: MUTED, background: row.name === col.name ? 'rgba(55, 53, 47, 0.16)' : 'rgba(55, 53, 47, 0.04)' }}>{row.name === col.name ? '' : '·'}</td>;
                    }
                    return (
                      <td
                        key={col.name}
                        data-cell={`${row.name}|${col.name}`}
                        className="relative p-0 text-center rounded-sm font-bold whitespace-nowrap"
                        style={{ color: TEXT, background: tint(v.net_chips), outline: tip?.row === row.name && tip.col === col.name ? `2px solid ${TEXT}` : undefined }}
                        onMouseEnter={mini ? undefined : e => show(e, row.name, col.name)}
                      >
                        <Fit n={v.net_chips} />
                        <span className="sr-only">{chips(v.net_chips)} vs {col.name}{v.pots ? ` over ${plural(v.pots, 'pot')}` : ''}</span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </motion.div>
        {!mini && (
          <Added className="shrink-0 flex flex-col tabular-nums font-bold" style={{ width: side, fontSize: 'clamp(13px, 1.8cqh, 18px)' }}>
            <span style={slot} className="flex items-end pl-2 pb-1" title="The row's cells added up">Total</span>
            {sorted.map(row => {
              const total = netOf.get(row.name)!;
              const none = row.hands === 0; // no hands yet at the replay's hand
              return (
                // Sized by its own box: bar and full figure when wide, the short figure when narrow.
                <div key={row.name} data-cell={`${row.name}|`} style={{ ...slot, color: none ? MUTED : netColor(total) }} className="@container flex items-center pl-2 whitespace-nowrap">
                  {none ? DASH : <>
                    <span className="flex flex-1 items-center gap-1.5" aria-hidden>
                      {/* A bar as long as the total, against the largest total either way. */}
                      <span className="hidden @min-[150px]:block flex-1 h-2 rounded-sm" style={{ background: 'rgba(55, 53, 47, 0.06)' }}>
                        <span className="block h-full rounded-sm" style={{ width: `${(Math.abs(total) / maxTotal) * 100}%`, background: netColor(total), opacity: 0.7 }} />
                      </span>
                      <span className="hidden @min-[84px]:inline">{chips(total)}</span>
                      <span className="@min-[84px]:hidden">{short(total)}</span>
                    </span>
                    <span className="sr-only">{row.name} total {chips(total)}</span>
                  </>}
                </div>
              );
            })}
          </Added>
        )}
      </div>
      {/* The hovered cell's readout floats over the grid, clamped inside it. */}
      {tip && tipV && (
        <div
          role="tooltip"
          className="absolute z-10 pointer-events-none w-[260px] rounded bg-white px-2.5 py-2 text-[14px] leading-snug tabular-nums"
          style={{ left: tip.x, top: tip.y, transform: `translate(-50%, ${tip.below ? '0' : '-100%'})`, color: TEXT, boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.2) 0px 3px 8px' }}
        >
          <div>
            <span className="font-bold">{tip.row}</span> {tipV.net_chips >= 0 ? 'took' : 'lost'}{' '}
            <span className="font-bold" style={{ color: netColor(tipV.net_chips) }}>{Math.abs(tipV.net_chips).toLocaleString()} chips</span>{' '}
            {tipV.net_chips >= 0 ? 'from' : 'to'} <span className="font-bold">{tip.col}</span>{tipV.pots ? <> over {plural(tipV.pots, 'hand')}</> : null}
          </div>
          {bb100(tipV.net_chips, tipV.pots) && <div style={{ color: MUTED }}>{bb100(tipV.net_chips, tipV.pots)} bb per 100 hands they shared</div>}
        </div>
      )}
    </div>
  );
});

const GREEN = 'rgb(15, 123, 108)';
const RED = 'rgb(200, 50, 50)';

// One row per model, sorted by net chips: a bar that diverges from a centre line, a green segment
// to the right for each opponent it took chips from and a red one to the left for each it gave
// chips to, largest nearest the centre. Every row shares one scale. `only` shows just that model's
// row, on its own scale (the overview teaser). Opponents are limited to `models`, like the matrix.
export const PairwiseBars = memo(function PairwiseBars({ models, only }: { models: ModelStats[]; only?: string }) {
  const outer = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ text: string; x: number; y: number; below: boolean } | null>(null);
  const names = new Set(models.map(m => m.name));
  const sides = (m: ModelStats) => {
    const vs = Object.entries(m.vs ?? {}).filter(([n, v]) => names.has(n) && n !== m.name && v.net_chips !== 0);
    const took = vs.filter(([, v]) => v.net_chips > 0).sort((a, b) => b[1].net_chips - a[1].net_chips);
    const gave = vs.filter(([, v]) => v.net_chips < 0).sort((a, b) => a[1].net_chips - b[1].net_chips);
    return { took, gave, sum: (l: typeof vs) => l.reduce((s, [, v]) => s + Math.abs(v.net_chips), 0) };
  };
  if (!models.some(m => sides(m).took.length || sides(m).gave.length)) {
    return <p className="text-[14px]" style={{ color: MUTED }}>No shared pots yet.</p>;
  }
  const nets = byNet(models).filter(r => !only || r.m.name === only);
  const sorted = nets.map(r => r.m);
  const scale = Math.max(1, ...sorted.map(m => { const s = sides(m); return Math.max(s.sum(s.took), s.sum(s.gave)); }));
  const show = (e: React.SyntheticEvent, text: string) => {
    const o = outer.current!.getBoundingClientRect();
    const r = e.currentTarget.getBoundingClientRect();
    const below = r.top - o.top < 32; // the first row: no room above it inside a scrolling panel
    setTip({ text, x: Math.min(Math.max(r.left - o.left + r.width / 2, 100), o.width - 100), y: below ? r.bottom - o.top + 4 : r.top - o.top - 4, below });
  };
  const segment = (row: string, [name, v]: [string, VsStats], took: boolean) => {
    const text = `${took ? 'took' : 'gave'} ${Math.abs(v.net_chips).toLocaleString()} ${took ? 'from' : 'to'} ${name}`;
    return (
      // Focusable (except in the teaser, whose card is its one stop) with the tooltip on focus and
      // tap; at least 3px wide so every opponent can be hovered, the tooltip giving the true amount.
      <span
        key={name}
        role="img"
        aria-label={`${row} ${text}`}
        tabIndex={only ? undefined : 0}
        onMouseEnter={e => show(e, text)}
        onMouseLeave={() => setTip(null)}
        onFocus={e => show(e, text)}
        onBlur={() => setTip(null)}
        onClick={e => show(e, text)}
        className="@container h-full min-w-[3px] flex items-center justify-center overflow-hidden outline-offset-1 focus-visible:outline-2 focus-visible:outline-[rgb(35,131,226)]"
        style={{ width: `${(Math.abs(v.net_chips) / scale) * 100}%`, background: took ? GREEN : RED, opacity: 0.85 }}
      >
        {/* The opponent's logo where the segment has room for it. */}
        <span className="hidden @min-[24px]:block rounded-full bg-white p-px"><LLMLogo model={name} size={16} /></span>
      </span>
    );
  };
  return (
    <div ref={outer} className="relative @container" onMouseLeave={() => setTip(null)}>
      <ol className="flex flex-col">
        {nets.map(({ m, net }) => {
          const { took, gave } = sides(m);
          return (
            <li key={m.name} className="h-11 grid items-center gap-3 grid-cols-[24px_76px_minmax(0,1fr)] @md:grid-cols-[minmax(0,200px)_88px_minmax(0,1fr)] border-b border-notion last:border-0 text-[14px] md:text-[15px] tabular-nums">
              {/* In the teaser the name is plain text: the whole card opens Pairwise. */}
              {only ? (
                <span className="flex items-center gap-2 min-w-0 font-medium" style={{ color: TEXT }} title={m.name}>
                  <LLMLogo model={m.name} size={22} />
                  <span className="truncate @max-md:sr-only">{m.name}</span>
                </span>
              ) : (
                <a href={modelHref(m.name)} className="flex items-center gap-2 min-w-0 font-medium hover:underline" style={{ color: TEXT }} title={m.name}>
                  <LLMLogo model={m.name} size={22} />
                  <span className="truncate @max-md:sr-only">{m.name}</span>
                </a>
              )}
              <span className="text-right font-bold" style={{ color: netColor(net) }}>{chips(net)}</span>
              {/* Left half: chips given away, growing left from the centre; right half: chips taken. */}
              <span className="h-6 grid grid-cols-2">
                <span className="h-full flex flex-row-reverse gap-px border-r" style={{ borderColor: 'rgba(55, 53, 47, 0.35)' }}>{gave.map(g => segment(m.name, g, false))}</span>
                <span className="h-full flex gap-px">{took.map(t => segment(m.name, t, true))}</span>
              </span>
            </li>
          );
        })}
      </ol>
      {tip && (
        <div
          role="tooltip"
          className="absolute z-10 pointer-events-none whitespace-nowrap rounded bg-white px-2 py-1 text-[13px] tabular-nums"
          style={{ left: tip.x, top: tip.y, transform: `translate(-50%, ${tip.below ? '0' : '-100%'})`, color: TEXT, boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.2) 0px 3px 8px' }}
        >
          {tip.text}
        </div>
      )}
    </div>
  );
});
