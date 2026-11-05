'use client';

import { useEffect, useState } from 'react';
import { API_URL } from '@/lib/api';

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
  vs: Record<string, VsStats>;
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
// the response is partial.
// In development any other failure falls back to the bundled sample for the same session.
export function useStats(session?: string, enabled = true): StatsState {
  const [state, setState] = useState<Settled>({ data: null, sample: false, loading: false, error: null, session: '\0' }); // '\0': nothing settled yet
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const settle = (next: Partial<Settled>) =>
      !cancelled && setState(s => ({ ...s, sample: false, loading: false, error: null, ...next, session }));
    const load = () =>
      fetchStats(session)
        .then(data => {
          settle({ data });
          if (data.partial && !cancelled) timer = setTimeout(load, PARTIAL_REFRESH_MS);
        })
        .catch(err => {
          if (cancelled) return;
          if (err instanceof StatsLoadingError) {
            settle({ loading: true });
            timer = setTimeout(load, LOADING_RETRY_MS);
          } else if (process.env.NODE_ENV === 'development') {
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
  }, [session, enabled]);
  const { session: settledFor, ...rest } = state;
  return { ...rest, current: settledFor === session };
}

export const modelSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const ciHalf = (m: ModelStats) => (m.bb100_ci ? (m.bb100_ci[1] - m.bb100_ci[0]) / 2 : null);

export const DASH = '—';

export const signed = (n: number, digits = 1) =>
  `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(digits)}`;

export const chips = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}¤${Math.abs(n).toLocaleString()}`;

export const pct = (n: number | null) => (n === null ? DASH : `${Math.round(n * 100)}%`);

export const netColor = (n: number) =>
  n > 0 ? 'rgb(15, 123, 108)' : n < 0 ? 'rgb(200, 50, 50)' : 'rgba(55, 53, 47, 0.65)';

// Plain-language definitions shown on the stats table headers.
// shortcut: written here because docs/stats.md does not exist yet; sync the wording once it lands.
export const STAT_DEFINITIONS: Record<string, string> = {
  hands: 'Hands dealt to this model in the selected range.',
  bb100: 'Big blinds won per 100 hands. ± is the half-width of the 95% confidence interval.',
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
};
