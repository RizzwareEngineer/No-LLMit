"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { DASH, MUTED, ModelStats, STAT_DEFINITIONS, TEXT, ciHalf, pct, signed } from "@/lib/stats";

const STORAGE_KEY = "nollmit.hud";

export interface HudValue {
  stats: Record<string, ModelStats> | null; // by model name; null until the first good /api/stats response
  on: boolean; // the always-on tracker line under each seat name
  setOn: (on: boolean) => void;
  followed: string | null; // pinned model name
  toggleFollow: (name: string) => void;
  hovered: string | null; // seat under the pointer or keyboard focus
  hover: (name: string | null) => void;
}

export const HudContext = createContext<HudValue>({
  stats: null, on: false, setOn: () => {}, followed: null, toggleFollow: () => {}, hovered: null, hover: () => {},
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
  const hover = setHovered;

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
    () => ({ stats, on, setOn, followed, toggleFollow, hovered, hover }),
    [stats, on, setOn, followed, toggleFollow, hovered, hover],
  );
}

const bb100 = (m: ModelStats) => {
  const half = ciHalf(m);
  return { value: signed(m.bb100), ci: half === null ? DASH : `±${half.toFixed(0)}` };
};
const af = (m: ModelStats) => (m.af === null ? DASH : m.af.toFixed(1));

// Four numbers on one line, like a tracker overlay. `swap` is the hover/focus/pin version: it fills
// its container (which keeps its size) and, on phones, drops PFR and AF unless the seat is pinned.
export function HudLine({ stats, swap = false, full = true }: { stats: ModelStats | undefined; swap?: boolean; full?: boolean }) {
  const box = swap ? "absolute inset-0 px-3 flex items-center bg-white leading-[11px]" : "px-3 -mt-1 mb-1";
  if (!stats) return <div className={`${box} text-[10px] tabular-nums`} style={{ color: MUTED }}>{DASH}</div>;
  const b = bb100(stats);
  const title = `bb/100 ${b.value} ${b.ci}, VPIP ${pct(stats.vpip)}, PFR ${pct(stats.pfr)}, AF ${af(stats)}`;
  const extra = swap && !full ? "max-md:hidden" : "";
  const def = (k: string, label: string) => `${label}: ${STAT_DEFINITIONS[k]}`;
  return (
    <div className={`${box} text-[10px] tabular-nums flex flex-wrap gap-x-1.5 content-center`} style={{ color: TEXT }} aria-label={title}>
      <span title={def("bb100", "bb/100")}>{b.value} <span style={{ color: MUTED }}>{b.ci}</span></span>
      <span title={def("vpip", "VPIP")}>V{pct(stats.vpip).replace("%", "")}</span>
      <span className={extra} title={def("pfr", "PFR")}>P{pct(stats.pfr).replace("%", "")}</span>
      <span className={extra} title={def("af", "AF")}>AF{af(stats)}</span>
    </div>
  );
}
