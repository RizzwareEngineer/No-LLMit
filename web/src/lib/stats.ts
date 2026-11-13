'use client';

import { useEffect, useState } from 'react';
import { API_URL } from '@/lib/api';
import { ALL_LLMS } from '@/lib/constants';

// Shape of GET /api/stats, per docs/stats-api-contract.json. Rates are 0..1, or null when nothing
// qualified for them; bb = big blinds.
interface PositionStats {
  hands: number;
  vpip: number | null;
  pfr: number | null;
  bb100: number;
}

interface VsStats {
  pots: number;
  net_chips: number;
  hands?: number; // hands both were dealt in (older engines leave it out)
}

export interface ModelStats {
  name: string;
  model: string;
  hands: number;
  net_chips: number;
  bb100: number;
  bb100_ci: [number, number] | null; // null below 2 hands
  aiev_bb100: number | null; // null only on a replayed Profiles row (lib/timeline profilesAt)
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
  miss_rate?: number | null; // absent from older engines
  avg_latency_ms: number;
  cost_usd: number;
  biggest_pot_won: number;
  biggest_pot_lost: number;
  by_position: Record<string, PositionStats>;
  cumulative_bb: [number, number][];
  cumulative_aiev_bb?: [number, number][]; // the same curve scored by all-in EV (absent from older engines)
  vs: Record<string, VsStats>;
}

interface StatsSession {
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
  seated?: string[]; // the table's current lineup
}

// Below this many hands bb/100 is mostly noise.
export const MIN_HANDS = 500;
// A pair's bb/100 under this many hands together is drawn faint: on the local data, pairs under 100 hands
// swing to a 90th-percentile |bb/100| of 250-680 (max 1,100); from 100 hands up it is 135-210, as noisy
// as the pairs with a thousand. Pairs accrue hands far slower than models (hands together ≤ either's hands),
// so the models' 500 would leave a grid faint for a season.
export const MIN_PAIR_HANDS = 100;

// Big blinds per 100 hands from a chip net over `hands` hands; null with no hands.
export const bb100Of = (net: number, bigBlind: number, hands: number) => (hands > 0 && bigBlind > 0 ? (net / bigBlind / hands) * 100 : null);

// The leader by bb/100 among `rows` with at least MIN_HANDS hands (null when none qualifies).
export function leaderBy<T extends { hands: number; bb100: number }>(rows: T[]): T | null {
  return rows.filter(r => r.hands >= MIN_HANDS).sort((a, b) => b.bb100 - a.bb100)[0] ?? null;
}

export const TEXT = 'rgb(55, 53, 47)';
export const MUTED = 'rgba(55, 53, 47, 0.65)';

class StatsLoadingError extends Error {}

// How long to wait before asking again while the engine answers 503.
const LOADING_RETRY_MS = 10_000;
// How often to refetch while all-in EV is still computing (partial: true).
const PARTIAL_REFRESH_MS = 30_000;

async function fetchStats(): Promise<StatsResponse> {
  const res = await fetch(`${API_URL}/api/stats`); // always all time
  if (res.status === 503) throw new StatsLoadingError(); // engine still building its first snapshot
  if (!res.ok) throw new Error(`stats ${res.status}`);
  const json = await res.json();
  if (!Array.isArray(json?.models) || !Array.isArray(json?.sessions)) throw new Error('stats: unexpected shape');
  return json as StatsResponse;
}

interface StatsState {
  data: StatsResponse | null; // the last good response; kept when a later fetch fails
  loading: boolean; // the engine answered 503: its stats are still loading
  error: string | null;
}

// Fetches /api/stats, retrying every 10s while the engine answers 503 and every 30s while
// the response is partial. Errors and 503s keep the last good data; callers show them as a status beside it.
export function useStats(enabled = true): StatsState {
  const [state, setState] = useState<StatsState>({ data: null, loading: false, error: null });
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = (next: Partial<StatsState>) => !cancelled && setState(s => ({ ...s, loading: false, error: null, ...next }));
    const load = () =>
      fetchStats()
        .then(data => {
          settle({ data });
          if (data.partial && !cancelled) timer = setTimeout(load, PARTIAL_REFRESH_MS);
        })
        .catch(err => {
          if (cancelled) return;
          if (err instanceof StatsLoadingError) {
            settle({ loading: true });
            timer = setTimeout(load, LOADING_RETRY_MS);
          } else {
            settle({ error: String(err?.message || err) });
          }
        });
    load();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [enabled]);
  return state;
}

