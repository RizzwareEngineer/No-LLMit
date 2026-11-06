'use client';

import { useId, useState } from 'react';
import { CaretDown, CaretUp, Info, Warning } from '@phosphor-icons/react';
import LLMLogo from '@/components/LLMLogo';
import { MIN_HANDS, MUTED, ModelStats, STAT_DEFINITIONS, DASH, TEXT, ciHalf, modelHref, netColor, pct, signed, rosterGroups, NOT_SEATED, NOT_SEATED_HINT } from '@/lib/stats';

interface Column {
  key: keyof typeof STAT_DEFINITIONS;
  label: string;
  value: (m: ModelStats) => number | null;
  render: (m: ModelStats) => React.ReactNode;
  lowerIsBetter?: boolean;
  core?: boolean; // shown before "All stats" is expanded
}

// bb/100 renders separately (its ± bar needs the table-wide scale).
const BB100: Column = { key: 'bb100', core: true, label: 'bb/100 ±', value: m => m.bb100, render: () => null };

// "All stats" shows every group; the default view only the core columns.
const GROUPS: { label: string; columns: Column[] }[] = [
  {
    label: 'Results',
    columns: [
      { key: 'hands', core: true, label: 'Hands', value: m => m.hands, render: m => m.hands.toLocaleString() },
      BB100,
      { key: 'aiev_bb100', label: 'All-in adj.', value: m => m.aiev_bb100, render: m => signed(m.aiev_bb100) },
    ],
  },
  {
    label: 'Preflop',
    columns: [
      { key: 'vpip', core: true, label: 'VPIP', value: m => m.vpip, render: m => pct(m.vpip) },
      { key: 'pfr', core: true, label: 'PFR', value: m => m.pfr, render: m => pct(m.pfr) },
      { key: 'three_bet', label: '3-bet', value: m => m.three_bet, render: m => pct(m.three_bet) },
    ],
  },
  {
    label: 'Postflop',
    columns: [
      { key: 'af', core: true, label: 'AF', value: m => m.af, render: m => m.af?.toFixed(1) ?? DASH },
      { key: 'cbet', label: 'C-bet', value: m => m.cbet, render: m => pct(m.cbet) },
      { key: 'fold_to_cbet', label: 'Fold to c-bet', value: m => m.fold_to_cbet, render: m => pct(m.fold_to_cbet) },
      { key: 'wtsd', label: 'WTSD', value: m => m.wtsd, render: m => pct(m.wtsd) },
      { key: 'wsd', label: 'W$SD', value: m => m.wsd, render: m => pct(m.wsd) },
      { key: 'fold_when_check_free', label: 'Fold when check free', value: m => m.fold_when_check_free, render: m => pct(m.fold_when_check_free), lowerIsBetter: true },
    ],
  },
  {
    label: 'LLM',
    columns: [
      { key: 'error_rate', label: 'Errors', value: m => m.error_rate, render: m => pct(m.error_rate), lowerIsBetter: true },
      { key: 'avg_latency_ms', label: 'Latency', value: m => m.avg_latency_ms, render: m => `${(m.avg_latency_ms / 1000).toFixed(1)} s`, lowerIsBetter: true },
      { key: 'cost_per_hand_usd', label: 'Cost/hand', value: m => m.cost_per_hand_usd, render: m => `$${m.cost_per_hand_usd.toFixed(4)}`, lowerIsBetter: true },
    ],
  },
];
const COLUMNS = GROUPS.flatMap(g => g.columns);
const CORE = GROUPS.map(g => ({ ...g, columns: g.columns.filter(c => c.core) }));

// A column header with its definition on hover or focus. Without `onSort` it is a plain label
// (a fixed-order table); `sort` then only marks the column the rows are ordered by.
export function HeaderCell({ col, sort, onSort, className = 'p-2' }: { col: { key: string; label: string }; sort: { key: string; desc: boolean }; onSort?: () => void; className?: string }) {
  const [open, setOpen] = useState(false);
  const tipId = useId();
  const active = sort.key === col.key;
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.desc ? 'descending' : 'ascending') : onSort ? 'none' : undefined}
      className={`relative ${className} font-medium text-right align-bottom leading-tight`}
      style={{ color: active ? TEXT : MUTED }}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
    >
      <span className="inline-flex flex-wrap items-end justify-end gap-0.5 [overflow-wrap:anywhere]">
        {onSort ? (
          <button onClick={onSort} className="hover:underline text-right">
            {col.label}
            {active && (sort.desc ? <CaretDown size={10} weight="bold" aria-hidden /> : <CaretUp size={10} weight="bold" aria-hidden />)}
          </button>
        ) : col.label}
        <button
          onClick={() => setOpen(true)} // not a toggle: hover and focus already opened it
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={e => e.key === 'Escape' && setOpen(false)}
          aria-label={`What ${col.label} means`}
          aria-expanded={open}
          aria-describedby={tipId}
          className="p-1.5 -m-1 opacity-60 hover:opacity-100"
        >
          <Info size={12} aria-hidden />
        </button>
      </span>
      {/* Always in the DOM so aria-describedby resolves; hidden until opened. */}
      <span
        id={tipId}
        role="tooltip"
        hidden={!open}
        className="absolute right-0 top-full z-20 mt-1 w-56 rounded bg-white p-2 text-left text-[12px] font-normal whitespace-normal"
        style={{ color: TEXT, boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.2) 0px 3px 8px' }}
      >
        {STAT_DEFINITIONS[col.key]}
      </span>
    </th>
  );
}

