"use client";

import { createContext, useCallback, useContext, useEffect, useState, useSyncExternalStore } from "react";
import { DASH, MUTED, ModelStats, STAT_DEFINITIONS, TEXT, ciHalf, fetchStats, pct, signed } from "@/lib/stats";

const STORAGE_KEY = "nollmit.hud";

export interface HudValue {
  stats: Record<string, ModelStats> | null; // by model name; null until the first good /api/stats response
  on: boolean; // the always-on tracker line under each seat name
  setOn: (on: boolean) => void;
  followed: string | null; // pinned model name
  toggleFollow: (name: string) => void;
}

export const HudContext = createContext<HudValue>({ stats: null, on: false, setOn: () => {}, followed: null, toggleFollow: () => {} });
// The toggle lives in localStorage; useSyncExternalStore reads it after hydration without an effect.
const listeners = new Set<() => void>();
const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };
const readOn = () => { try { return localStorage.getItem(STORAGE_KEY) === "1"; } catch { return false; } };

export const useHud = () => useContext(HudContext);

// One /api/stats fetch shared by every seat, refreshed after each hand like WinningsPanel.
export function useHudState(handNumber: number): HudValue {
  const [stats, setStats] = useState<HudValue["stats"]>(null);
  const on = useSyncExternalStore(subscribe, readOn, () => false);
  const [followed, setFollowed] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = () =>
      fetchStats()
        .then(s => !cancelled && setStats(Object.fromEntries(s.models.map(m => [m.name, m]))))
        // 503 or missing: keep the last good stats and retry like useStats, so a 503 on load recovers before the next hand
        .catch(() => { if (!cancelled) timer = setTimeout(load, 10_000); });
    load();
    return () => { cancelled = true; clearTimeout(timer); };
  }, [handNumber]);

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

  return { stats, on, setOn, followed, toggleFollow };
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

// Hover/pin card. Always in the DOM so aria-describedby on the seat resolves; hidden unless open.
// Where the card opens, relative to the seat; it touches the seat so the mouse can travel into it.
// down-*: below; up-*: above; felt-left/felt-right: beside a side-column seat, toward the felt.
export type CardAlign = "left" | "center" | "right" | "up-left" | "up-center" | "up-right" | "felt-left" | "felt-right";
const POS: Record<CardAlign, string> = {
  left: "top-full left-0",
  center: "top-full left-1/2 -translate-x-1/2",
  right: "top-full right-0",
  "up-left": "bottom-full left-0",
  "up-center": "bottom-full left-1/2 -translate-x-1/2",
  "up-right": "bottom-full right-0",
  "felt-left": "top-0 left-full",
  "felt-right": "top-0 right-full",
};

export function HudCard({ id, stats, loaded, open, align }: { id: string; stats: ModelStats | undefined; loaded: boolean; open: boolean; align: CardAlign }) {
  const rows = stats
    ? [
        { key: "bb100", label: "bb/100", value: <>{bb100(stats).value} <span style={{ color: MUTED }}>{bb100(stats).ci}</span></> },
        { key: "vpip", label: "VPIP", value: pct(stats.vpip) },
        { key: "pfr", label: "PFR", value: pct(stats.pfr) },
        { key: "af", label: "AF", value: af(stats) },
      ]
    : [];
  return (
    <div
      id={id}
      role="group"
      hidden={!open}
      className={`absolute z-30 w-[168px] rounded bg-white p-2.5 text-[12px] tabular-nums ${POS[align]}`}
      style={{ color: TEXT, boxShadow: "rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.1) 0px 2px 4px" }}
    >
      {stats ? (
        <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
          {rows.map(r => (
            <div key={r.key} className="contents">
              <dt className="group relative">
                <span tabIndex={0} aria-describedby={`${id}-${r.key}`} className="cursor-help underline decoration-dotted underline-offset-2" style={{ color: MUTED }}>{r.label}</span>
                <span
                  id={`${id}-${r.key}`}
                  role="tooltip"
                  className="hidden group-hover:block group-focus-within:block absolute left-0 top-full mt-1 z-40 w-[168px] rounded bg-white p-2 text-[11px] leading-snug"
                  style={{ color: TEXT, boxShadow: "rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.1) 0px 2px 4px" }}
                >
                  {STAT_DEFINITIONS[r.key]}
                </span>
              </dt>
              <dd className="m-0 text-right font-semibold">{r.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <span style={{ color: MUTED }}>{loaded ? "No stats yet" : "Stats loading…"}</span>
      )}
    </div>
  );
}
