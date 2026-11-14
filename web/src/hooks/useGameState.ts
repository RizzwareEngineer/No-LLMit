'use client';

import { useState, useEffect, useRef } from 'react';
import { GameStream, GameState, TableNoticePayload } from '@/lib/api';
import { StatsResponse } from '@/lib/stats';
import { ButtonDetermination, DisplayState, EMPTY_TABLE, Tables, applyMessage, applyStats, clockLeft } from '@/lib/stream';

// How long the stream may be down before the page says Offline: the server ends every stream after 10 to 14 minutes,
// and the reopen that follows should not flash the connection bar. A page load waits as long for its first open.
const OFFLINE_AFTER_MS = 4000;

// Not known yet (the page has just loaded), open, or down for OFFLINE_AFTER_MS (or given up).
export type Connection = 'connecting' | 'open' | 'down';

interface UseGameStateReturn {
  gameState: GameState | null;
  connection: Connection;
  gaveUp: boolean; // reconnect attempts exhausted
  tableNotice: TableNoticePayload | null; // table closed, capped, in an outage or saving
  displayState: DisplayState | null;
  shotClockRemaining: number | null; // seconds left on the shot clock; null: no clock (the engine sent no budget)
  shotClockBudgetMs: number | null; // the turn's whole budget, for the phone's ring; null: no clock
  buttonDetermination: ButtonDetermination | null;
  stats: StatsResponse | null; // all-time stats, from the stream
  retry: () => void;
}

export function useGameState(): UseGameStateReturn {
  // Every table the stream reports, by table id; the page draws the only one.
  const [tables, setTables] = useState<Tables>({});
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [connection, setConnection] = useState<Connection>('connecting');
  const [gaveUp, setGaveUp] = useState(false);
  const streamRef = useRef<GameStream | null>(null);

  const table = Object.values(tables)[0] ?? EMPTY_TABLE;

  // The shot clock ticks from llm_thinking until the move arrives (llm_action), then holds its last value.
  const { clock } = table;
  const [tick, setTick] = useState({ received: 0, left: 0 });
  useEffect(() => {
    if (!clock?.running) return;
    const id = setInterval(() => setTick({ received: clock.received, left: clockLeft(clock, Date.now()) }), 1000);
    return () => clearInterval(id);
  }, [clock]);
  const shotClockRemaining = !clock ? null : tick.received === clock.received ? tick.left : clockLeft(clock, clock.received);

  // One stream for the page's life, closed by the cleanup whenever it unmounts (Strict Mode's double mount leaves one).
  useEffect(() => {
    const stream = new GameStream();
    streamRef.current = stream;
    // Started now, so a first attempt that errors, or hangs, says down once, OFFLINE_AFTER_MS after load.
    let offlineTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => setConnection('down'), OFFLINE_AFTER_MS);
    stream.onMessage = (m) => {
      if (m.type === 'stats') setStats(s => applyStats(s, m.payload as StatsResponse));
      else {
        const now = Date.now();
        setTables(t => applyMessage(t, m, now));
      }
    };
    // Nothing is cleared on open: the snapshot that follows replaces the tables.
    stream.onStatus = (status) => {
      setGaveUp(status === 'gave_up');
      if (status === 'open' || status === 'gave_up') {
        if (offlineTimer) clearTimeout(offlineTimer);
        offlineTimer = null;
        setConnection(status === 'open' ? 'open' : 'down');
      } else if (!offlineTimer) {
        offlineTimer = setTimeout(() => setConnection('down'), OFFLINE_AFTER_MS);
      }
    };
    // A failed first attempt starts the reconnect loop; onStatus reports when it gives up.
    stream.connect().catch(() => {});
    return () => {
      stream.disconnect();
      streamRef.current = null;
      if (offlineTimer) clearTimeout(offlineTimer);
    };
  }, []);

  return {
    gameState: table.gameState,
    connection,
    gaveUp,
    tableNotice: table.notice,
    displayState: table.display,
    shotClockRemaining,
    shotClockBudgetMs: clock?.budgetMs ?? null,
    buttonDetermination: table.buttonDetermination,
    stats,
    retry: () => streamRef.current?.retry(),
  };
}
