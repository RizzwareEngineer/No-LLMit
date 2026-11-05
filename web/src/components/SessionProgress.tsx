'use client';

import { useEffect, useState } from 'react';
import type { UsageData } from '@/components/UsageIndicator';
import { formatLocalTime, zonedHourToday } from '@/lib/time';
import { MUTED } from '@/lib/stats';

const DAY = 86_400_000;

// How far through today's session the table is: the share of today's open hours gone, or of
// the daily call cap used when the table has no hours. The line is always in the DOM, so nothing
// moves when the data arrives.
export default function SessionProgress({ table, label }: { table?: UsageData['table']; label: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const i = setInterval(tick, 30_000);
    return () => clearInterval(i);
  }, []);

  let fill: number | null = null;
  let detail = '';
  if (table && now) {
    if (table.open && table.timezone && table.openHour !== undefined && table.closeHour !== undefined) {
      let open = zonedHourToday(table.openHour, table.timezone, new Date(now)).getTime();
      let close = zonedHourToday(table.closeHour, table.timezone, new Date(now)).getTime();
      if (close <= open) { // overnight hours
        if (now < close) open -= DAY;
        else close += DAY;
      }
      fill = (now - open) / (close - open);
      detail = ` · closes ${formatLocalTime(new Date(close))}`;
    } else if (table.dailyCallCap > 0) {
      fill = table.callsToday / table.dailyCallCap;
      detail = ` · ${Math.round(fill * 100)}% of today's calls`;
    }
  }
  const shown = fill === null ? 0 : Math.min(1, Math.max(0, fill));

  return (
    <div className="w-full max-w-[720px] mb-3">
      <div
        className="h-[2px] w-full rounded-full overflow-hidden"
        style={{ background: 'rgba(55, 53, 47, 0.09)' }}
        role="progressbar"
        aria-label="Today's session"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(shown * 100)}
      >
        <div
          className="h-full w-full origin-left transition-transform duration-700 ease-out motion-reduce:transition-none"
          style={{ transform: `scaleX(${shown})`, background: 'rgb(35, 131, 226)' }}
        />
      </div>
      <p className="mt-1 h-4 text-center text-[11px] tabular-nums" style={{ color: MUTED }}>
        {label}{detail}
      </p>
    </div>
  );
}
