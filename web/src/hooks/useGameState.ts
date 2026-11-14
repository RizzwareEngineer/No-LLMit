'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { GameStream, GameState, HandCompletePayload, MessageType, TableNoticePayload } from '@/lib/api';
import { StatsResponse } from '@/lib/stats';
import { ButtonDetermination, DisplayState, EMPTY_TABLE, Tables, applyMessage, applyStats } from '@/lib/stream';

export type { ButtonCard, ButtonDetermination, DisplayPhase, DisplayState } from '@/lib/stream';

// The engine's per-turn time limit, shown as the shot clock.
const SHOT_CLOCK_MS = 30000;
// How long the stream may be down before the page says Offline: the server ends every stream after 10 to 14 minutes,
// and the reopen that follows should not flash the connection bar.
const OFFLINE_AFTER_MS = 4000;

const TABLE_MESSAGES: MessageType[] = [
  'snapshot', 'game_state', 'hand_start', 'street_change', 'hand_complete',
  'llm_thinking', 'llm_action', 'button_card', 'button_winner', 'table_notice',
];

interface UseGameStateOptions {
  autoConnect?: boolean;
}

interface UseGameStateReturn {
  gameState: GameState | null;
  isConnected: boolean;
  gaveUp: boolean; // reconnect attempts exhausted
  tableNotice: TableNoticePayload | null; // table closed, capped, in an outage or saving
  isLoading: boolean;
  lastHandResult: HandCompletePayload | null;
  displayState: DisplayState | null;
  shotClockRemaining: number; // Seconds remaining on shot clock
  buttonDetermination: ButtonDetermination | null;
  stats: StatsResponse | null; // all-time stats, from the stream
  connect: () => Promise<void>;
  retry: () => void;
  disconnect: () => void;
}

export function useGameState(options: UseGameStateOptions = {}): UseGameStateReturn {
  const { autoConnect = false } = options;

  // Every table the stream reports, by table id; the page draws the only one.
  const [tables, setTables] = useState<Tables>({});
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const connectingRef = useRef(false);
  const offlineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  const clearOfflineTimer = () => {
    if (offlineTimerRef.current) clearTimeout(offlineTimerRef.current);
    offlineTimerRef.current = null;
  };

  const connect = useCallback(async () => {
    if (streamRef.current) {
      return;
    }

    if (connectingRef.current || isLoading) {
      return;
    }

    connectingRef.current = true;
    setIsLoading(true);

    try {
      const stream = new GameStream();

      for (const type of TABLE_MESSAGES) {
        stream.on(type, (m) => {
          const now = Date.now();
          setTables(t => applyMessage(t, m, now));
        });
      }
      stream.on('stats', (m) => {
        setStats(s => applyStats(s, m.payload as StatsResponse));
      });

      // Nothing is cleared on open: the snapshot that follows replaces the tables.
      stream.onStatus = (status) => {
        setGaveUp(status === 'gave_up');
        if (status === 'open') {
          clearOfflineTimer();
          setIsConnected(true);
        } else if (!offlineTimerRef.current) {
          offlineTimerRef.current = setTimeout(() => setIsConnected(false), OFFLINE_AFTER_MS);
        }
      };
      try {
        await stream.connect();
      } catch {
        // A failed first attempt starts the reconnect loop; onStatus reports when it gives up.
      }
      // Set after the first attempt (not before) so a Strict Mode effect cleanup
      // during the handshake does not close it.
      streamRef.current = stream;
    } finally {
      setIsLoading(false);
      connectingRef.current = false;
    }
  }, [isLoading]);

  const disconnect = useCallback(() => {
    if (streamRef.current) {
      streamRef.current.disconnect();
      streamRef.current = null;
    }
    clearOfflineTimer();
    setIsConnected(false);
    setTables({});
  }, []);

  const retry = useCallback(() => {
    if (streamRef.current) streamRef.current.retry();
    else connect();
  }, [connect]);

  // Auto-connect if option is set
  useEffect(() => {
    if (autoConnect) {
      connect();
    }

    return () => {
      if (streamRef.current) {
        streamRef.current.disconnect();
        streamRef.current = null;
      }
      clearOfflineTimer();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoConnect]);

  return {
    gameState: table.gameState,
    isConnected,
    gaveUp,
    tableNotice: table.notice,
    isLoading,
    lastHandResult: table.lastHandResult,
    displayState: table.display,
    shotClockRemaining,
    buttonDetermination: table.buttonDetermination,
    stats,
    connect,
    retry,
    disconnect,
  };
}
