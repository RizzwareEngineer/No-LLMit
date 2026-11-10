"use client";

import { useState, useEffect } from "react";
import { Lightning, Heart, Warning } from "@phosphor-icons/react";
import CornerBorders from "@/components/CornerBorders";
import { API_URL } from "@/lib/api";
import { localHoursLabel } from "@/lib/time";
import { useRememberedBox } from "@/lib/boxes";

// What the engine's /api/usage reports
export interface UsageData {
  table?: {
    callsToday: number;
    dailyCallCap: number;
    open: boolean;
    hours?: string;
    openHour?: number;
    closeHour?: number;
    timezone?: string;
    spectators: number;
  };
  llm?: {
    provider: string;
    spend: { used_usd: number | null; limit_usd: number | null } | null;
  };
}

const USAGE_POLL_MS = 30_000;

// Polls /api/usage on an interval and whenever refreshTrigger changes.
export function useUsage(refreshTrigger?: number, isPaused = false) {
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (isPaused) return;
    const fetchUsage = async () => {
      try {
        const res = await fetch(`${API_URL}/api/usage`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        setUsage(await res.json());
        setError(false);
      } catch {
        setError(true);
      }
    };
    fetchUsage();
    const interval = setInterval(fetchUsage, USAGE_POLL_MS);
    return () => clearInterval(interval);
  }, [isPaused, refreshTrigger]);

  return { usage, error };
}

const MUTED = 'rgba(55, 53, 47, 0.65)';
const WARN_TEXT = 'rgb(140, 95, 20)'; // darker mustard, readable on white

export default function UsageIndicator({ usage, error }: { usage: UsageData | null; error: boolean }) {
  const table = usage?.table;
  const spend = usage?.llm?.spend;
  const isMock = usage?.llm?.provider === 'mock';
  const usedUsd = spend?.used_usd ?? 0;
  const limitUsd = spend?.limit_usd ?? null;
  const showSpend = !!spend && !isMock;
  // Bar shows spend against the monthly limit when there is one, else today's calls against the cap
  const barIsSpend = showSpend && !!limitUsd;
  const usedPct = barIsSpend
    ? (usedUsd / limitUsd!) * 100
    : table ? (table.callsToday / table.dailyCallCap) * 100 : 0;
  const isLow = usedPct > 50;
  const isCritical = usedPct > 80;
  const barColor = error ? MUTED : isCritical ? 'rgb(235, 87, 87)' : isLow ? 'rgb(203, 145, 47)' : 'rgb(15, 123, 108)';
  const hours = localHoursLabel(table);
  const calls = error || !table ? '???' : `${table.callsToday.toLocaleString()} / ${table.dailyCallCap.toLocaleString()}`;
  // Until the first answer: a blank box as tall as its lines were (remembered).
  const [box, size, attrs] = useRememberedBox<HTMLDivElement>('usage', !!usage);

  return (
    <div
      ref={box}
      {...attrs}
      className={`relative bg-white rounded overflow-hidden ${usage || error ? '' : '[&>*]:invisible'}`}
      style={{ boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.1) 0px 2px 4px', ...size }}
    >
      <CornerBorders />
      <div className="px-3 py-2">
        <div className="flex items-center gap-2 text-[11px] mb-1" style={{ color: MUTED }}>
          <Lightning size={11} weight="bold" style={{ color: barColor }} aria-hidden />
          <span className="uppercase font-bold">API Usage</span>
          {(error || isCritical) && <Warning size={11} weight="bold" style={{ color: error ? WARN_TEXT : 'rgb(235, 87, 87)' }} aria-hidden />}
        </div>

        <div className="flex items-center gap-2">
          <span className="text-[11px] shrink-0" style={{ color: MUTED }}>{barIsSpend ? 'Spend:' : 'Calls today'}</span>
          <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: error ? '0%' : `${Math.min(100, usedPct)}%`, background: barColor }}
            />
          </div>
          <span className="text-[11px] font-mono font-bold tabular-nums" style={{ color: 'rgb(55, 53, 47)' }}>
            {error ? '???' : barIsSpend ? `$${usedUsd.toFixed(2)} / $${limitUsd!.toFixed(0)}` : calls}
          </span>
        </div>

        {barIsSpend && (
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[11px]" style={{ color: MUTED }}>Calls today:</span>
            <span className="text-[11px] font-mono tabular-nums" style={{ color: 'rgb(55, 53, 47)' }}>{calls}</span>
          </div>
        )}
        {showSpend && !limitUsd && (
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[11px]" style={{ color: MUTED }}>Spend:</span>
            <span className="text-[11px] font-mono tabular-nums" style={{ color: 'rgb(55, 53, 47)' }}>${usedUsd.toFixed(2)}</span>
          </div>
        )}

        {isMock && (
          <div className="mt-1 text-[11px]" style={{ color: WARN_TEXT }}>
            Test mode: random actions, no models called
          </div>
        )}

        {hours && (
          <div className="mt-1 text-[11px]" style={{ color: table?.open ? MUTED : WARN_TEXT }}>
            {table?.open ? 'Open' : 'Closed. Open'} daily {hours} your time
          </div>
        )}

        <a
          href="https://github.com/sponsors/RizzwareEngineer"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 pt-2 border-t border-notion flex items-center gap-1 text-[11px] hover:underline"
          style={{ color: 'rgb(200, 50, 50)' }}
        >
          <Heart size={11} weight="fill" aria-hidden />
          Support this project
        </a>
      </div>
    </div>
  );
}
