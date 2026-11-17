'use client';

import { useState, useEffect, useRef } from 'react';
import { GameStream, GameState, ServerMessage, TableNoticePayload } from '@/lib/api';
import { StatsResponse } from '@/lib/stats';
import { ButtonDetermination, Clock, DisplayState, EMPTY_TABLE, Tables, applyMessage, applyStats, fromFirstFrame } from '@/lib/stream';

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
  fromServer: boolean; // what shows is the server-rendered first frame, not yet confirmed by the stream's own snapshot
  retry: () => void;
}

// The server-rendered first frame (the ?ssr=1 draft): the engine's opening frames as the server read them, and how long
// before the page was rendered they were read.
export interface InitialFrame { frames: ServerMessage[]; ageMs: number }

export function useGameState(initial?: InitialFrame): UseGameStateReturn {
  // The first frame's tables and stats, timed from when the server read them on this page's clock: the navigation's
  // start less their age at render (an upper bound on their true age, so a shot clock or countdown never shows more
  // seconds than the engine has left). The render on the server times them from its own clock; nothing rendered
  // depends on the time (the seconds are drawn in effects), so hydration matches.
  const [first] = useState(() => initial
    ? fromFirstFrame(initial.frames, (typeof window === 'undefined' ? Date.now() : Math.round(performance.timeOrigin)) - initial.ageMs)
    : null);
  // Every table the stream reports, by table id; the page draws the only one.
  const [tables, setTables] = useState<Tables>(() => first?.tables ?? {});
  const [stats, setStats] = useState<StatsResponse | null>(() => first?.stats ?? null);
  // The first frame stands until the stream's own snapshot replaces it; if the stream has sent none by the time the page
  // says Offline, it is dropped and the page is blank as the default one is: figures the engine has not confirmed
  // are never shown as the table's for longer than OFFLINE_AFTER_MS.
  const [fromServer, setFromServer] = useState(!!first);
  const [connection, setConnection] = useState<Connection>('connecting');
  const [gaveUp, setGaveUp] = useState(false);
  const streamRef = useRef<GameStream | null>(null);

  const table = Object.values(tables)[0] ?? EMPTY_TABLE;

  // The shot clock runs from llm_thinking until the move arrives (llm_action), then holds the time left then. Its
  // seconds are drawn by the components that show it (useSecondsDraw), not rendered here each second.
  const { clock } = table;

  // One stream for the page's life, closed by the cleanup whenever it unmounts (Strict Mode's double mount leaves one).
  useEffect(() => {
    const stream = new GameStream();
    streamRef.current = stream;
    // Started now, so a first attempt that errors, or hangs, says down once, OFFLINE_AFTER_MS after load.
    let unconfirmed = !!first; // the first frame shows, and the stream has not sent its snapshot yet
    const down = () => {
      setConnection('down');
      if (!unconfirmed) return;
      unconfirmed = false;
      setFromServer(false);
      setTables({});
      setStats(null);
    };
    let offlineTimer: ReturnType<typeof setTimeout> | null = setTimeout(down, OFFLINE_AFTER_MS);
    // Timed from its arrival (lib/api), not from now: a message that waited for hydration is that much older.
    stream.onMessage = (m, at) => {
      if (m.type === 'stats') setStats(s => applyStats(s, m.payload as StatsResponse));
      else setTables(t => applyMessage(t, m, at));
      if (unconfirmed && m.type === 'snapshot') {
        unconfirmed = false;
        setFromServer(false);
      }
    };
    // Nothing is cleared on open: the snapshot that follows replaces the tables.
    stream.onStatus = (status) => {
      setGaveUp(status === 'gave_up');
      if (status === 'open' || status === 'gave_up') {
        if (offlineTimer) clearTimeout(offlineTimer);
        offlineTimer = null;
        if (status === 'open') setConnection('open');
        else down();
      } else if (!offlineTimer) {
        offlineTimer = setTimeout(down, OFFLINE_AFTER_MS);
      }
    };
    // A failed first attempt starts the reconnect loop; onStatus reports when it gives up.
    stream.connect().catch(() => {});
    return () => {
      stream.disconnect();
      streamRef.current = null;
      if (offlineTimer) clearTimeout(offlineTimer);
    };
  }, [first]);

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
    fromServer,
    retry: () => streamRef.current?.retry(),
  };
}
