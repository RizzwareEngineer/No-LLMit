'use client';

import { memo, useEffect, useId, useState } from 'react';
import { motion, type Transition } from 'motion/react';
import { CaretDown, CaretUp, CaretUpDown, Info, Warning } from '@phosphor-icons/react';
import LLMLogo, { modelColor } from '@/components/LLMLogo';
import { RATE_FROM } from '@/components/CumulativeChart';
import { GLIDE, GLIDE_MS } from '@/components/Section';
import { MIN_HANDS, MUTED, ModelStats, STAT_DEFINITIONS, DASH, TEXT, ciTitle, modelHref, netColor, pct, signedBrief, rosterGroups, NOT_SEATED, NOT_SEATED_HINT } from '@/lib/stats';

interface Column {
  key: keyof typeof STAT_DEFINITIONS;
  label: string;
  value: (m: ModelStats) => number | null;
  render: (m: ModelStats) => React.ReactNode;
  lowerIsBetter?: boolean;
  extremes?: boolean; // mark the highest and lowest value
}

// bb/100 renders separately (its cell carries the 95% range as a tooltip).
const BB100: Column = { key: 'bb100', label: 'bb/100', value: m => m.bb100, render: () => null };
// The sparkline renders separately (every row shares one y-scale); it sorts by bb/100 within the window.
const TREND: Column = { key: 'trend', label: 'Last 50 hands', value: m => recent(m).rate, render: () => null };

// Running bb/100 at each of the model's points in its last 50 hands (from cumulative_bb), plus the
// bb/100 won within them. Starts at the point at or before the window, so a series the engine thinned
// (past 200 hands it keeps every nth point) still draws a line; hands before RATE_FROM are skipped,
// as in the Race, since a rate over a handful of hands is noise.
// shortcut: the line coarsens once the engine thins cumulative_bb; add a recent-hands field to the API if that matters.
function recent(m: ModelStats) {
  const pts = m.cumulative_bb.filter(([h]) => h >= RATE_FROM);
  if (pts.length < 2) return { line: [] as [number, number][], rate: null };
  const last = pts.at(-1)!;
  const first = pts[Math.max(0, pts.findLastIndex(([h]) => h <= last[0] - 50))];
  return {
    line: pts.slice(pts.indexOf(first)).map(([h, bb]) => [h, (bb / h) * 100] as [number, number]),
    rate: ((last[1] - first[1]) / (last[0] - first[0])) * 100,
  };
}

// A row's slide to its new place when the order changes, like Profits & Losses' rows.
const SLIDE = { duration: 0.3 } as const;

// A cell's content, moved by motion layout (Chrome ignores transforms on a table row, so the cells'
// content moves, not the rows). On the tile↔card glide it travels with the card at its own size (the
// box around it grows; the text never shrinks and grows back); when its row changes place it slides
// there (SLIDE). `at` is what moves it: measured only when that changes.
function Glides({ at, move, children }: { at: string | boolean; move: Transition; children: React.ReactNode }) {
  return <motion.span layout="position" layoutDependency={at} transition={move} className="inline-block max-w-full align-middle">{children}</motion.span>;
}

// The model's recent running bb/100 in its colour, on the y-scale [lo, hi] every row shares; a dot at now.
function Spark({ m, lo, hi }: { m: ModelStats; lo: number; hi: number }) {
  const { line } = recent(m);
  if (line.length < 2) return <span style={{ color: MUTED }} title={`Draws from hand ${RATE_FROM}`}>{DASH}</span>;
  const [W, H, P] = [96, 20, 3];
  const [h0, h1] = [line[0][0], line.at(-1)![0]];
  const pts = line.map(([h, v]) => [P + ((h - h0) / (h1 - h0 || 1)) * (W - 2 * P), P + (1 - (v - lo) / (hi - lo || 1)) * (H - 2 * P)]);
  const end = pts.at(-1)!;
  const c = modelColor(m.name);
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="inline-block align-middle" role="img" aria-label={`${m.name}: running bb/100 over its last 50 hands, now ${signedBrief(line.at(-1)![1])}`}>
      <polyline points={pts.map(p => p.join(',')).join(' ')} fill="none" stroke={c} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={end[0]} cy={end[1]} r={2.5} fill={c} />
    </svg>
  );
}

