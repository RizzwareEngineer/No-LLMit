"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { DASH, MUTED, ModelStats, STAT_DEFINITIONS, TEXT, ciHalf, pct, signed } from "@/lib/stats";

const STORAGE_KEY = "nollmit.hud";

export interface HudValue {
  stats: Record<string, ModelStats> | null; // by model name; null until the first good /api/stats response
  on: boolean; // the always-on tracker line under each seat name
  setOn: (on: boolean) => void;
  followed: string | null; // pinned model name
  toggleFollow: (name: string) => void;
  hovered: string | null; // seat under the pointer or keyboard focus
  hover: (name: string | null) => void; // null clears after a short grace, so the pointer can reach the slot
  hold: () => void; // cancels that pending clear
}

export const HudContext = createContext<HudValue>({
  stats: null, on: false, setOn: () => {}, followed: null, toggleFollow: () => {}, hovered: null, hover: () => {}, hold: () => {},
});
// The toggle lives in localStorage; useSyncExternalStore reads it after hydration without an effect.
const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };
const readOn = () => { try { return localStorage.getItem(STORAGE_KEY) === "1"; } catch { return false; } };

export const useHud = () => useContext(HudContext);

// HUD state. `models` comes from the page's one all-time /api/stats fetch (null until a good
// response), so the seats, leaderboard and sections never fetch twice.
export function useHudState(models: ModelStats[] | null | undefined): HudValue {
  const stats = useMemo(() => (models ? Object.fromEntries(models.map(m => [m.name, m])) : null), [models]);
  const on = useSyncExternalStore(subscribe, readOn, () => false);
  const [followed, setFollowed] = useState<string | null>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const clear = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hold = useCallback(() => clearTimeout(clear.current), []);
  const hover = useCallback((name: string | null) => {
    clearTimeout(clear.current);
    if (name) setHovered(name);
    else clear.current = setTimeout(() => setHovered(null), 250);
  }, []);

  const setOn = useCallback((v: boolean) => {
    try { localStorage.setItem(STORAGE_KEY, v ? "1" : "0"); } catch { /* not persisted; stays off */ }
    listeners.forEach(l => l());
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setFollowed(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const toggleFollow = useCallback((name: string) => setFollowed(f => (f === name ? null : name)), []);

  return useMemo(
    () => ({ stats, on, setOn, followed, toggleFollow, hovered, hover, hold }),
    [stats, on, setOn, followed, toggleFollow, hovered, hover, hold],
  );
}

const bb100 = (m: ModelStats) => {
  const half = ciHalf(m);
  return { value: signed(m.bb100), ci: half === null ? DASH : `±${half.toFixed(0)}` };
};
const af = (m: ModelStats) => (m.af === null ? DASH : m.af.toFixed(1));

// Four numbers on one line, like a tracker overlay.
export function HudLine({ stats }: { stats: ModelStats | undefined }) {
  if (!stats) return <div className="text-[10px] tabular-nums px-3 -mt-1 mb-1" style={{ color: MUTED }}>{DASH}</div>;
  const b = bb100(stats);
  const title = `bb/100 ${b.value} ${b.ci}, VPIP ${pct(stats.vpip)}, PFR ${pct(stats.pfr)}, AF ${af(stats)}`;
  return (
    <div className="text-[10px] tabular-nums px-3 -mt-1 mb-1 flex flex-wrap gap-x-1.5" style={{ color: TEXT }} title={title} aria-label={title}>
      <span>{b.value} <span style={{ color: MUTED }}>{b.ci}</span></span>
      <span>V{pct(stats.vpip).replace("%", "")}</span>
      <span>P{pct(stats.pfr).replace("%", "")}</span>
      <span>AF{af(stats)}</span>
    </div>
  );
}

// The HUD's one fixed slot on the felt, under the board and pot: the hovered or focused seat's
// four numbers, else the pinned seat's. Its height is reserved so the board never moves.
export function HudSlot({ id }: { id: string }) {
  const { stats, on, followed, hovered, hover, hold } = useHud();
  const name = on ? null : hovered ?? followed;
  const m = name ? stats?.[name] : undefined;
  const rows = m
    ? [
        { key: "bb100", label: "bb/100", value: <>{bb100(m).value} <span style={{ color: MUTED }}>{bb100(m).ci}</span></> },
        { key: "vpip", label: "VPIP", value: pct(m.vpip) },
        { key: "pfr", label: "PFR", value: pct(m.pfr) },
        { key: "af", label: "AF", value: af(m) },
      ]
    : [];
  return (
    <div
      id={id}
      onMouseEnter={hold}
      onMouseLeave={() => hover(null)}
      onFocus={hold}
      onBlur={() => hover(null)}
      className="h-[60px] md:h-[44px] flex flex-col items-center justify-center text-[12px] tabular-nums"
      style={{ color: TEXT, visibility: on ? "hidden" : undefined }}
    >
      {!name ? (
        <span className="text-[11px]" style={{ color: MUTED }}>Hover a seat for its stats; click to pin.</span>
      ) : (
        <div className="rounded bg-white px-2.5 py-1" style={{ boxShadow: "rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.1) 0px 2px 4px" }}>
          <div className="text-[11px] font-semibold text-center truncate max-w-[320px]">
            {name}{followed === name && <span className="font-normal" style={{ color: MUTED }}> · pinned</span>}
          </div>
          {m ? (
            <dl className="m-0 flex flex-wrap justify-center gap-x-3">
              {rows.map(r => (
                <div key={r.key} className="flex gap-1 items-baseline whitespace-nowrap">
                  <dt className="group relative">
                    <span tabIndex={0} aria-describedby={`${id}-${r.key}`} className="cursor-help underline decoration-dotted underline-offset-2" style={{ color: MUTED }}>{r.label}</span>
                    <span
                      id={`${id}-${r.key}`}
                      role="tooltip"
                      className="hidden group-hover:block group-focus-within:block absolute left-0 bottom-full mb-1 z-40 w-[168px] rounded bg-white p-2 text-[11px] leading-snug"
                      style={{ color: TEXT, boxShadow: "rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.1) 0px 2px 4px" }}
                    >
                      {STAT_DEFINITIONS[r.key]}
                    </span>
                  </dt>
                  <dd className="m-0 font-semibold">{r.value}</dd>
                </div>
              ))}
            </dl>
          ) : (
            <span style={{ color: MUTED }}>{stats ? "No stats yet" : "Stats loading…"}</span>
          )}
        </div>
      )}
    </div>
  );
}
