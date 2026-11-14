'use client';

import { useState, useEffect, useRef } from 'react';
import { GameStream, GameState, TableNoticePayload } from '@/lib/api';
import { StatsResponse } from '@/lib/stats';
import { ButtonDetermination, DisplayState, EMPTY_TABLE, Tables, applyMessage, applyStats } from '@/lib/stream';

export type { DisplayState } from '@/lib/stream';

// The engine's per-turn time limit, shown as the shot clock.
const SHOT_CLOCK_MS = 30000;
// How long the stream may be down before the page says Offline: the server ends every stream after 10 to 14 minutes,
// and the reopen that follows should not flash the connection bar.
const OFFLINE_AFTER_MS = 4000;

interface UseGameStateReturn {
  gameState: GameState | null;
  isConnected: boolean;
  tried: boolean; // the first connect attempt has settled, or 3 s have passed
  gaveUp: boolean; // reconnect attempts exhausted
  tableNotice: TableNoticePayload | null; // table closed, capped, in an outage or saving
  displayState: DisplayState | null;
  shotClockRemaining: number; // Seconds remaining on shot clock
  buttonDetermination: ButtonDetermination | null;
  stats: StatsResponse | null; // all-time stats, from the stream
  retry: () => void;
}

export function useGameState(): UseGameStateReturn {
  // Every table the stream reports, by table id; the page draws the only one.
  const [tables, setTables] = useState<Tables>({});
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [tried, setTried] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);
  const streamRef = useRef<GameStream | null>(null);

  const table = Object.values(tables)[0] ?? EMPTY_TABLE;

  // The shot clock ticks from llm_thinking until the next game_state, then holds its last value.
  const { clock } = table;
  const [tick, setTick] = useState({ start: 0, left: 30 });
  useEffect(() => {
    if (!clock?.running) return;
    const start = clock.start;
    const id = setInterval(() => {
      setTick({ start, left: Math.max(0, Math.ceil((SHOT_CLOCK_MS - (Date.now() - start)) / 1000)) });
    }, 1000);
    return () => clearInterval(id);
  }, [clock?.running, clock?.start]);
  const shotClockRemaining = clock && tick.start === clock.start ? tick.left : 30;

  // One stream for the page's life, closed by the cleanup whenever it unmounts (Strict Mode's double mount leaves one).
  useEffect(() => {
    const stream = new GameStream();
    streamRef.current = stream;
    let offlineTimer: ReturnType<typeof setTimeout> | null = null;
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
      if (status === 'open') {
        if (offlineTimer) clearTimeout(offlineTimer);
        offlineTimer = null;
        setIsConnected(true);
      } else if (!offlineTimer) {
        offlineTimer = setTimeout(() => setIsConnected(false), OFFLINE_AFTER_MS);
      }
    };
    // A failed first attempt starts the reconnect loop; onStatus reports when it gives up.
    stream.connect().catch(() => {}).finally(() => setTried(true));
    // On a refresh the stream opens in a moment; the connection bar waits for that, or 3 s at most.
    const triedTimer = setTimeout(() => setTried(true), 3000);
    return () => {
      stream.disconnect();
      streamRef.current = null;
      if (offlineTimer) clearTimeout(offlineTimer);
      clearTimeout(triedTimer);
    };
  }, []);

  return {
    gameState: table.gameState,
    isConnected,
    tried,
    gaveUp,
    tableNotice: table.notice,
    displayState: table.display,
    shotClockRemaining,
    buttonDetermination: table.buttonDetermination,
    stats,
    retry: () => streamRef.current?.retry(),
  };
}
