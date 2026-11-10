'use client';

import { useEffect, useState } from 'react';
import type { UsageData } from '@/components/UsageIndicator';
import { formatLocalTime, zonedHourToday } from '@/lib/time';
import { MUTED } from '@/lib/stats';

const DAY = 86_400_000;

// The share of today's open hours gone. Hidden (but still holding its height, so nothing
// moves) while the table is closed or has no hours.
export default function SessionProgress({ table }: { table?: UsageData['table'] }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const i = setInterval(tick, 30_000);
    return () => clearInterval(i);
  }, []);

  let fill: number | null = null;
  let closes = '';
  if (now && table?.open && table.timezone && table.openHour !== undefined && table.closeHour !== undefined) {
    let open = zonedHourToday(table.openHour, table.timezone, new Date(now)).getTime();
    let close = zonedHourToday(table.closeHour, table.timezone, new Date(now)).getTime();
    if (close <= open) { // overnight hours
      if (now < close) open -= DAY;
      else close += DAY;
    }
    fill = Math.min(1, Math.max(0, (now - open) / (close - open)));
    closes = formatLocalTime(new Date(close));
  }

  return (
    <div className="w-full max-w-[720px] mb-1.5" style={{ visibility: fill === null ? 'hidden' : undefined }} aria-hidden={fill === null}>
      <div
        className="h-[2px] w-full rounded-full overflow-hidden"
        style={{ background: 'rgba(55, 53, 47, 0.09)' }}
        role="progressbar"
        aria-label="Today's session"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round((fill ?? 0) * 100)}
      >
        <div
          className="h-full w-full origin-left transition-transform duration-700 ease-out motion-reduce:transition-none"
          style={{ transform: `scaleX(${fill ?? 0})`, background: 'rgb(35, 131, 226)' }}
        />
      </div>
      <p className="mt-1 h-5 text-center text-[14px] tabular-nums" style={{ color: MUTED }}>
        Today&apos;s session · closes {closes}
      </p>
    </div>
  );
}
