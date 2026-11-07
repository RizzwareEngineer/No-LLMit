'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { API_URL } from '@/lib/api';
import { ALL_LLMS } from '@/lib/constants';

// Shape of GET /api/stats, per docs/stats-api-contract.json. Rates are 0..1, or null when nothing
// qualified for them; bb = big blinds.
export interface PositionStats {
  hands: number;
  vpip: number | null;
  pfr: number | null;
  bb100: number;
}

export interface VsStats {
  pots: number;
  net_chips: number;
}

export interface ModelStats {
  name: string;
  model: string;
  hands: number;
  decisions: number;
  net_chips: number;
  bb100: number;
  bb100_ci: [number, number] | null; // null below 2 hands
  aiev_bb100: number;
  vpip: number;
  pfr: number;
  three_bet: number | null;
  af: number | null;
  cbet: number | null;
  fold_to_cbet: number | null;
  wtsd: number | null;
  wsd: number | null;
  avg_bet_pct_pot: number | null;
  fold_when_check_free: number | null;
  error_rate: number | null;
  retry_rate: number | null;
  avg_latency_ms: number;
  cost_usd: number;
  cost_per_hand_usd: number;
  biggest_pot_won: number;
  biggest_pot_lost: number;
  by_position: Record<string, PositionStats>;
  cumulative_bb: [number, number][];
  cumulative_aiev_bb?: [number, number][]; // the same curve scored by all-in EV (absent from older engines)
  vs: Record<string, VsStats>;
  // From engine #21; optional so an older engine or the bundled sample still renders.
  by_players_to_flop?: Record<'2' | '3' | '4+', FlopBucket>;
  multiway_share?: { chips_won_pct: number | null; fair_share_pct: number | null };
  heads_up_vs?: Record<string, VsStats>;
}

// Hands that reached the flop with this many players (2, 3 or 4+).
export interface FlopBucket {
  hands: number;
  won: number;
  net_chips: number;
  bb100: number | null;
}

export interface StatsSession {
  id: string;
  started_at: string;
  ended_at: string | null;
  hands: number;
}

export interface StatsResponse {
  generated_at: string;
  scope: { table_id: string; prompt_version: string; big_blind: number; hands: number; sessions: number };
  sessions: StatsSession[];
  models: ModelStats[];
  partial: boolean; // all-in EV still computing in the background; aiev_bb100 is provisional
  seated?: string[]; // the table's current lineup; only on the all-time and live session payloads
  definitions_url: string;
}

// Below this many hands bb/100 is mostly noise.
export const MIN_HANDS = 500;

export const TEXT = 'rgb(55, 53, 47)';
export const MUTED = 'rgba(55, 53, 47, 0.65)';

export class StatsLoadingError extends Error {}

// How long to wait before asking again while the engine answers 503.
const LOADING_RETRY_MS = 10_000;
// How often to refetch while all-in EV is still computing (partial: true).
const PARTIAL_REFRESH_MS = 30_000;

export async function fetchStats(session?: string): Promise<StatsResponse> {
  const query = session ? `?session=${encodeURIComponent(session)}` : '';
  const res = await fetch(`${API_URL}/api/stats${query}`);
  if (res.status === 503) throw new StatsLoadingError(); // engine still building its first snapshot
  if (!res.ok) throw new Error(`stats ${res.status}`);
  const json = await res.json();
  if (!Array.isArray(json?.models) || !Array.isArray(json?.sessions)) throw new Error('stats: unexpected shape');
  return json as StatsResponse;
}

interface StatsState {
  data: StatsResponse | null; // the last good response; kept when a later fetch fails
  sample: boolean; // true when showing the bundled fixture instead of the engine's data
  loading: boolean; // the engine answered 503: its stats are still loading
  error: string | null;
  current: boolean; // false while data, loading and error still describe a previous session
}

type Settled = Omit<StatsState, 'current'> & { session?: string };

