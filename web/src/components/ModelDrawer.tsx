'use client';

import { useEffect, useRef } from 'react';
import { X } from '@phosphor-icons/react';
import LLMLogo from '@/components/LLMLogo';
import HeadToHead from '@/components/HeadToHead';
import CumulativeChart from '@/components/CumulativeChart';
import { missPct } from '@/components/StatsTable';
import { SmallSampleNote, StatsMessage } from '@/components/StatsPanel';
import { DASH, MIN_HANDS, MUTED, ModelStats, TEXT, ciHalf, modelSlug, netColor, pct, signed, chips } from '@/lib/stats';

const POSITION_ORDER = ['UTG', 'UTG+1', 'UTG+2', 'MP', 'LJ', 'HJ', 'CO', 'BTN', 'SB', 'BB'];

// Accepts the display-name slug in any case, the URL-encoded name, or the model id.
export function findModel(models: ModelStats[], param: string) {
  let raw = param;
  try { raw = decodeURIComponent(param); } catch { /* malformed escape: use as is */ }
  const want = modelSlug(raw);
  return models.find(x => modelSlug(x.name) === want || modelSlug(x.model) === want || x.model.toLowerCase() === raw.toLowerCase());
}

function Fact({ label, value, color }: { label: string; value: React.ReactNode; color?: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wider" style={{ color: MUTED }}>{label}</dt>
      <dd className="text-[15px] font-bold tabular-nums" style={{ color: color ?? TEXT }}>{value}</dd>
    </div>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h3 className="text-xs font-bold uppercase tracking-wider mb-2" style={{ color: TEXT }}>{title}</h3>
      {children}
    </section>
  );
}

// One model's detail in a modal <dialog>: a side drawer on desktop, a bottom sheet on phones
// (styles in globals.css). The dialog gives focus trapping, Escape and an inert page for free.
export default function ModelDrawer({
  models,
  error,
  loading,
  slug,
  onClose,
}: {
  models: ModelStats[];
  error: string | null;
  loading: boolean;
  slug: string | null;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const m = slug ? findModel(models, slug) : undefined;
  const open = !!slug;

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  // A model opened from inside the drawer starts at its top.
  useEffect(() => { ref.current?.querySelector('[data-scroll]')?.scrollTo({ top: 0 }); }, [slug]);

  const rank = (p: string) => (POSITION_ORDER.indexOf(p) + 1 || 99);
  const positions = m ? Object.entries(m.by_position ?? {}).sort((a, b) => rank(a[0]) - rank(b[0])) : [];

  return (
    <dialog
      ref={ref}
      className="drawer"
      aria-labelledby="drawer-title"
      onClose={onClose}
      onClick={e => e.target === e.currentTarget && onClose()} // the backdrop
    >
      <div
        data-scroll
        className="h-full overflow-y-auto overscroll-contain p-5"
        // Switching models inside the drawer replaces its history entry, so Back and close
        // leave the drawer instead of stepping through every model viewed.
        onClick={e => {
          const a = (e.target as HTMLElement).closest('a[href^="#model="]');
          if (!a || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
          e.preventDefault();
          window.location.replace(a.getAttribute('href')!);
        }}
      >
        <div className="flex items-start gap-3">
          {m && <LLMLogo model={m.name} size={36} />}
          <div className="flex-1 min-w-0">
            <h2 id="drawer-title" className="text-[20px] font-bold leading-tight" style={{ color: TEXT }}>
              {m?.name ?? 'Model'}
            </h2>
            {m && <p className="text-[12px] font-mono truncate" style={{ color: MUTED }}>{m.model}</p>}
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 -m-1 rounded hover:bg-[rgba(55,53,47,0.06)]">
            <X size={18} aria-hidden />
          </button>
        </div>

        {!m ? (
          <div className="mt-6">
            {models.length ? <p className="text-[14px]" style={{ color: MUTED }}>No stats for this model yet.</p> : <StatsMessage error={error} loading={loading} />}
          </div>
        ) : (
          <>
            <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3">
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
              <div className="mt-4">
                <SmallSampleNote>Fewer than {MIN_HANDS} hands, so this win rate is mostly luck so far.</SmallSampleNote>
              </div>
            )}

            <Block title="Results">
              <div className="flex flex-col min-h-[340px]"><CumulativeChart models={[m]} selected={m.name} /></div>
            </Block>

            <Block title="By position">
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
                      <tr key={pos} className="lift">
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
            </Block>

            <Block title="Head to head">
              <HeadToHead models={models} focus={m} />
            </Block>

            <Block title="Biggest pots">
              <dl className="flex gap-8">
                <Fact label="Won" value={`${m.biggest_pot_won.toLocaleString()}`} color={netColor(1)} />
                <Fact label="Lost" value={`${m.biggest_pot_lost.toLocaleString()}`} color={netColor(-1)} />
              </dl>
            </Block>

            {/* Profiles' Mistakes group; API errors, latency and cost come from the provider, not the model. */}
            <Block title="Mistakes">
              <dl className="grid grid-cols-2 gap-4">
                <Fact label="Fold when check free" value={pct(m.fold_when_check_free)} />
                <Fact label="Misses" value={missPct(m)} />
              </dl>
            </Block>
          </>
        )}
      </div>
    </dialog>
  );
}
