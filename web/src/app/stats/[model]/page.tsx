'use client';

import { useParams } from 'next/navigation';
import { MotionConfig } from 'motion/react';
import LLMLogo from '@/components/LLMLogo';
import StatsPanel, { SampleBadge, SmallSampleNote, StatsMessage } from '@/components/StatsPanel';
import CumulativeChart from '@/components/CumulativeChart';
import HeadToHead from '@/components/HeadToHead';
import { DASH, MIN_HANDS, MUTED, ModelStats, TEXT, ciHalf, modelSlug, netColor, pct, signed, chips, useStats } from '@/lib/stats';
const POSITION_ORDER = ['UTG', 'UTG+1', 'UTG+2', 'MP', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'];

function Fact({ label, value, color }: { label: string; value: React.ReactNode; color?: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider" style={{ color: MUTED }}>{label}</dt>
      <dd className="text-[15px] font-bold tabular-nums" style={{ color: color ?? TEXT }}>{value}</dd>
    </div>
  );
}

// Accepts the display-name slug in any case, the URL-encoded name, or the model id.
function findModel(models: ModelStats[], param: string) {
  let raw = param;
  try { raw = decodeURIComponent(param); } catch { /* malformed escape: use as is */ }
  const want = modelSlug(raw);
  return models.find(x => modelSlug(x.name) === want || modelSlug(x.model) === want || x.model.toLowerCase() === raw.toLowerCase());
}

export default function ModelStatsPage() {
  const { model: slug } = useParams<{ model: string }>();
  const { data, sample, loading, error } = useStats();

  if (!data) return <StatsMessage error={error} loading={loading} />;

  const m = findModel(data.models, slug);
  if (!m) return <p className="text-[14px]" style={{ color: MUTED }}>No stats for this model yet.</p>;

  const rank = (p: string) => (POSITION_ORDER.indexOf(p) + 1 || 99);
  const positions = Object.entries(m.by_position ?? {}).sort((a, b) => rank(a[0]) - rank(b[0]));

  return (
    <MotionConfig reducedMotion="user">
      <div className="mb-6 flex items-center gap-3">
        <LLMLogo model={m.name} size={40} />
        <div>
          <h1 className="text-[24px] font-bold leading-tight" style={{ color: TEXT }}>
            {m.name} {sample && <SampleBadge />}
          </h1>
          <p className="text-[13px] font-mono" style={{ color: MUTED }}>{m.model}</p>
        </div>
      </div>

      <dl className="mb-6 flex flex-wrap gap-x-8 gap-y-3">
        <Fact
          label="bb/100"
          value={<>{signed(m.bb100)} <span className="font-normal text-[13px]" style={{ color: MUTED }}>± {ciHalf(m)?.toFixed(1) ?? DASH}</span></>}
          color={netColor(m.bb100)}
        />
        <Fact label="Hands" value={m.hands.toLocaleString()} />
        <Fact label="Net" value={chips(m.net_chips)} color={netColor(m.net_chips)} />
        <Fact label="All-in EV bb/100" value={signed(m.aiev_bb100)} />
      </dl>
      {m.hands < MIN_HANDS && (
        <SmallSampleNote>Fewer than {MIN_HANDS} hands, so this win rate is mostly luck so far.</SmallSampleNote>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <StatsPanel title="Cumulative big blinds" className="lg:col-span-2">
          <CumulativeChart models={[m]} selected={m.name} />
        </StatsPanel>

        <StatsPanel title="By position">
          {positions.length === 0 ? (
            <p className="text-[13px]" style={{ color: MUTED }}>No position data yet.</p>
          ) : (
          <table className="w-full text-[12px] tabular-nums">
            <caption className="sr-only">{m.name} results by table position</caption>
            <thead>
              <tr className="border-b border-notion" style={{ color: MUTED }}>
                <th scope="col" className="text-left font-medium p-2">Position</th>
                <th scope="col" className="text-right font-medium p-2">Hands</th>
                <th scope="col" className="text-right font-medium p-2">VPIP</th>
                <th scope="col" className="text-right font-medium p-2">PFR</th>
                <th scope="col" className="text-right font-medium p-2">bb/100</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/10">
              {positions.map(([pos, p]) => (
                <tr key={pos}>
                  <th scope="row" className="text-left font-medium p-2">{pos}</th>
                  <td className="text-right p-2">{p.hands}</td>
                  <td className="text-right p-2">{pct(p.vpip)}</td>
                  <td className="text-right p-2">{pct(p.pfr)}</td>
                  <td className="text-right p-2 font-bold" style={{ color: netColor(p.bb100) }}>{signed(p.bb100)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          )}
        </StatsPanel>

        <StatsPanel title="Head to head">
          <HeadToHead models={data.models} focus={m} />
        </StatsPanel>

        <StatsPanel title="Biggest pots">
          <dl className="flex gap-8">
            <Fact label="Won" value={`¤${m.biggest_pot_won.toLocaleString()}`} color={netColor(1)} />
            <Fact label="Lost" value={`¤${m.biggest_pot_lost.toLocaleString()}`} color={netColor(-1)} />
          </dl>
        </StatsPanel>

        <StatsPanel title="Errors and cost">
          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <Fact label="Error rate" value={pct(m.error_rate)} />
            <Fact label="Retry rate" value={pct(m.retry_rate)} />
            <Fact label="Fold when check free" value={pct(m.fold_when_check_free)} />
            <Fact label="Avg latency" value={`${(m.avg_latency_ms / 1000).toFixed(1)} s`} />
            <Fact label="Total cost" value={`$${m.cost_usd.toFixed(2)}`} />
            <Fact label="Cost/hand" value={`$${m.cost_per_hand_usd.toFixed(4)}`} />
          </dl>
        </StatsPanel>
      </div>
    </MotionConfig>
  );
}
