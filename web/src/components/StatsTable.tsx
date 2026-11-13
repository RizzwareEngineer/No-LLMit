'use client';

import { Fragment, memo, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { motion, type Transition } from 'motion/react';
import { CaretDown, CaretUp, CaretUpDown, Info, Warning } from '@phosphor-icons/react';
import LLMLogo from '@/components/LLMLogo';
import { GLIDE, GLIDE_MS, NONE } from '@/components/Section';
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
// Misses are rare, so one decimal: a whole percent would show 0.4% as 0%. A dash from an engine without them.
export const missPct = (m: ModelStats) => (m.miss_rate == null ? DASH : `${(m.miss_rate * 100).toFixed(1)}%`);

// A row's slide to its new place when the order changes, like Profits & Losses' rows.
export const SLIDE = { duration: 0.3 } as const;

// A cell's content, moved by motion layout (Chrome ignores transforms on a table row, so the cells'
// content moves, not the rows). On the tile↔card glide it travels with the card at its own size (the
// box around it grows; the text never shrinks and grows back); when its row changes place it slides
// there (SLIDE). `at` is what moves it: measured only when that changes.
function Glides({ at, move, children }: { at: string | boolean; move: Transition; children: React.ReactNode }) {
  return <motion.span layout="position" layoutDependency={at} transition={move} className="inline-block max-w-full align-middle">{children}</motion.span>;
}

// The card shows every group, under a row of group headers; the overview tile its compact columns (MINI).
const GROUPS: { label: string; columns: Column[] }[] = [
  {
    label: 'Results',
    columns: [
      { key: 'hands', label: 'Hands', value: m => m.hands, render: m => m.hands.toLocaleString() },
      BB100,
      { key: 'aiev_bb100', label: 'All-in adj.', value: m => m.aiev_bb100, render: m => (m.aiev_bb100 === null ? DASH : signedBrief(m.aiev_bb100)) },
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
    ],
  },
  {
    label: 'Mistakes',
    columns: [
      { key: 'fold_when_check_free', label: 'Fold when check free', value: m => m.fold_when_check_free, render: m => pct(m.fold_when_check_free), lowerIsBetter: true },
      { key: 'miss_rate', label: 'Misses', value: m => m.miss_rate ?? null, render: m => missPct(m), lowerIsBetter: true },
    ],
  },
];
const COLUMNS = GROUPS.flatMap(g => g.columns);
// The overview tile: hands, then three style stats. No bb/100: Trends beside it shows it (rows stay in bb/100 order).
const byKey = (k: string) => COLUMNS.find(c => c.key === k)!;
const MINI = [{ label: 'Core', columns: [byKey('hands'), byKey('vpip'), byKey('pfr'), byKey('af')] }];
// Profiles' tile around its longest name, at its widest: the logo and its gap (24), the name's padding (16),
// the number columns (204) and the tile's padding (32). StatsSections sizes the tile with it.
export const MINI_CHROME = 24 + 16 + 204 + 32;

// A column header with its definition on hover or focus. Without `onSort` (the tile) it is a plain label
// and `sort` only marks the column the rows are ordered by.
// `mini` (Profiles' tile and card): the header glides between the two, the tile's being the label alone.
// The label flows inline: a long one wraps between its words, never inside one (C-bet at its hyphen), the sort mark
// stays on its last word, and the info button sits beside it when there is room, else under it.
function HeaderCell({ col, sort, onSort, className, mini, move }: { col: { key: string; label: string }; sort: { key: string; desc: boolean }; onSort?: () => void; className: string; mini: boolean; move: Transition }) {
  const [open, setOpen] = useState(false);
  const tipId = useId();
  // Opened, the definition shifts sideways to stay whole inside the box that would cut it (the card's scroller; a
  // phone's table, which scrolls sideways under its names), before it is painted.
  const tip = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    const t = tip.current;
    if (!open || !t) return;
    t.style.translate = '';
    let box = t.parentElement;
    while (box && getComputedStyle(box).overflowX === 'visible') box = box.parentElement;
    if (!box) return;
    const b = box.getBoundingClientRect(), r = t.getBoundingClientRect();
    t.style.translate = `${Math.max(0, b.left + 8 - r.left) || -Math.max(0, r.right - b.right + 8)}px`;
  }, [open]);
  const active = sort.key === col.key;
  const mark = { size: 12, className: 'inline ml-0.5 align-[-1px]', 'aria-hidden': true } as const;
  const words = col.label.split(' ');
  const label = (
    <>
      {onSort && (
        <button onClick={onSort} className="hover:underline text-right">
          {words.map((w, i) => (
            <Fragment key={i}>
              {i > 0 && ' '}
              <span className="whitespace-nowrap">
                {w}
                {i === words.length - 1 && (active ? (sort.desc ? <CaretDown {...mark} weight="bold" /> : <CaretUp {...mark} weight="bold" />) : <CaretUpDown {...mark} className={`${mark.className} opacity-40`} />)}
              </span>
            </Fragment>
          ))}
        </button>
      )}{' '}
      <button
        onClick={() => setOpen(true)} // not a toggle: hover and focus already opened it
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={e => e.key === 'Escape' && setOpen(false)}
        aria-label={`What ${col.label} means`}
        aria-expanded={open}
        aria-describedby={tipId}
        className="inline-block p-1.5 -m-1 align-middle opacity-60 hover:opacity-100"
      >
        <Info size={12} aria-hidden />
      </button>
    </>
  );
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.desc ? 'descending' : 'ascending') : onSort ? 'none' : undefined}
      className={`${className} font-medium text-right align-bottom leading-tight`}
      style={{ color: active ? TEXT : MUTED }}
      onMouseEnter={mini ? undefined : () => setOpen(true)}
      onMouseLeave={mini ? undefined : () => setOpen(false)}
    >
      <Glides at={mini} move={move}>{mini ? col.label : label}</Glides>
      {/* Always in the DOM so aria-describedby resolves; hidden until opened. */}
      {!mini && (
        <span
          ref={tip}
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

// The seated models' stats, every stat at once, sortable; "All models" appends everyone else below a
// divider. A card too narrow for every column (a phone) scrolls it sideways under the names.
// Memoized: the stats screens re-render on the History zoom, and the table only changes with its data.
// `pending`: models in range with no hands yet at the hand History is replaying, shown as dash rows.
// `mini`: the overview tile, the same table with fewer columns, fixed short rows and no controls;
// opening the card keeps this table and adds the rest around it.
export type TableView = { sort: { key: string; desc: boolean }; everyone: boolean; picked: Set<string> };
export const TABLE_VIEW: TableView = { sort: { key: 'bb100', desc: true }, everyone: false, picked: new Set() };
// `view`: the sort, "All models" and the picked rows, shared (Profiles' opened tile and its card show the same); the
// overview tile keeps the default.
export default memo(function StatsTable({ models, seated, pending = [], mini = false, snap = false, view }: { models: ModelStats[]; seated?: string[]; pending?: string[]; mini?: boolean; snap?: boolean; view: [TableView, React.Dispatch<React.SetStateAction<TableView>>] }) {
  const [shared, setView] = view;
  const { sort, everyone, picked } = mini ? TABLE_VIEW : shared;
  const setSort = (f: (s: TableView['sort']) => TableView['sort']) => setView(v => ({ ...v, sort: f(v.sort) }));
  const setEveryone = (f: (e: boolean) => boolean) => setView(v => ({ ...v, everyone: f(v.everyone) }));
  // Rows clicked to compare: the rest fade (Sports-Reference's row isolation).
  const setPicked = (p: Set<string>) => setView(v => ({ ...v, picked: p }));
  const isolate = (name: string) => setView(v => { const n = new Set(v.picked); if (!n.delete(name)) n.add(name); return { ...v, picked: n }; });
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
  const toggle = 'text-[14px] font-medium hover:underline'; // controls: 14px medium, like Open ↓ and the segmented buttons

  return (
    <div className="flex-1 min-h-0 flex flex-col">
      <div className={`@container relative min-w-0 ${mini ? '' : 'max-md:overflow-x-auto'}`}>
        <Grid groups={mini ? MINI : GROUPS} rows={atTable} noHands={noHands} rest={everyone && !mini ? rest : []} waiting={!mini && (everyone || !seated) ? unseated : []} sort={sort} onSort={toggleSort} picked={picked} onPick={isolate} mini={mini} snap={snap} />
      </div>
      {!mini && <div className="add-in mt-2 flex flex-wrap gap-x-5 gap-y-1">
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

// bb/100 in its colour, one number at the other figures' weight; hovering it shows the 95% range (above it on a
// group's last row, so it never hangs below the table and grows the card's scroller).
function Bb100({ m }: { m: ModelStats }) {
  const ci = ciTitle(m);
  return (
    <span className="group/ci relative inline-block" style={{ color: netColor(m.bb100) }}>
      {signedBrief(m.bb100)}
      {ci && <span role="tooltip" className="pointer-events-none absolute right-0 top-full z-20 mt-1 [tr:last-child_&]:top-auto [tr:last-child_&]:bottom-full [tr:last-child_&]:mt-0 [tr:last-child_&]:mb-1 hidden whitespace-nowrap rounded bg-white px-2 py-1 text-[13px] font-normal group-hover/ci:block" style={{ color: TEXT, boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.2) 0px 3px 8px' }}>{ci}</span>}
    </span>
  );
}

// A row's model: logo and name, a link to its drawer (plain text on the tile, which opens the card).
// The overview tile keeps names down to a 288px table (truncated), so a short window still says who's who; a phone's
// card keeps 6.5rem of each (its table scrolls sideways under them); a wider card shows them whole.
// The tile's name shrinks to leave the rest of its row room: the logo and gap (24px), the cell padding (8px) and the four
// number columns at their widest (about 185px: a 5-digit hands count, 100% rates and a 2-digit AF), so 14rem. 12rem clipped
// the AF column on a 390px phone early in a replay, when rates read 100%; 9.5rem clipped it with any long name.
const nameFit = (mini: boolean) => (mini ? '@max-2xs:sr-only max-w-[calc(100cqw-14rem)]' : '@max-md:max-w-[6.5rem]');
function Name({ href, name, mini = false, children }: { href?: string; name: string; mini?: boolean; children?: React.ReactNode }) {
  const inner = <><LLMLogo model={name} size={16} /><span translate="no" className={`truncate ${nameFit(mini)}`}>{name}</span>{children}</>;
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
  picked,
  onPick,
  mini,
  snap,
}: {
  groups: typeof GROUPS;
  rows: ModelStats[];
  noHands: string[]; // seated, no hands yet: a row of dashes
  rest: ModelStats[]; // models with hands that are not seated: below a divider, no shading or marks
  waiting: string[]; // on the roster, not seated: a muted group below the rows
  sort: { key: string; desc: boolean };
  onSort: (c: Column) => void;
  picked: Set<string>; // rows clicked to compare; the others fade
  onPick: (name: string) => void;
  mini: boolean; // the overview tile: plain headers, short rows, names as text (the tile opens the card)
  snap: boolean; // switch between tile and card without gliding (the stage is hidden under the card)
}) {
  const columns = groups.flatMap(g => g.columns);
  // Just switched between tile and card: every cell's content glides with the card (GLIDE), else a
  // moved row's content slides (SLIDE). A snap (under the card, on close) moves nothing: the card hands over to it at once.
  const [was, setWas] = useState(mini);
  const [gliding, setGliding] = useState(false);
  if (was !== mini) { setWas(mini); setGliding(!snap); }
  const glide = snap ? NONE : GLIDE;
  useEffect(() => {
    if (!gliding) return;
    const t = setTimeout(() => setGliding(false), GLIDE_MS + 50);
    return () => clearTimeout(t);
  }, [gliding]);
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
  // Sticky: the header stays put while the card scrolls the rows under it.
  const head = `sticky top-0 z-10 bg-white text-[13px] ${mini ? 'px-1 @sm:px-2 py-0' : 'px-2 py-1.5'}`; // column headers: 13px muted, tile and card
  // The card's rows breathe; the tile's split its height evenly from md (a phone's tile is as tall as its rows).
  const rowH = mini ? 'h-9 md:h-(--mini-row) text-[14px]' : 'h-10';
  // Columns the card adds to the tile's fade in as it opens.
  const added = (c: Column) => (!mini && !MINI[0].columns.includes(c) ? 'add-in' : '');
  // The tile pads by its own width (a narrow tile keeps every header whole).
  const cell = mini ? 'px-1 @sm:px-2' : 'px-2';
  // Under md the card scrolls sideways (a phone, or a laptop at 200% zoom): the names stay, in a sticky Model column.
  const pin = mini ? '' : 'max-md:sticky max-md:left-0 max-md:bg-white';
  const nameCell = `${cell} ${pin} ${pin && 'max-md:z-[1]'} w-px whitespace-nowrap text-left font-bold`;
  const row = (m: ModelStats, i: number | null) => {
    // What moves the row's content: the glide, a re-sort, or the row changing place.
    const at = `${mini}|${sort.key}|${sort.desc}|${i}`;
    const move = snap ? NONE : gliding ? GLIDE : SLIDE;
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
      <th scope="row" className={nameCell}>
        <Glides at={at} move={move}>
          <Name href={mini ? undefined : modelHref(m.name)} name={m.name} mini={mini}>
            {m.hands < MIN_HANDS && !mini && (
              <Warning size={14} weight="bold" className="shrink-0 @max-md:hidden" style={{ color: 'rgb(140, 95, 20)' }} aria-label={`Fewer than ${MIN_HANDS} hands`} />
            )}
          </Name>
        </Glides>
      </th>
      {columns.map(c => (
        <td key={c.key} className={`${cell} ${added(c)} relative text-right whitespace-nowrap`} style={{ background: i === null ? undefined : shade(c, i) }}>
          <Glides at={at} move={move}>{c === BB100 ? <Bb100 m={m} /> : <>{i !== null && mark(c, m)}{c.render(m)}</>}</Glides>
        </td>
      ))}
    </tr>
    );
  };
  return (
    // Auto layout: the Model column hugs the names (w-px) and the figures share the rest, each column at least as
    // wide as its figures and its header's longest word (headers wrap), so nothing is clipped. Where that is wider
    // than the card (a phone), the table scrolls sideways.
    <table className="w-full table-auto tabular-nums text-[14px]">
      <caption className="sr-only">Profiles per model. Column headers sort the table; the info buttons explain each stat.</caption>
      <thead>
        {!mini && (
          <tr className="add-in">
            <td className={pin} />
            {groups.map(g => (
              <th key={g.label} scope="colgroup" colSpan={g.columns.length} className="px-2 pt-1 pb-0.5 text-left font-medium text-[13px] border-b border-notion" style={{ color: TEXT }}>
                {g.label}
              </th>
            ))}
          </tr>
        )}
        <tr className={`border-b border-notion ${mini ? rowH : ''}`}>
          <th scope="col" className={`${head} ${pin} text-left font-medium align-bottom`} style={{ color: MUTED }}><Glides at={mini} move={glide}><span className={mini ? '@max-2xs:sr-only' : ''}>Model</span></Glides></th>
          {columns.map(c => <HeaderCell key={c.key} col={c} sort={sort} onSort={mini ? undefined : () => onSort(c)} className={`${head} ${added(c)}`} mini={mini} move={glide} />)}
        </tr>
      </thead>
      <tbody className="divide-y divide-black/10">
        {rows.map((m, i) => row(m, i))}
        {noHands.map(name => (
          <tr key={name} className={rowH}>
            <th scope="row" className={nameCell}><Name name={name} mini={mini} /></th>
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
            <td colSpan={columns.length + 1} className={`${cell} pt-2 text-[13px]`}>
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
