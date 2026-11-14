import { Warning } from '@phosphor-icons/react';
import { MUTED, TEXT } from '@/lib/stats';

export function SmallSampleNote({ children }: { children: React.ReactNode }) {
  return (
    <p className="mb-4 flex items-start gap-2 rounded p-2 text-[13px]" style={{ background: 'rgba(203, 145, 47, 0.12)', color: TEXT }}>
      <Warning size={16} weight="bold" className="shrink-0 mt-0.5" style={{ color: 'rgb(140, 95, 20)' }} aria-hidden />
      {children}
    </p>
  );
}

// Stands in for the stats while they load or when they cannot be had.
export function StatsMessage({ error }: { error: string | null }) {
  return (
    <p className="text-[14px]" style={{ color: MUTED }} role="status">
      {error ? `Stats are unavailable right now (${error}). Try again in a minute.` : 'Stats are loading…'}
    </p>
  );
}