// Fetches /api/stats, retrying every 10s while the engine answers 503 and every 30s while
// the response is partial. A new refreshKey (the hand number) refetches; the last data stays up meanwhile.
// In development any other failure falls back to the bundled sample for the same session.
export function useStats(session?: string, enabled = true, refreshKey?: number): StatsState {
  const [state, setState] = useState<Settled>({ data: null, sample: false, loading: false, error: null, session: '\0' }); // '\0': nothing settled yet
  const goodFor = useRef<string | undefined | null>(null); // the session the last good response was for
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = (next: Partial<Settled>) =>
      !cancelled && setState(s => ({ ...s, sample: false, loading: false, error: null, ...next, session }));
    const load = () =>
      fetchStats(session)
        .then(data => {
          goodFor.current = session;
          settle({ data });
          if (data.partial && !cancelled) timer = setTimeout(load, PARTIAL_REFRESH_MS);
        })
        .catch(err => {
          if (cancelled) return;
          if (err instanceof StatsLoadingError) {
            settle({ loading: true });
            timer = setTimeout(load, LOADING_RETRY_MS);
          } else if (process.env.NODE_ENV === 'development' && goodFor.current !== session) {
            // Loaded lazily so the sample never ships in the production bundle.
            const sample = session
              ? import('@/lib/stats-fixture-sessions.json').then(f => (f.default as unknown as Record<string, StatsResponse>)[session])
              : import('@/lib/stats-fixture.json').then(f => f.default as unknown as StatsResponse);
            sample.then(data => (data ? settle({ data, sample: true }) : settle({ error: 'unknown session' })));
          } else {
            settle({ error: String(err?.message || err) });
          }
        });
    load();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [session, enabled, refreshKey]);
  // Errors and 503s keep the last good data; callers show them as a status beside it.
  // Memoized so memo() children skip renders while nothing changed.
  return useMemo(() => {
    const { session: settledFor, ...rest } = state;
    return { ...rest, current: settledFor === session };
  }, [state, session]);
}

// Figures that changed between two snapshots: key -> new minus old, for keys in both. Callers pass
// figures as displayed (rounded), so a change too small to show never flashes.
export function diffValues(prev: Record<string, number>, next: Record<string, number>) {
  const out = new Map<string, number>();
  for (const k in next) if (k in prev && next[k] !== prev[k]) out.set(k, next[k] - prev[k]);
  return out;
}

const sameValues = (a: Record<string, number>, b: Record<string, number>) =>
  Object.keys(a).length === Object.keys(b).length && Object.keys(b).every(k => a[k] === b[k]);

// What changed in `values` at the last change: `deltas` (see diffValues) and `seq`, which counts
// the changes so far. It starts at 0 with no deltas, so nothing plays on first load; effects key
// on `seq` so each plays once per change, never on a re-render with the same data.
export function useChanges(values: Record<string, number>) {
  const [s, setS] = useState({ prev: values, deltas: new Map<string, number>(), seq: 0 });
  if (!sameValues(s.prev, values)) {
    // Adjusting state while rendering (React's "storing information from previous renders").
    const deltas = diffValues(s.prev, values);
    const next = deltas.size ? { prev: values, deltas, seq: s.seq + 1 } : { ...s, prev: values };
    setS(next);
    return next;
  }
  return s;
}

if (process.env.NODE_ENV === 'development') {
  const d = diffValues({ a: 1, b: 2, c: 3 }, { a: 1, b: 5, c: 1, d: 9 });
  console.assert(d.size === 2 && d.get('b') === 3 && d.get('c') === -2 && !d.has('d'), 'diffValues: changed shared keys only, new minus old');
  console.assert(diffValues({}, { a: 1 }).size === 0, 'diffValues: a first snapshot changes nothing');
  console.assert(sameValues({ a: 1 }, { a: 1 }) && !sameValues({ a: 1 }, { a: 1, b: 2 }) && !sameValues({ a: 1 }, { a: 2 }), 'sameValues');
}

// Splits the roster for display. noHands: seated models without hands yet, listed with dashes.
// unseated: roster models neither seated nor in these stats, shown muted under "Not seated yet".
// Without a lineup (older engine, sample data, past session) unseated is every roster model without hands.
export function rosterGroups(models: { name: string }[], seated: string[] | undefined) {
  const has = new Set(models.map(m => m.name));
  return {
    noHands: (seated ?? []).filter(name => !has.has(name)),
    unseated: ALL_LLMS.filter(name => !has.has(name) && !seated?.includes(name)),
  };
}

// The models at the table: those in `seated` when at least two of them have stats, else all
// (a past session, or a lineup still filling up). One rule for Race, Stats and Pairwise.
export function seatedModels<T extends { name: string }>(models: T[], seated: string[] | undefined) {
  const at = seated ? models.filter(m => seated.includes(m.name)) : [];
  return at.length >= 2 ? at : models;
}

// Net chips a model won from the opponents in `names` only, so a row's net is the sum of what it shows.
export const netAmong = (m: ModelStats, names: Set<string>) =>
  Object.entries(m.vs ?? {}).reduce((sum, [n, v]) => (names.has(n) && n !== m.name ? sum + v.net_chips : sum), 0);

export const NOT_SEATED = 'Not seated yet';
export const NOT_SEATED_HINT = 'Listed for future sessions; no hands played.';

// In-page link that opens a model's drawer (the page watches the hash).
export const modelHref = (name: string) => `#model=${modelSlug(name)}`;