// Every model's stats, sortable, never wider than its panel. Collapsed to the core columns until
// "All stats" is pressed; without `expandable` (the overview preview) it stays collapsed and compact.
// Expandable means zoomed: larger type, rows that fill the panel, and "All stats" grouped as one
// wide table, or one table per group in a narrow panel.
export default function StatsTable({ models, seated, expandable = true }: { models: ModelStats[]; seated?: string[]; expandable?: boolean }) {
  const [sort, setSort] = useState({ key: 'bb100', desc: true });
  const [all, setAll] = useState(false);
  const expanded = all && expandable;
  const col = COLUMNS.find(c => c.key === sort.key) ?? BB100;
  // Nulls (nothing to count yet) sort last in both directions.
  const sorted = [...models].sort((a, b) => {
    const va = col.value(a), vb = col.value(b);
    if (va === null || vb === null) return (va === null ? 1 : 0) - (vb === null ? 1 : 0);
    return (sort.desc ? -1 : 1) * (va - vb);
  });
  const toggleSort = (c: Column) =>
    setSort(s => (s.key === c.key ? { key: c.key, desc: !s.desc } : { key: c.key, desc: !c.lowerIsBetter }));
  // The ± bars share one scale: the farthest interval end from zero across models.
  const scale = Math.max(1, ...models.flatMap(m => (m.bb100_ci ?? [m.bb100]).map(Math.abs)));
  // Seated models without hands get a row of dashes in every grid; roster models not seated are
  // listed once, under the last grid.
  const { noHands, unseated } = rosterGroups(models, seated);
  const grid = (groups: typeof GROUPS, grouped: boolean, caption: string, last = true) => (
    <Grid groups={groups} rows={sorted} noHands={noHands} waiting={last ? unseated : []} sort={sort} onSort={toggleSort} zoomed={expandable} grouped={grouped} scale={scale} caption={caption} />
  );

  return (
    <>
      <div className={`@container relative min-w-0 ${expandable ? 'flex-1 flex flex-col' : ''}`}>
        {!expanded ? grid(CORE, false, 'Stats per model.') : (
          <>
            <div className="hidden @3xl:flex flex-1 flex-col">{grid(GROUPS, true, 'Every stat per model.')}</div>
            <div className="@3xl:hidden flex flex-col gap-4">
              {GROUPS.map((g, i) => <div key={g.label}>{grid([g], true, `${g.label} stats per model.`, i === GROUPS.length - 1)}</div>)}
            </div>
          </>
        )}
      </div>
      {expandable && <button
        onClick={() => setAll(v => !v)}
        aria-expanded={all}
        className="mt-2 self-start text-[12px] md:text-[13px] hover:underline"
        style={{ color: 'rgb(35, 131, 226)' }}
      >
        {all ? 'Fewer stats' : `All stats (${COLUMNS.length - COLUMNS.filter(c => c.core).length} more)`}
      </button>}
    </>
  );
}

// bb/100 in its colour and the ± half-width; zoomed, a small bar spans the 95% interval on a
// scale shared by every row, with a tick at zero.
function Bb100({ m, scale, bar }: { m: ModelStats; scale: number; bar: boolean }) {
  const W = 44;
  const half = ciHalf(m);
  const at = (v: number) => W / 2 + (v / scale) * (W / 2);
  return (
    <span className="inline-flex items-center justify-end gap-1.5">
      <span style={{ color: netColor(m.bb100) }} className="font-bold">{signed(m.bb100)}</span>
      <span style={{ color: MUTED }}>± {half === null ? DASH : half.toFixed(half >= 100 ? 0 : 1)}</span>
      {bar && (
        <svg width={W} height={10} aria-hidden className="shrink-0 @max-lg:hidden">
          <line x1={W / 2} x2={W / 2} y1={0} y2={10} stroke="rgba(55, 53, 47, 0.35)" />
          {m.bb100_ci && <line x1={at(m.bb100_ci[0])} x2={at(m.bb100_ci[1])} y1={5} y2={5} stroke={netColor(m.bb100)} strokeWidth={2} opacity={0.45} />}
          <circle cx={at(m.bb100)} cy={5} r={2.5} fill={netColor(m.bb100)} />
        </svg>
      )}
    </span>
  );
}

