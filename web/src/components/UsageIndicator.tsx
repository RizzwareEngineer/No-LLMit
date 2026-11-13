"use client";

import { useState, useEffect } from "react";
import { Lightning, Heart, Warning } from "@phosphor-icons/react";
import { API_URL } from "@/lib/api";
import { MUTED, BLUE } from "@/lib/stats";
import { localHoursLabel } from "@/lib/time";
import { useRememberedBox } from "@/lib/boxes";
import { SPONSORS } from "@/components/about/content";

// What the engine's /api/usage reports
export interface UsageData {
  table?: {
    callsToday: number;
    dailyCallCap: number;
    open: boolean;
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

// Polls /api/usage every 30 s from when the page opened, so viewers' requests are spread out, never sent together on an
// event every page sees at once.
export function useUsage() {
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
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
  }, []);

  return { usage, error };
}

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
      {/* Spacing is tight on purpose: the Sponsor row's 16px comes out of the paddings, so the card keeps its height. */}
      <div className="px-3 pt-1 pb-1.5">
        <div className="flex items-center gap-2 text-[11px] mb-0.5" style={{ color: MUTED }}>
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
          <span className="text-[11px] font-bold tabular-nums" style={{ color: 'rgb(55, 53, 47)' }}>
            {error ? '???' : barIsSpend ? `$${usedUsd.toFixed(2)} / $${limitUsd!.toFixed(0)}` : calls}
          </span>
        </div>

        {barIsSpend && (
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[11px]" style={{ color: MUTED }}>Calls today:</span>
            <span className="text-[11px] tabular-nums" style={{ color: 'rgb(55, 53, 47)' }}>{calls}</span>
          </div>
        )}
        {showSpend && !limitUsd && (
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[11px]" style={{ color: MUTED }}>Spend:</span>
            <span className="text-[11px] tabular-nums" style={{ color: 'rgb(55, 53, 47)' }}>${usedUsd.toFixed(2)}</span>
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

        {/* What the calls above are, in the old "Support this project" line's place (the card must not grow: the sidebar
            already sets the table's height). */}
        <p className="mt-1 pt-1 border-t border-notion text-[11px] whitespace-nowrap" style={{ color: 'rgb(55, 53, 47)' }}>Every move is a paid model call.</p>
        {/* The ask, right under what it pays for: the card's only filled control. */}
        <a
          href={SPONSORS}
          target="_blank"
          rel="noopener noreferrer"
          className="w-fit flex items-center gap-1 rounded-full px-1.5 text-[11px] leading-[16px] font-medium text-white whitespace-nowrap hover:brightness-110 transition-[filter]"
          style={{ background: 'rgb(35, 131, 226)' }}
        >
          {!(error || isCritical) && <Heart size={11} weight="fill" aria-hidden />}
          Sponsor on GitHub
        </a>
      </div>
    </div>
  );
}