export const modelSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const ciHalf = (m: ModelStats) => (m.bb100_ci ? (m.bb100_ci[1] - m.bb100_ci[0]) / 2 : null);

// The hover text for a bb/100 cell: its 95% interval, e.g. "95% range: +148 to +462".
export const ciTitle = (m: ModelStats) => (m.bb100_ci ? `95% range: ${signed(m.bb100_ci[0], 0)} to ${signed(m.bb100_ci[1], 0)}` : undefined);

// Arena-style rank spread: the best and worst rank each model's 95% bb/100 interval allows among
// `models`. Best = 1 + the models whose interval lies wholly above its own; worst = n − the models
// wholly below it. A model without an interval counts as its point estimate.
export function rankSpread(models: ModelStats[]) {
  const iv = (m: ModelStats) => m.bb100_ci ?? [m.bb100, m.bb100];
  return new Map(models.map(m => {
    const [lo, hi] = iv(m);
    const above = models.filter(o => iv(o)[0] > hi).length;
    const below = models.filter(o => iv(o)[1] < lo).length;
    return [m.name, [1 + above, models.length - below] as const];
  }));
}

export const DASH = '—';

export const signed = (n: number, digits = 1) =>
  `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(digits)}`;

// A magnitude for a narrow cell: 12.3 below a thousand, 12.6k above, so it never needs clipping.
export const brief = (n: number, digits = 1) =>
  Math.abs(n) < 1000 ? Math.abs(n).toFixed(digits) : Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(Math.abs(n)).toLowerCase();

// signed() in brief form: +12.3, −12.6k.
export const signedBrief = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${brief(n)}`;

export const chips = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toLocaleString()}`;

export const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

export const pct = (n: number | null) => (n === null ? DASH : `${Math.round(n * 100)}%`);

export const netColor = (n: number) =>
  n > 0 ? 'rgb(15, 123, 108)' : n < 0 ? 'rgb(200, 50, 50)' : 'rgba(55, 53, 47, 0.65)';

// Plain-language definitions shown on the stats table headers.
// shortcut: written here because docs/stats.md does not exist yet; sync the wording once it lands.
export const STAT_DEFINITIONS: Record<string, string> = {
  hands: 'Hands dealt to this model in the selected range.',
  bb100: 'Big blinds won per 100 hands. Hover a value for its 95% confidence interval.',
  trend: 'Running bb/100 over the model\'s last 50 hands, on one scale for every row; the dot is now. Sorts by bb/100 won within those hands.',
  rank: 'Rank spread: the best and worst rank the 95% intervals allow. Models whose intervals overlap may be in either order.',
  aiev_bb100: 'bb/100 with all-in pots credited at the equity each player had when the money went in, which strips out run-out luck.',
  vpip: 'Voluntarily put money in pot: share of hands where it called or raised preflop (posting blinds does not count).',
  pfr: 'Preflop raise: share of hands where it raised preflop.',
  three_bet: 'Share of chances to re-raise a preflop raise where it did.',
  af: 'Aggression factor: bets and raises divided by calls. 1 is balanced; above 3 is aggressive.',
  cbet: 'Continuation bet: share of flops where the preflop raiser bet when it had the chance.',
  fold_to_cbet: 'Share of continuation bets faced that it folded to.',
  wtsd: 'Went to showdown: share of hands that saw the flop and reached showdown.',
  wsd: 'Won money at showdown: share of showdowns it won.',
  fold_when_check_free: 'Share of decisions where it folded although checking was free. Always a mistake.',
  error_rate: 'Share of decisions where the reply was unusable (unparseable, illegal or timed out) and the engine acted for it.',
  cost_per_hand_usd: 'API cost per hand played, in US dollars.',
  avg_latency_ms: 'Average time the model took to answer one decision, in seconds.',
  hu_bb100: 'Big blinds won per 100 hands over flops only two players saw. It counts blinds folded by the other players, which the cells leave out, so it can differ from the row\'s chips.',
  mw_bb: 'Big blinds won per 100 hands over all flops with 3 or more players. The table is sorted by it.',
  mw_hands: 'Hands where this model saw a flop with 3 or more players.',
  mw_won: 'Of those hands, how many it won at least part of a pot.',
  mw_win: 'Won ÷ hands, over pots that reached the flop with 3 or more players.',
  mw_bb100_3: 'Big blinds won per 100 hands, over flops seen by exactly 3 players.',
  mw_bb100_4: 'Big blinds won per 100 hands, over flops seen by 4 or more players.',
  mw_share: 'Share of the chips in its multiway pots that it won, against its fair share (each pot split evenly among the players who saw the flop, weighted by pot size). Green when above.',
};
