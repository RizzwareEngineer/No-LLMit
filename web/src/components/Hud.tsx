"use client";

import { createContext, type ReactNode, useCallback, useContext, useEffect, useId, useMemo, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { DASH, MUTED, ModelStats, STAT_DEFINITIONS, TEXT, brief, ciHalf, pct, signed } from "@/lib/stats";

const STORAGE_KEY = "nollmit.hud";

export interface HudValue {
  stats: Record<string, ModelStats> | null; // by model name; null until the first good /api/stats response
  on: boolean; // fills the HUD row on every seat
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

const af = (m: ModelStats) => (m.af === null ? DASH : m.af.toFixed(1));
const num = (n: number | null) => pct(n).replace("%", "");

// A stat name with a dotted underline and its definition: shown on mouse hover or focus (a tap
// focuses it on touch; tapping elsewhere closes it). Portalled to <body> so no card clips it.
function StatLabel({ k, label, children }: { k: string; label: string; children: ReactNode }) {
  const [at, setAt] = useState<DOMRect | null>(null);
  const id = useId();
  const open = (el: Element) => setAt(el.getBoundingClientRect());
  const close = () => setAt(null);
  const left = at ? Math.min(Math.max(8, at.left + at.width / 2 - 120), window.innerWidth - 248) : 0;
  return (
    <>
      <span
        tabIndex={0}
        aria-describedby={id}
        className="underline decoration-dotted underline-offset-2 cursor-help"
        onPointerEnter={e => e.pointerType === "mouse" && open(e.currentTarget)}
        onPointerLeave={e => e.pointerType === "mouse" && close()}
        onFocus={e => open(e.currentTarget)}
        onBlur={close}
        onClick={e => e.stopPropagation()} // a tap on the label must not unpin the seat
      >
        {label}
      </span>{" "}{children}
      <span id={id} className="sr-only">. {STAT_DEFINITIONS[k]}</span>
      {at && createPortal(
        <div
          role="tooltip"
          className="fixed z-[60] w-[240px] rounded px-2.5 py-1.5 text-[12px] leading-snug pointer-events-none"
          style={{ left, top: at.top - 6, transform: "translateY(-100%)", background: "rgb(37, 37, 35)", color: "#fff", boxShadow: "rgba(15, 15, 15, 0.2) 0 4px 12px" }}
        >
          <b>{label}</b>: {STAT_DEFINITIONS[k]}
        </div>,
        document.body,
      )}
    </>
  );
}

const compact = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${brief(n, 0)}`; // 41, 1.3k

const Dot = () => <span aria-hidden className="max-md:hidden" style={{ color: MUTED }}>·</span>;

// The seat's third row: always reserved (two lines on desktop, four on phones, where bb/100 uses
// compact figures and its ± may wrap) so nothing in the card moves. Filled while hovered, focused or pinned, or always when the header HUD toggle is on.
// `id` lets the seat point aria-describedby at this row, so a screen reader hears the stats and
// their definitions when the seat is focused.
export function HudRow({ id, stats, show }: { id?: string; stats: ModelStats | undefined; show: boolean }) {
  const half = stats ? ciHalf(stats) : null;
  return (
    <div id={id} data-hud-row className="h-[64px] md:h-[34px] shrink-0 overflow-hidden px-2 pb-1.5 text-[12px] leading-[15px] tabular-nums" style={{ color: TEXT }}>
      {show && (stats ? (
        <div className="flex flex-wrap gap-x-1.5">
          <span className="whitespace-nowrap"><StatLabel k="vpip" label="VPIP">{num(stats.vpip)}</StatLabel></span>
          <Dot />
          <span className="whitespace-nowrap"><StatLabel k="pfr" label="PFR">{num(stats.pfr)}</StatLabel></span>
          <Dot />
          <span className="whitespace-nowrap"><StatLabel k="af" label="AF">{af(stats)}</StatLabel></span>
          <span className="md:whitespace-nowrap md:basis-full">
            <StatLabel k="bb100" label="bb/100">
              <span className="whitespace-nowrap max-md:hidden">{signed(stats.bb100, 0)} <span style={{ color: MUTED }}>{half === null ? DASH : `±${half.toFixed(0)}`}</span></span>
              <span className="whitespace-nowrap md:hidden">{compact(stats.bb100)}</span>{" "}
              <span className="whitespace-nowrap md:hidden" style={{ color: MUTED }}>{half === null ? DASH : `±${brief(half, 0)}`}</span>
            </StatLabel>
          </span>
        </div>
      ) : <span style={{ color: MUTED }}>{DASH}</span>)}
    </div>
  );
}