// "All stats" shows every group; the default view only the core columns.
const GROUPS: { label: string; columns: Column[] }[] = [
  {
    label: 'Results',
    columns: [
      BB100,
      TREND,
      { key: 'hands', label: 'Hands', value: m => m.hands, render: m => m.hands.toLocaleString() },
      { key: 'aiev_bb100', label: 'All-in adj.', value: m => m.aiev_bb100, render: m => signedBrief(m.aiev_bb100) },
    ],
  },
  {
    label: 'Preflop',
    columns: [
      { key: 'vpip', extremes: true, label: 'VPIP', value: m => m.vpip, render: m => pct(m.vpip) },
      { key: 'pfr', extremes: true, label: 'PFR', value: m => m.pfr, render: m => pct(m.pfr) },
      { key: 'three_bet', label: '3-bet', value: m => m.three_bet, render: m => pct(m.three_bet) },
    ],
  },
  {
    label: 'Postflop',
    columns: [
      { key: 'af', extremes: true, label: 'AF', value: m => m.af, render: m => m.af?.toFixed(1) ?? DASH },
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
// The default view: hands first, then the style stats, then the recent trend. No bb/100: History
// above already shows it (rows stay in bb/100 order). The overview tile drops the sparkline.
const byKey = (k: string) => COLUMNS.find(c => c.key === k)!;
const CORE = [{ label: 'Core', columns: [byKey('hands'), byKey('vpip'), byKey('pfr'), byKey('af'), TREND] }];
const MINI = [{ label: 'Core', columns: CORE[0].columns.filter(c => c !== TREND) }];

// A column header with its definition on hover or focus. Without `onSort` it is a plain label
// (a fixed-order table); `sort` then only marks the column the rows are ordered by.
// `mini` set (Profiles' tile and card): the header glides between the two, the tile's being the label alone.
export function HeaderCell({ col, sort, onSort, className = 'p-2', wrap = false, mini }: { col: { key: string; label: string }; sort: { key: string; desc: boolean }; onSort?: () => void; className?: string; wrap?: boolean; mini?: boolean }) {
  const [open, setOpen] = useState(false);
  const tipId = useId();
  const active = sort.key === col.key;
  const label = (
    <span className="inline-flex flex-wrap items-end justify-end gap-0.5">
      {onSort ? (
        <button onClick={onSort} className={`inline-flex items-center gap-0.5 hover:underline text-right ${wrap ? '' : 'whitespace-nowrap'}`}>
          {col.label}
          {active ? (sort.desc ? <CaretDown size={12} weight="bold" aria-hidden /> : <CaretUp size={12} weight="bold" aria-hidden />) : <CaretUpDown size={12} className="opacity-40" aria-hidden />}
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
  );
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.desc ? 'descending' : 'ascending') : onSort ? 'none' : undefined}
      className={`${className.includes('sticky') ? '' : 'relative'} ${className} font-medium text-right align-bottom leading-tight`}
      style={{ color: active ? TEXT : MUTED }}
      onMouseEnter={mini ? undefined : () => setOpen(true)}
      onMouseLeave={mini ? undefined : () => setOpen(false)}
    >
      {mini === undefined ? label : <Glides at={mini} move={GLIDE}>{mini ? col.label : label}</Glides>}
      {/* Always in the DOM so aria-describedby resolves; hidden until opened. */}
      {!mini && (
        <span
          id={tipId}
          role="tooltip"
          hidden={!open}
          className="absolute right-0 top-full z-20 mt-1 w-56 rounded bg-white p-2 text-left text-[13px] font-normal whitespace-normal"
          style={{ color: TEXT, boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.2) 0px 3px 8px' }}
        >
          {STAT_DEFINITIONS[col.key]}
        </span>
      )}
    </th>
  );
}

// The seated models' stats, sortable, never wider than its panel; "All models" appends everyone
// else below a divider. Collapsed to the core columns until "All stats" is pressed, which shows
// every group as one wide table, or one table per group in a narrow panel.
// Memoized: the stats screens re-render on the History zoom, and the table only changes with its data.
// `pending`: models in range with no hands yet at the hand History is replaying, shown as dash rows.
// `mini`: the overview tile, the same table with fewer columns, fixed short rows and no controls;
// opening the card keeps this table and adds the rest around it.
export default memo(function StatsTable({ models, seated, pending = [], mini = false }: { models: ModelStats[]; seated?: string[]; pending?: string[]; mini?: boolean }) {
  const [sort, setSort] = useState({ key: 'bb100', desc: true });
  const [expanded, setAll] = useState(false);
  const [everyone, setEveryone] = useState(false);
  // Rows clicked to compare: the rest fade (Sports-Reference's row isolation).
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const isolate = (name: string) => setPicked(p => { const n = new Set(p); if (!n.delete(name)) n.add(name); return n; });
  const col = COLUMNS.find(c => c.key === sort.key) ?? BB100;
  // Nulls (nothing to count yet) sort last in both directions.
  const sorted = [...models].sort((a, b) => {
    const va = col.value(a), vb = col.value(b);
    if (va === null || vb === null) return (va === null ? 1 : 0) - (vb === null ? 1 : 0);
    return (sort.desc ? -1 : 1) * (va - vb);
  });
  const toggleSort = (c: Column) =>
    setSort(s => (s.key === c.key ? { key: c.key, desc: !s.desc } : { key: c.key, desc: !c.lowerIsBetter }));
  // Seated models without hands get a row of dashes in every grid; roster models not seated are
  // listed once, under the last grid.
  const groups = rosterGroups(models, seated);
  // The tile lists the table's seats only; the card also keeps a dash row for anyone in range still waiting for a hand.
  const noHands = [...new Set([...groups.noHands, ...pending])].filter(name => !mini || !seated || seated.includes(name));
  const unseated = groups.unseated.filter(name => !pending.includes(name));
  // Without a lineup (a past session, an older engine) every model is a row.
  const atTable = seated ? sorted.filter(m => seated.includes(m.name)) : sorted;
  const rest = seated ? sorted.filter(m => !seated.includes(m.name)) : [];
  const more = rest.length + unseated.length;
  const grid = (groups: typeof GROUPS, grouped: boolean, caption: string, last = true) => (
    <Grid groups={groups} rows={atTable} noHands={noHands} rest={everyone && !mini ? rest : []} waiting={last && !mini && (everyone || !seated) ? unseated : []} sort={sort} onSort={toggleSort} grouped={grouped} picked={picked} onPick={isolate} caption={caption} mini={mini} />
  );
  const toggle = 'text-[14px] hover:underline';

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className="@container relative min-w-0">
        {mini ? grid(MINI, false, 'Profiles per model.') : !expanded ? grid(CORE, false, 'Profiles per model.') : (
          <>
            <div className="hidden @3xl:flex flex-1 flex-col">{grid(GROUPS, true, 'Every stat per model.')}</div>
            <div className="@3xl:hidden flex flex-col gap-4">
              {GROUPS.map((g, i) => <div key={g.label}>{grid([g], true, `${g.label} stats per model.`, i === GROUPS.length - 1)}</div>)}
            </div>
          </>
        )}
      </div>
      {!mini && <div className="add-in mt-2 flex flex-wrap gap-x-5 gap-y-1">
        <button onClick={() => setAll(v => !v)} aria-expanded={expanded} className={toggle} style={{ color: 'rgb(35, 131, 226)' }}>
          {expanded ? 'Fewer stats' : `All stats (${COLUMNS.length - CORE[0].columns.length} more)`}
        </button>
        {seated && more > 0 && (
          <button onClick={() => setEveryone(v => !v)} aria-expanded={everyone} className={toggle} style={{ color: 'rgb(35, 131, 226)' }}>
            {everyone ? 'Seated models only' : `All models (${more} more)`}
          </button>
        )}
        {picked.size > 0 && <button onClick={() => setPicked(new Set())} className={toggle} style={{ color: 'rgb(35, 131, 226)' }}>Show all rows</button>}
      </div>}
    </div>
  );
});

// bb/100 in its colour, one number; hovering it shows the 95% range.
export function Bb100({ m }: { m: ModelStats }) {
  const ci = ciTitle(m);
  return (
    <span className="group/ci relative inline-block font-bold" style={{ color: netColor(m.bb100) }}>
      {signedBrief(m.bb100)}
      {ci && <span role="tooltip" className="pointer-events-none absolute right-0 top-full z-20 mt-1 hidden whitespace-nowrap rounded bg-white px-2 py-1 text-[13px] font-normal group-hover/ci:block" style={{ color: TEXT, boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.2) 0px 3px 8px' }}>{ci}</span>}
    </span>
  );
}

// A row's model: logo and name, a link to its drawer (plain text on the tile, which opens the card).
function Name({ href, name, children }: { href?: string; name: string; children?: React.ReactNode }) {
  const inner = <><LLMLogo model={name} size={16} /><span translate="no" className="truncate @max-md:sr-only">{name}</span>{children}</>;
  return href
    ? <a href={href} className="flex items-center gap-2 min-w-0 hover:underline" style={{ color: TEXT }} title={name}>{inner}</a>
    : <span className="flex items-center gap-2 min-w-0" style={{ color: TEXT }} title={name}>{inner}</span>;
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
  picked,
  onPick,
  caption,
  mini,
}: {
  groups: typeof GROUPS;
  rows: ModelStats[];
  noHands: string[]; // seated, no hands yet: a row of dashes
  rest: ModelStats[]; // models with hands that are not seated: below a divider, no shading or marks
  waiting: string[]; // on the roster, not seated: a muted group below the rows
  sort: { key: string; desc: boolean };
  onSort: (c: Column) => void;
  grouped: boolean; // a group header row above the column headers
  picked: Set<string>; // rows clicked to compare; the others fade
  onPick: (name: string) => void;
  caption: string;
  mini: boolean; // the overview tile: plain headers, short rows, names as text (the tile opens the card)
}) {
  const columns = groups.flatMap(g => g.columns);
  // Just switched between tile and card: every cell's content glides with the card (GLIDE), else a
  // moved row's content slides (SLIDE).
  const [was, setWas] = useState(mini);
  const [gliding, setGliding] = useState(false);
  if (was !== mini) { setWas(mini); setGliding(true); }
  useEffect(() => {
    if (!gliding) return;
    const t = setTimeout(() => setGliding(false), GLIDE_MS + 50);
    return () => clearTimeout(t);
  }, [gliding]);
  // One y-scale for every row's sparkline.
  const lines = [...rows, ...rest].flatMap(m => recent(m).line.map(([, v]) => v));
  const [lo, hi] = [Math.min(...lines), Math.max(...lines)];
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
    if (mini) return null; // one number per cell on the tile
    const e = marks.get(c), v = c.value(m) === null ? null : c.render(m);
    if (!e || v === null || (v !== e.hi && v !== e.lo)) return null;
    const hi = v === e.hi;
    return <span className="mr-1 text-[13px] @max-md:hidden" style={{ color: MUTED }} title={hi ? 'Highest' : 'Lowest'} aria-label={hi ? 'highest' : 'lowest'}>{hi ? '▲' : '▼'}</span>;
  };
  // Every column of All stats shares the width, so its cells pad less.
  // Sticky: the header stays put while the card scrolls the rows under it.
  const head = `sticky top-0 z-10 bg-white ${mini ? 'px-1.5 md:px-3 py-0 text-[13px]' : grouped ? 'p-1 text-[14px]' : 'px-1.5 py-1.5 md:px-3 text-[14px]'}`;
  // The card's default view has five columns and room to spare, so its rows breathe; All stats packs them.
  const rowH = mini ? 'h-(--mini-row) text-[14px]' : grouped ? 'h-6' : 'h-10';
  // Columns the card adds to the tile's fade in as it opens.
  const added = (c: Column) => (!mini && c === TREND ? 'add-in' : '');
  const cell = grouped ? 'px-1' : 'px-1.5 md:px-3';
  const row = (m: ModelStats, i: number | null) => {
    // What moves the row's content: the glide, a re-sort, or the row changing place.
    const at = `${mini}|${sort.key}|${sort.desc}|${i}`;
    const move = gliding ? GLIDE : SLIDE;
    return (
    <tr
      key={m.name}
      className={`lift relative hover:z-10 ${rowH} ${mini ? '' : 'cursor-pointer'}`}
      tabIndex={mini ? undefined : 0}
      aria-selected={mini ? undefined : picked.has(m.name)}
      onClick={mini ? undefined : e => !(e.target as Element).closest('a, button') && onPick(m.name)}
      onKeyDown={mini ? undefined : e => (e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget && (e.preventDefault(), onPick(m.name))}
      style={{ opacity: picked.size && !picked.has(m.name) ? 0.35 : 1, background: picked.has(m.name) ? 'rgba(35, 131, 226, 0.08)' : undefined }}
    >
      <th scope="row" className={`${cell} text-left font-bold`}>
        <Glides at={at} move={move}>
          <Name href={mini ? undefined : modelHref(m.name)} name={m.name}>
            {m.hands < MIN_HANDS && (
              <Warning size={14} weight="bold" className="shrink-0 @max-md:hidden" style={{ color: 'rgb(140, 95, 20)' }} aria-label={`Fewer than ${MIN_HANDS} hands`} />
            )}
          </Name>
        </Glides>
      </th>
      {columns.map(c => (
        <td key={c.key} className={`${cell} ${added(c)} relative text-right whitespace-nowrap`} style={{ background: i === null ? undefined : shade(c, i) }}>
          <Glides at={at} move={move}>{c === BB100 ? <Bb100 m={m} /> : c === TREND ? <Spark m={m} lo={lo} hi={hi} /> : <>{i !== null && mark(c, m)}{c.render(m)}</>}</Glides>
        </td>
      ))}
    </tr>
    );
  };
  return (
    // Fixed layout: the table takes its panel's width and the cells truncate, so nothing scrolls sideways.
    <table className="w-full table-fixed tabular-nums text-[14px]">
      <caption className="sr-only">{caption} Column headers sort the table; the info buttons explain each stat.</caption>
      <colgroup>
        {/* Narrow panels show logos only; wider ones give names the room they need. */}
        <col className={grouped ? 'w-[44px] @md:w-[30%] @4xl:w-[15%]' : mini ? 'w-[44px] @md:w-[46%]' : 'w-[44px] @md:w-[32%] @4xl:w-[24%]'} />
        {columns.map(c => <col key={c.key} className={c === BB100 ? (grouped ? 'w-[80px]' : 'w-[80px]') : c === TREND ? 'w-[112px]' : ''} />)}
      </colgroup>
      <thead>
        {grouped && (
          <tr>
            <td />
            {groups.map(g => (
              <th key={g.label} scope="colgroup" colSpan={g.columns.length} className="px-2 pt-1 pb-0.5 text-left font-bold text-[14px] border-b border-notion" style={{ color: TEXT }}>
                {g.label}
              </th>
            ))}
          </tr>
        )}
        <tr className={`border-b border-notion ${mini ? rowH : ''}`}>
          <th scope="col" className={`${head} text-left font-medium align-bottom`} style={{ color: MUTED }}><Glides at={mini} move={GLIDE}><span className="@max-md:sr-only">Model</span></Glides></th>
          {/* The trend's label wraps: its 112px column cannot hold it, its sort mark and its info button on one line. */}
          {columns.map(c => <HeaderCell key={c.key} col={c} sort={sort} onSort={mini ? undefined : () => onSort(c)} className={`${head} ${added(c)}`} wrap={grouped || c === TREND} mini={mini} />)}
        </tr>
      </thead>
      <tbody className="divide-y divide-black/10">
        {rows.map((m, i) => row(m, i))}
        {noHands.map(name => (
          <tr key={name} className={rowH}>
            <th scope="row" className={`${cell} text-left font-bold`}>
              <span className="flex items-center gap-2 min-w-0" style={{ color: TEXT }} title={name}>
                <LLMLogo model={name} size={16} />
                <span translate="no" className="truncate @max-md:sr-only">{name}</span>
              </span>
            </th>
            {columns.map(c => <td key={c.key} className={`${cell} ${added(c)} text-right`} style={{ color: MUTED }}>{DASH}</td>)}
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
