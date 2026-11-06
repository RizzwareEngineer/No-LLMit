'use client';

import { memo, useId, useState } from 'react';
import { CaretDown, CaretUp, Info, Warning } from '@phosphor-icons/react';
import LLMLogo from '@/components/LLMLogo';
import { MIN_HANDS, MUTED, ModelStats, STAT_DEFINITIONS, DASH, TEXT, ciHalf, modelHref, netColor, pct, signedBrief, brief, rosterGroups, NOT_SEATED, NOT_SEATED_HINT } from '@/lib/stats';

interface Column {
  key: keyof typeof STAT_DEFINITIONS;
  label: string;
  value: (m: ModelStats) => number | null;
  render: (m: ModelStats) => React.ReactNode;
  lowerIsBetter?: boolean;
  core?: boolean; // shown before "All stats" is expanded
  extremes?: boolean; // mark the highest and lowest value
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
      { key: 'aiev_bb100', label: 'All-in adj.', value: m => m.aiev_bb100, render: m => signedBrief(m.aiev_bb100) },
    ],
  },
  {
    label: 'Preflop',
    columns: [
      { key: 'vpip', core: true, extremes: true, label: 'VPIP', value: m => m.vpip, render: m => pct(m.vpip) },
      { key: 'pfr', core: true, extremes: true, label: 'PFR', value: m => m.pfr, render: m => pct(m.pfr) },
      { key: 'three_bet', label: '3-bet', value: m => m.three_bet, render: m => pct(m.three_bet) },
    ],
  },
  {
    label: 'Postflop',
    columns: [
      { key: 'af', core: true, extremes: true, label: 'AF', value: m => m.af, render: m => m.af?.toFixed(1) ?? DASH },
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
      { key: 'cost_per_hand_usd', label: 'Cost / hand', value: m => m.cost_per_hand_usd, render: m => `$${m.cost_per_hand_usd.toFixed(4)}`, lowerIsBetter: true },
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
      <span className="inline-flex flex-wrap items-end justify-end gap-0.5">
        {onSort ? (
          <button onClick={onSort} className="inline-flex items-center gap-0.5 whitespace-nowrap hover:underline text-right">
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
        className="absolute right-0 top-full z-20 mt-1 w-56 rounded bg-white p-2 text-left text-[13px] font-normal whitespace-normal"
        style={{ color: TEXT, boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.2) 0px 3px 8px' }}
      >
        {STAT_DEFINITIONS[col.key]}
      </span>
    </th>
  );
}

// The seated models' stats, sortable, never wider than its panel; "All models" appends everyone
// else below a divider. Collapsed to the core columns until "All stats" is pressed, which shows
// every group as one wide table, or one table per group in a narrow panel.
// Memoized: the stats screens re-render on the Race zoom, and the table only changes with its data.
export default memo(function StatsTable({ models, seated }: { models: ModelStats[]; seated?: string[] }) {
  const [sort, setSort] = useState({ key: 'bb100', desc: true });
  const [expanded, setAll] = useState(false);
  const [everyone, setEveryone] = useState(false);
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
  // Without a lineup (a past session, an older engine) every model is a row.
  const atTable = seated ? sorted.filter(m => seated.includes(m.name)) : sorted;
  const rest = seated ? sorted.filter(m => !seated.includes(m.name)) : [];
  const more = rest.length + unseated.length;
  const grid = (groups: typeof GROUPS, grouped: boolean, caption: string, last = true) => (
    <Grid groups={groups} rows={atTable} noHands={noHands} rest={everyone ? rest : []} waiting={last && (everyone || !seated) ? unseated : []} sort={sort} onSort={toggleSort} grouped={grouped} scale={scale} caption={caption} />
  );
  const toggle = 'text-[14px] hover:underline';

  return (
    <>
      <div className="@container relative min-w-0">
        {!expanded ? grid(CORE, false, 'Stats per model.') : (
          <>
            <div className="hidden @3xl:flex flex-1 flex-col">{grid(GROUPS, true, 'Every stat per model.')}</div>
            <div className="@3xl:hidden flex flex-col gap-4">
              {GROUPS.map((g, i) => <div key={g.label}>{grid([g], true, `${g.label} stats per model.`, i === GROUPS.length - 1)}</div>)}
            </div>
          </>
        )}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1">
        <button onClick={() => setAll(v => !v)} aria-expanded={expanded} className={toggle} style={{ color: 'rgb(35, 131, 226)' }}>
          {expanded ? 'Fewer stats' : `All stats (${COLUMNS.length - COLUMNS.filter(c => c.core).length} more)`}
        </button>
        {seated && more > 0 && (
          <button onClick={() => setEveryone(v => !v)} aria-pressed={everyone} className={toggle} style={{ color: 'rgb(35, 131, 226)' }}>
            {everyone ? 'Seated models only' : `All models (${more} more)`}
          </button>
        )}
      </div>
    </>
  );
});

// bb/100 in its colour and the ± half-width; outside All stats, a small bar spans the 95% interval on a
// scale shared by every row, with a tick at zero.
function Bb100({ m, scale, bar }: { m: ModelStats; scale: number; bar: boolean }) {
  const W = 44;
  const half = ciHalf(m);
  const at = (v: number) => W / 2 + (v / scale) * (W / 2);
  return (
    <span className="inline-flex items-center justify-end gap-1.5">
      <span style={{ color: netColor(m.bb100) }} className="font-bold">{signedBrief(m.bb100)}</span>
      <span style={{ color: MUTED }}>±{half === null ? DASH : brief(half, half >= 100 ? 0 : 1)}</span>
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
  rest,
  waiting,
  sort,
  onSort,
  grouped,
  scale,
  caption,
}: {
  groups: typeof GROUPS;
  rows: ModelStats[];
  noHands: string[]; // seated, no hands yet: a row of dashes
  rest: ModelStats[]; // models with hands that are not seated: below a divider, no shading or marks
  waiting: string[]; // on the roster, not seated: a muted group below the rows
  sort: { key: string; desc: boolean };
  onSort: (c: Column) => void;
  grouped: boolean; // a group header row above the column headers
  scale: number;
  caption: string;
}) {
  const columns = groups.flatMap(g => g.columns);
  // The sorted column is painted strong at the top row and faint at the bottom; VPIP, PFR and AF
  // mark their highest and lowest value.
  const sortedCol = columns.find(c => c.key === sort.key);
  // Nulls sort last and stay unshaded, so the gradient spans the rows with a value.
  const valued = sortedCol ? rows.filter(r => sortedCol.value(r) !== null).length : 0;
  const shade = (c: Column, i: number) =>
    c === sortedCol && c.value(rows[i]) !== null ? `rgba(35, 131, 226, ${(0.2 - (0.17 * i) / Math.max(1, valued - 1)).toFixed(3)})` : undefined;
  // Extremes compare what the cell shows, so every row that reads the same as the top (or bottom) value is marked.
  const ends = (c: Column) => {
    const vs = rows.filter(m => c.value(m) !== null).sort((a, b) => c.value(a)! - c.value(b)!);
    if (vs.length < 2) return null;
    const [lo, hi] = [c.render(vs[0]), c.render(vs.at(-1)!)];
    return lo === hi ? null : { hi, lo };
  };
  const marks = new Map(columns.filter(c => c.extremes).map(c => [c, ends(c)]));
  const mark = (c: Column, m: ModelStats) => {
    const e = marks.get(c), v = c.value(m) === null ? null : c.render(m);
    if (!e || v === null || (v !== e.hi && v !== e.lo)) return null;
    const hi = v === e.hi;
    return <span className="mr-1 text-[13px] @max-md:hidden" style={{ color: MUTED }} title={hi ? 'Highest' : 'Lowest'} aria-label={hi ? 'highest' : 'lowest'}>{hi ? '▲' : '▼'}</span>;
  };
  // Every column of All stats shares the width, so its cells pad less.
  const head = grouped ? 'p-1 text-[13px]' : 'px-1.5 py-2 md:px-3 text-[14px]';
  const cell = grouped ? 'px-1' : 'px-1.5 md:px-3';
  const row = (m: ModelStats, i: number | null) => (
    <tr key={m.name} className="lift h-11">
      <th scope="row" className={`${cell} text-left font-bold`}>
        <a href={modelHref(m.name)} className="flex items-center gap-2 min-w-0 hover:underline" style={{ color: TEXT }} title={m.name}>
          <LLMLogo model={m.name} size={22} />
          <span className="truncate @max-md:sr-only">{m.name}</span>
          {m.hands < MIN_HANDS && (
            <Warning size={14} weight="bold" className="shrink-0 @max-md:hidden" style={{ color: 'rgb(140, 95, 20)' }} aria-label={`Fewer than ${MIN_HANDS} hands`} />
          )}
        </a>
      </th>
      {columns.map(c => (
        <td key={c.key} className={`${cell} text-right whitespace-nowrap`} style={{ background: i === null ? undefined : shade(c, i) }}>
          {c === BB100 ? <Bb100 m={m} scale={scale} bar={!grouped} /> : <>{i !== null && mark(c, m)}{c.render(m)}</>}
        </td>
      ))}
    </tr>
  );
  return (
    // Fixed layout: the table takes its panel's width and the cells truncate, so nothing scrolls sideways.
    <table className="w-full table-fixed tabular-nums text-[14px] md:text-[15px]">
      <caption className="sr-only">{caption} Column headers sort the table; the info buttons explain each stat.</caption>
      <colgroup>
        {/* Narrow panels show logos only; wider ones give names the room they need. */}
        <col className={grouped ? 'w-[44px] @md:w-[30%] @4xl:w-[15%]' : 'w-[44px] @md:w-[32%] @4xl:w-[24%]'} />
        {columns.map(c => <col key={c.key} className={c === BB100 ? (grouped ? 'w-[104px] @lg:w-[150px] @4xl:w-[172px]' : 'w-[110px] @lg:w-[170px] @4xl:w-[210px]') : ''} />)}
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
          <th scope="col" className={`${head} text-left font-medium align-bottom`} style={{ color: MUTED }}><span className="@max-md:sr-only">Model</span></th>
          {columns.map(c => <HeaderCell key={c.key} col={c} sort={sort} onSort={() => onSort(c)} className={head} />)}
        </tr>
      </thead>
      <tbody className="divide-y divide-black/10">
        {rows.map((m, i) => row(m, i))}
        {noHands.map(name => (
          <tr key={name} className="h-11">
            <th scope="row" className={`${cell} text-left font-bold`}>
              <span className="flex items-center gap-2 min-w-0" style={{ color: TEXT }} title={name}>
                <LLMLogo model={name} size={22} />
                <span className="truncate @max-md:sr-only">{name}</span>
              </span>
            </th>
            {columns.map(c => <td key={c.key} className={`${cell} text-right`} style={{ color: MUTED }}>{DASH}</td>)}
          </tr>
        ))}
      </tbody>
      {/* Everyone else with hands, under a divider: shown by "All models". */}
      {rest.length > 0 && (
        <tbody className="divide-y divide-black/10 border-t-2 border-[rgba(55,53,47,0.16)]">
          <tr><td colSpan={columns.length + 1} className={`${cell} pt-3 pb-1 text-[13px] font-medium`} style={{ color: MUTED }}>Not at the table</td></tr>
          {rest.map(m => row(m, null))}
        </tbody>
      )}
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
                    <LLMLogo model={name} size={18} />
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