function Grid({
  groups,
  rows,
  noHands,
  waiting,
  sort,
  onSort,
  zoomed,
  grouped,
  scale,
  caption,
}: {
  groups: typeof GROUPS;
  rows: ModelStats[];
  noHands: string[]; // seated, no hands yet: a row of dashes
  waiting: string[]; // on the roster, not seated: a muted group below the rows
  sort: { key: string; desc: boolean };
  onSort: (c: Column) => void;
  zoomed: boolean;
  grouped: boolean; // a group header row above the column headers
  scale: number;
  caption: string;
}) {
  const columns = groups.flatMap(g => g.columns);
  // Every column of All stats shares the width, so its cells pad less.
  const head = zoomed ? (grouped ? 'p-1 md:text-[13px]' : 'p-1.5 md:p-2 md:text-[13px]') : 'px-1.5 py-1';
  const cell = zoomed ? (grouped ? 'px-1 py-1' : 'px-1.5 py-1 md:px-2') : 'px-1.5 py-0.5';
  return (
    // Fixed layout: the table takes its panel's width and the cells truncate, so nothing scrolls sideways.
    <table className={`w-full table-fixed tabular-nums text-[12px] ${zoomed ? 'md:text-[14px] h-full' : ''}`}>
      <caption className="sr-only">{caption} Column headers sort the table; the info buttons explain each stat.</caption>
      <colgroup>
        {/* Narrow panels show logos only; the preview truncates names; zoomed, names get the room they need. */}
        <col className={zoomed ? (grouped ? 'w-[44px] @md:w-[30%] @4xl:w-[15%]' : 'w-[44px] @md:w-[32%] @4xl:w-[18%]') : 'w-[40px] @md:w-[34%]'} />
        {columns.map(c => <col key={c.key} className={c === BB100 ? (zoomed ? (grouped ? 'w-[104px] @lg:w-[150px] @4xl:w-[172px]' : 'w-[104px] @lg:w-[160px] @4xl:w-[196px]') : 'w-[96px] @md:w-[118px]') : ''} />)}
      </colgroup>
      <thead>
        {grouped && (
          <tr>
            <td />
            {groups.map(g => (
              <th key={g.label} scope="colgroup" colSpan={g.columns.length} className="px-2 pt-1 pb-0.5 text-left font-bold text-[12px] md:text-[13px] border-b border-notion" style={{ color: TEXT }}>
                {g.label}
              </th>
            ))}
          </tr>
        )}
        <tr className="border-b border-notion">
          <th scope="col" className={`${head} text-left font-medium align-bottom`} style={{ color: MUTED }}>Model</th>
          {columns.map(c => <HeaderCell key={c.key} col={c} sort={sort} onSort={() => onSort(c)} className={head} />)}
        </tr>
      </thead>
      <tbody className="divide-y divide-black/10">
        {rows.map(m => (
          <tr key={m.name} className="lift">
            <th scope="row" className={`${cell} text-left font-bold`}>
              <a href={modelHref(m.name)} className="flex items-center gap-2 min-w-0 hover:underline" style={{ color: TEXT }} title={m.name}>
                <LLMLogo model={m.name} size={zoomed ? 22 : 18} />
                <span className="truncate @max-md:sr-only">{m.name}</span>
                {m.hands < MIN_HANDS && (
                  <Warning size={13} weight="bold" className="shrink-0 @max-md:hidden" style={{ color: 'rgb(140, 95, 20)' }} aria-label={`Fewer than ${MIN_HANDS} hands`} />
                )}
              </a>
            </th>
            {columns.map(c => (
              <td key={c.key} className={`${cell} text-right whitespace-nowrap overflow-hidden`}>
                {c === BB100 ? <Bb100 m={m} scale={scale} bar={zoomed} /> : c.render(m)}
              </td>
            ))}
          </tr>
        ))}
        {noHands.map(name => (
          <tr key={name}>
            <th scope="row" className={`${cell} text-left font-bold`}>
              <span className="flex items-center gap-2 min-w-0" style={{ color: TEXT }} title={name}>
                <LLMLogo model={name} size={zoomed ? 22 : 18} />
                <span className="truncate @max-md:sr-only">{name}</span>
              </span>
            </th>
            {columns.map(c => <td key={c.key} className={`${cell} text-right`} style={{ color: MUTED }}>{DASH}</td>)}
          </tr>
        ))}
      </tbody>
      {/* Roster models not seated: one wrapped row of names, so a long roster never adds a row each. */}
      {waiting.length > 0 && (
        <tbody style={{ color: MUTED }}>
          <tr className="border-t border-notion" title={NOT_SEATED_HINT}>
            <td colSpan={columns.length + 1} className={`${cell} pt-2`}>
              <span className="font-medium">{NOT_SEATED}</span>
              <span className="sr-only">: {NOT_SEATED_HINT}</span>
              <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                {waiting.map(name => (
                  <li key={name} className="flex items-center gap-1.5 opacity-60">
                    <LLMLogo model={name} size={16} />
                    {name}
                  </li>
                ))}
              </ul>
            </td>
          </tr>
        </tbody>
      )}
    </table>
  );
}
