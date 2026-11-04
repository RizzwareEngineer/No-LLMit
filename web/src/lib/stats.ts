'use client';

import { useEffect, useState } from 'react';
import { API_URL } from '@/lib/api';

// Shape of GET /api/stats, per docs/stats-api-contract.json. Rates are 0..1; bb = big blinds.
export interface PositionStats {
  hands: number;
  vpip: number;
  pfr: number;
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
  bb100_ci: [number, number];
  aiev_bb100: number;
  vpip: number;
  pfr: number;
  three_bet: number;
  af: number;
  cbet: number;
  fold_to_cbet: number;
  wtsd: number;
  wsd: number;
  avg_bet_pct_pot: number;
  fold_when_check_free: number;
  error_rate: number;
  retry_rate: number;
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
  definitions_url: string;
}

// Below this many hands bb/100 is mostly noise.
export const MIN_HANDS = 500;

export async function fetchStats(session?: string): Promise<StatsResponse> {
  const query = session ? `?session=${encodeURIComponent(session)}` : '';
  const res = await fetch(`${API_URL}/api/stats${query}`);
  if (!res.ok) throw new Error(`stats ${res.status}`);
  const json = await res.json();
  if (!Array.isArray(json?.models) || !Array.isArray(json?.sessions)) throw new Error('stats: unexpected shape');
  return json as StatsResponse;
}

interface StatsState {
  data: StatsResponse | null;
  sample: boolean; // true when showing the bundled fixture instead of the engine's data
  error: string | null;
}

// Fetches /api/stats. In development a failed fetch falls back to the bundled sample.
export function useStats(session?: string): StatsState {
  const [state, setState] = useState<StatsState>({ data: null, sample: false, error: null });
  useEffect(() => {
    let cancelled = false;
    fetchStats(session)
      .then(data => !cancelled && setState({ data, sample: false, error: null }))
      .catch(err => {
        if (cancelled) return;
        if (process.env.NODE_ENV === 'development') {
          // Loaded lazily so the sample never ships in the production bundle.
          import('@/lib/stats-fixture.json').then(f => !cancelled && setState({ data: f.default as unknown as StatsResponse, sample: true, error: null }));
        } else {
          setState({ data: null, sample: false, error: String(err?.message || err) });
        }
      });
    return () => { cancelled = true; };
  }, [session]);
  return state;
}

export const modelSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const ciHalf = (m: ModelStats) => (m.bb100_ci[1] - m.bb100_ci[0]) / 2;

export const signed = (n: number, digits = 1) =>
  `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(digits)}`;

export const chips = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}¤${Math.abs(n).toLocaleString()}`;

export const pct = (n: number) => `${Math.round(n * 100)}%`;

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
  af: 'Aggression factor: (bets + raises) / calls after the flop. Above 1 means it bets more than it calls.',
  cbet: 'Continuation bet: share of flops where the preflop raiser bet when it had the chance.',
  fold_to_cbet: 'Share of continuation bets faced that it folded to.',
  wtsd: 'Went to showdown: share of hands that saw the flop and reached showdown.',
  wsd: 'Won money at showdown: share of showdowns it won.',
  fold_when_check_free: 'Share of decisions where it folded although checking was free. Always a mistake.',
  error_rate: 'Share of decisions where the reply was unusable (unparseable, illegal or timed out) and the engine acted for it.',
  cost_per_hand_usd: 'API cost per hand played, in US dollars.',
};
