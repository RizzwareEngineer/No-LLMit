'use client';

import { useEffect, useRef } from 'react';
import { ArrowRight, X } from '@phosphor-icons/react';
import LLMLogo from '@/components/LLMLogo';
import { pageTo } from '@/components/Section';
import { DASH, MUTED, ModelStats, TEXT, BLUE, chips, ciHalf, netColor, signed } from '@/lib/stats';

// Phones: a tapped seat's basic stats, over the middle of the table (owner 2026-11-15: "If they do click on a player
// icon, they should be able to see the basic stats: BB, 100 hands, net, and all-in EV. For the more stats, they should
// be prompted to go to the stats page"). The drawer's four facts (ModelDrawer), the seat's card look, and More stats,
// which closes it and goes to the Stats tab. A tap outside, the close button or Escape closes it; focus moves in and back.
export default function SeatStats({ name, stats: m, onClose }: { name: string; stats?: ModelStats; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); back?.focus?.(); };
  }, [onClose]);
  const fact = (label: string, value: React.ReactNode, color?: string) => (
    <div>
      <dt className="text-[11px] uppercase tracking-wider" style={{ color: MUTED }}>{label}</dt>
      <dd className="text-[15px] leading-5 font-bold tabular-nums" style={{ color: color ?? TEXT }}>{value}</dd>
    </div>
  );
  return (
    <>
      <button type="button" aria-label="Close stats" tabIndex={-1} className="fixed inset-0 z-30 cursor-default bg-[rgba(15,15,15,0.08)]" onClick={onClose} />
      <div
        ref={ref}
        data-seat-stats
        role="dialog"
        aria-labelledby="seat-stats-title"
        tabIndex={-1}
        className="absolute z-30 left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[min(300px,calc(100%-24px))] rounded bg-white p-3 outline-none motion-safe:animate-[pop_160ms_ease-out]"
        style={{ boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.12) 0px 6px 20px' }}
      >
        <div className="flex items-center gap-2">
          <LLMLogo model={name} size={24} />
          <h2 id="seat-stats-title" className="flex-1 min-w-0 truncate text-[15px] font-bold" style={{ color: TEXT }}>{name}</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="-mr-2 -my-2 w-11 h-11 flex items-center justify-center rounded" style={{ color: MUTED }}>
            <X size={18} weight="bold" aria-hidden />
          </button>
        </div>
        {m ? (
          <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-2">
            {fact('bb/100', <>{signed(m.bb100)}{ciHalf(m) !== null && <span className="font-normal text-[12px]" style={{ color: MUTED }}> ±{ciHalf(m)!.toFixed(1)}</span>}</>, netColor(m.bb100))}
            {fact('Hands', m.hands.toLocaleString())}
            {fact('Net', chips(m.net_chips), netColor(m.net_chips))}
            {fact('All-in EV bb/100', m.aiev_bb100 === null ? DASH : signed(m.aiev_bb100))}
          </dl>
        ) : (
          <p className="mt-2 text-[13px]" style={{ color: MUTED }}>No stats yet.</p>
        )}
        <button
          type="button"
          onClick={() => { onClose(); pageTo('phone-stats'); }}
          className="mt-3 w-full h-11 flex items-center justify-center gap-1.5 rounded text-[13px] font-bold"
          style={{ color: BLUE, boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px inset' }}
        >
          More stats <ArrowRight size={14} weight="bold" aria-hidden />
        </button>
      </div>
    </>
  );
}
