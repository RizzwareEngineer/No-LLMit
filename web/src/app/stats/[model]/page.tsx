'use client';

import { useParams } from 'next/navigation';
import { MotionConfig } from 'motion/react';
import { Warning } from '@phosphor-icons/react';
import LLMLogo from '@/components/LLMLogo';
import StatsPanel, { SampleBadge } from '@/components/StatsPanel';
import CumulativeChart from '@/components/CumulativeChart';
import HeadToHead from '@/components/HeadToHead';
import { MIN_HANDS, ciHalf, modelSlug, netColor, pct, signed, chips, useStats } from '@/lib/stats';

const TEXT = 'rgb(55, 53, 47)';
const MUTED = 'rgba(55, 53, 47, 0.65)';
const POSITION_ORDER = ['UTG', 'UTG+1', 'UTG+2', 'MP', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'];

function Fact({ label, value, color }: { label: string; value: React.ReactNode; color?: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider" style={{ color: MUTED }}>{label}</dt>
      <dd className="text-[15px] font-bold tabular-nums" style={{ color: color ?? TEXT }}>{value}</dd>
    </div>
  );
}

export default function ModelStatsPage() {
  const { model: slug } = useParams<{ model: string }>();
  const { data, sample, error } = useStats();

  if (error) return <p className="text-[14px]" style={{ color: MUTED }}>Stats are unavailable right now ({error}).</p>;
  if (!data) return <p className="text-[14px]" style={{ color: MUTED }}>Loading stats…</p>;

  const m = data.models.find(x => modelSlug(x.name) === slug);
  if (!m) return <p className="text-[14px]" style={{ color: MUTED }}>No stats for this model yet.</p>;

  const rank = (p: string) => (POSITION_ORDER.indexOf(p) + 1 || 99);
  const positions = Object.entries(m.by_position).sort((a, b) => rank(a[0]) - rank(b[0]));

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
          value={<>{signed(m.bb100)} <span className="font-normal text-[13px]" style={{ color: MUTED }}>± {ciHalf(m).toFixed(1)}</span></>}
          color={netColor(m.bb100)}
        />
        <Fact label="Hands" value={m.hands.toLocaleString()} />
        <Fact label="Net" value={chips(m.net_chips)} color={netColor(m.net_chips)} />
        <Fact label="All-in EV bb/100" value={signed(m.aiev_bb100)} />
      </dl>
      {m.hands < MIN_HANDS && (
        <p className="mb-6 flex items-start gap-2 rounded p-2 text-[13px]" style={{ background: 'rgba(203, 145, 47, 0.12)', color: TEXT }}>
          <Warning size={16} weight="bold" className="shrink-0 mt-0.5" style={{ color: 'rgb(140, 95, 20)' }} aria-hidden />
          Fewer than {MIN_HANDS} hands, so this win rate is mostly luck so far.
        </p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <StatsPanel title="Cumulative big blinds" className="lg:col-span-2">
          <CumulativeChart models={[m]} selected={m.name} />
        </StatsPanel>

        <StatsPanel title="By position">
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