// Figures that changed between two snapshots: key -> new minus old, for keys in both. Callers pass
// figures as displayed (rounded), so a change too small to show never flashes.
export function diffValues(prev: Record<string, number>, next: Record<string, number>) {
  const out = new Map<string, number>();
  for (const k in next) if (k in prev && next[k] !== prev[k]) out.set(k, next[k] - prev[k]);
  return out;
}

export const sameValues = (a: Record<string, number>, b: Record<string, number>) =>
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

// Splits the roster for display. noHands: seated models without hands yet, listed with dashes.
// unseated: roster models neither seated nor in these stats, shown muted under "Not seated yet".
// Without a lineup (an older engine) unseated is every roster model without hands.
export function rosterGroups(models: { name: string }[], seated: string[] | undefined) {
  const has = new Set(models.map(m => m.name));
  return {
    noHands: (seated ?? []).filter(name => !has.has(name)),
    unseated: ALL_LLMS.filter(name => !has.has(name) && !seated?.includes(name)),
  };
}

// The models at the table: those in `seated` when at least two of them have stats, else all
// (a lineup still filling up). One rule for Race, Stats and Pairwise.
export function seatedModels<T extends { name: string }>(models: T[], seated: string[] | undefined) {
  const at = seated ? models.filter(m => seated.includes(m.name)) : [];
  return at.length >= 2 ? at : models;
}

// A model's bb/100 against the opponents in `names` only: the chips it won from them per 100 hands it was
// dealt in with one of them (its row's cells averaged, each weighted by their hands together), with that
// hand count. Both 0 before any hand together.
export function bb100Among(m: ModelStats, names: Set<string>, bigBlind: number) {
  let net = 0, hands = 0;
  for (const [n, v] of Object.entries(m.vs ?? {})) if (names.has(n) && n !== m.name) { net += v.net_chips; hands += v.hands ?? 0; }
  return { bb100: bb100Of(net, bigBlind, hands) ?? 0, hands, net };
}

export const NOT_SEATED = 'Not seated yet';
export const NOT_SEATED_HINT = 'Listed for future sessions; no hands played.';

// In-page link that opens a model's drawer (the page watches the hash).
export const modelHref = (name: string) => `#model=${modelSlug(name)}`;

export const modelSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const ciHalf = (m: ModelStats) => (m.bb100_ci ? (m.bb100_ci[1] - m.bb100_ci[0]) / 2 : null);

// The hover text for a bb/100 cell: its 95% interval, e.g. "95% range: +148 to +462".
export const ciTitle = (m: ModelStats) => (m.bb100_ci ? `95% range: ${signed(m.bb100_ci[0], 0)} to ${signed(m.bb100_ci[1], 0)}` : undefined);

export const DASH = '—';

export const signed = (n: number, digits = 1) =>
  `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(digits)}`;

// A magnitude for a narrow cell: 12.3 below a thousand, 12.6k above, so it never needs clipping.
const brief = (n: number, digits = 1) =>
  Math.abs(n) < 1000 ? Math.abs(n).toFixed(digits) : Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(Math.abs(n)).toLowerCase();

// signed() in brief form: +12.3, −12.6k.
export const signedBrief = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${brief(n)}`;

export const chips = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toLocaleString()}`;

export const plural = (n: number, word: string) => `${n.toLocaleString()} ${word}${n === 1 ? '' : 's'}`;

export const pct = (n: number | null) => (n === null ? DASH : `${Math.round(n * 100)}%`);

export const netColor = (n: number) =>
  n > 0 ? 'rgb(15, 123, 108)' : n < 0 ? 'rgb(200, 50, 50)' : 'rgba(55, 53, 47, 0.65)';

// Plain-language definitions shown on the stats table headers.
export const STAT_DEFINITIONS: Record<string, string> = {
  hands: 'Hands dealt to this model in the selected range.',
  bb100: 'Big blinds won per 100 hands. Hover a value for its 95% confidence interval.',
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
  miss_rate: 'Share of decisions where its own reply was still illegal or unreadable after a retry, so the engine checked or folded for it.',
};
