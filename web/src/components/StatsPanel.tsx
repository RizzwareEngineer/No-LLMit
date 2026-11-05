import { Warning } from '@phosphor-icons/react';
import CornerBorders from '@/components/CornerBorders';
import { MUTED, TEXT } from '@/lib/stats';

// Card in the same style as the main page's Profits & Losses panel.
export default function StatsPanel({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section
      className={`relative bg-white rounded ${className}`}
      style={{ boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.1) 0px 2px 4px' }}
    >
      <CornerBorders />
      <h2 className="text-xs font-bold uppercase tracking-wider p-3 border-b border-notion" style={{ color: TEXT }}>{title}</h2>
      <div className="p-3">{children}</div>
    </section>
  );
}

export function SampleBadge() {
  return (
    <span
      className="inline-block rounded px-1.5 py-0.5 text-[11px] font-medium align-middle"
      style={{ background: 'rgba(203, 145, 47, 0.15)', color: 'rgb(140, 95, 20)' }}
      title="The engine's /api/stats did not answer, so this page shows bundled sample data."
    >
      sample data<span className="sr-only">: the engine did not answer, so these numbers are made up</span>
    </span>
  );
}

export function SmallSampleNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-4 flex items-start gap-2 rounded p-2 text-[13px]" style={{ background: 'rgba(203, 145, 47, 0.12)', color: TEXT }}>
      <Warning size={16} weight="bold" className="shrink-0 mt-0.5" style={{ color: 'rgb(140, 95, 20)' }} aria-hidden />
      {children}
    </p>
  );
}

// Stands in for the stats while they load or when the endpoint failed.
export function StatsMessage({ error, loading }: { error: string | null; loading: boolean }) {
  return (
    <p className="text-[14px]" style={{ color: MUTED }} role="status">
      {error ? `Stats are unavailable right now (${error}). Try again in a minute.` : loading ? 'Stats are loading…' : 'Loading stats…'}
    </p>
  );
}
