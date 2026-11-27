'use client';

import { useState, useEffect, useRef } from 'react';
import { GameStream, GameState, TableNoticePayload } from '@/lib/api';
import { StatsResponse } from '@/lib/stats';
import { ButtonDetermination, Clock, DisplayState, EMPTY_TABLE, Tables, applyMessage, applyStats } from '@/lib/stream';

// How long the stream may be down before the page says Offline: the server ends every stream after 10 to 14 minutes,
// and the reopen that follows should not flash the connection bar. A page load waits as long for its first open.
const OFFLINE_AFTER_MS = 4000;

// Not known yet (the page has just loaded), open, or down for OFFLINE_AFTER_MS (or given up).
export type Connection = 'connecting' | 'open' | 'down';

interface UseGameStateReturn {
  gameState: GameState | null;
  dealAt: number | null; // Date.now() of the next deal (lib/stream)
  connection: Connection;
  gaveUp: boolean; // reconnect attempts exhausted
  tableNotice: TableNoticePayload | null; // table closed, capped, in an outage or saving
  displayState: DisplayState | null;
  clock: Clock | null; // the shot clock; null: no clock (the engine sent no budget)
  buttonDetermination: ButtonDetermination | null;
  stats: StatsResponse | null; // all-time stats, from the stream
  retry: () => void;
}

export function useGameState(): UseGameStateReturn {
  // Every table the stream reports, by table key, in the engine's configured order; the page draws the 5/10 one, else the first.
  const [tables, setTables] = useState<Tables>({});
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [connection, setConnection] = useState<Connection>('connecting');
  const [gaveUp, setGaveUp] = useState(false);
  const streamRef = useRef<GameStream | null>(null);

  const all = Object.values(tables);
  const table = all.find(t => t.gameState?.stakes.smallBlind === 5 && t.gameState.stakes.bigBlind === 10) ?? all[0] ?? EMPTY_TABLE;

  // The shot clock runs from llm_thinking until the move arrives (llm_action), then holds the time left then. Its
  // seconds are drawn by the components that show it (useSecondsDraw), not rendered here each second.
  const { clock } = table;

  // One stream for the page's life, closed by the cleanup whenever it unmounts (Strict Mode's double mount leaves one).
  useEffect(() => {
    const stream = new GameStream();
    streamRef.current = stream;
    // Started now, so a first attempt that errors, or hangs, says down once, OFFLINE_AFTER_MS after load.
    let offlineTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => setConnection('down'), OFFLINE_AFTER_MS);
    // Timed from its arrival (lib/api), not from now: a message that waited for hydration is that much older.
    stream.onMessage = (m, at) => {
      if (m.type === 'stats') setStats(s => applyStats(s, m.payload as StatsResponse));
      else setTables(t => applyMessage(t, m, at));
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
    dealAt: table.dealAt,
    connection,
    gaveUp,
    tableNotice: table.notice,
    displayState: table.display,
    clock,
    buttonDetermination: table.buttonDetermination,
    stats,
    retry: () => streamRef.current?.retry(),
  };
}
