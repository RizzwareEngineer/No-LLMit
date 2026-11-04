'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  PokerWebSocket,
  GameState,
  HandCompletePayload,
  ErrorPayload,
  ButtonCardPayload,
  ButtonWinnerPayload,
  TableNoticePayload,
} from '@/lib/api';

// The engine's per-turn time limit, shown as the shot clock.
const SHOT_CLOCK_MS = 30000;

interface UseGameStateOptions {
  autoConnect?: boolean;
}

interface LLMDecision {
  playerIdx: number;
  playerName: string;
  action: string;
  amount: number;
  reason: string;
}

// Display phases for each LLM turn
export type DisplayPhase = 'idle' | 'waiting' | 'thinking' | 'reasoning' | 'revealed';

// What's currently being displayed to the user
export interface DisplayState {
  phase: DisplayPhase;
  playerIdx: number;
  playerName: string;
  reason: string | null;
  action: string | null;
  amount: number;
  turnStartTime: number; // For shot clock countdown
}

// Button determination state
export interface ButtonCard {
  playerIdx: number;
  playerName: string;
  card: string;
}

export interface ButtonDetermination {
  cards: ButtonCard[];
  winnerIdx: number | null;
  winnerName: string | null;
  isComplete: boolean;
}

interface UseGameStateReturn {
  gameState: GameState | null;
  isConnected: boolean;
  gaveUp: boolean; // reconnect attempts exhausted
  tableNotice: TableNoticePayload | null; // table closed or capped
  isLoading: boolean;
  error: string | null;
  lastHandResult: HandCompletePayload | null;
  displayState: DisplayState | null;
  shotClockRemaining: number; // Seconds remaining on shot clock
  buttonDetermination: ButtonDetermination | null;
  connect: () => Promise<void>;
  retry: () => void;
  disconnect: () => void;
  clearError: () => void;
}

export function useGameState(options: UseGameStateOptions = {}): UseGameStateReturn {
  const { autoConnect = false } = options;
  
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [gaveUp, setGaveUp] = useState(false);
  const [tableNotice, setTableNotice] = useState<TableNoticePayload | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const connectingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [lastHandResult, setLastHandResult] = useState<HandCompletePayload | null>(null);
  const [displayState, setDisplayState] = useState<DisplayState | null>(null);
  const [shotClockRemaining, setShotClockRemaining] = useState(30);
  const [buttonDetermination, setButtonDetermination] = useState<ButtonDetermination | null>(null);
  
  const wsRef = useRef<PokerWebSocket | null>(null);
  
  // Timer refs
  const shotClockIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Clear all timers
  const clearTimers = useCallback(() => {
    if (shotClockIntervalRef.current) {
      clearInterval(shotClockIntervalRef.current);
      shotClockIntervalRef.current = null;
    }
  }, []);

  // Start shot clock countdown display
  const startShotClockDisplay = useCallback((startTime: number) => {
    // Clear existing interval
    if (shotClockIntervalRef.current) {
      clearInterval(shotClockIntervalRef.current);
    }
    
    // Update every second
    shotClockIntervalRef.current = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const remaining = Math.max(0, Math.ceil((SHOT_CLOCK_MS - elapsed) / 1000));
      setShotClockRemaining(remaining);
    }, 1000);
    
    // Initial update
    setShotClockRemaining(30);
  }, []);

  // The server owns the clock: it sends llm_thinking, then llm_action, then the
  // game_state with the action applied, each at the moment it should appear.

  // A player's turn has started
  const handleLLMThinking = useCallback((payload: { playerIdx: number; playerName: string }) => {
    const turnStartTime = Date.now();
    startShotClockDisplay(turnStartTime);
    setDisplayState({
      phase: 'thinking',
      playerIdx: payload.playerIdx,
      playerName: payload.playerName,
      reason: null,
      action: null,
      amount: 0,
      turnStartTime,
    });
  }, [startShotClockDisplay]);

  // The player's decision and reasoning are in
  const handleLLMAction = useCallback((payload: LLMDecision) => {
    setDisplayState(prev => ({
      phase: 'reasoning',
      playerIdx: payload.playerIdx,
      playerName: payload.playerName,
      reason: payload.reason,
      action: payload.action,
      amount: payload.amount,
      turnStartTime: prev?.playerIdx === payload.playerIdx ? prev.turnStartTime : Date.now(),
    }));
  }, []);

  // The action has been applied to the table
  const handleGameState = useCallback((newState: GameState) => {
    setGameState(newState);
    setDisplayState(prev => prev?.phase === 'reasoning' ? { ...prev, phase: 'revealed' } : prev);
    if (shotClockIntervalRef.current) {
      clearInterval(shotClockIntervalRef.current);
      shotClockIntervalRef.current = null;
    }
    setIsLoading(false);
  }, []);

  // Reset the turn display
  const clearQueues = useCallback(() => {
    clearTimers();
    setDisplayState(null);
    setShotClockRemaining(30);
  }, [clearTimers]);

  const connect = useCallback(async () => {
    if (wsRef.current?.isConnected()) {
      return;
    }
    
    if (connectingRef.current || isLoading) {
      return;
    }

    connectingRef.current = true;
    setIsLoading(true);
    setError(null);

    try {
      const ws = new PokerWebSocket();
      
      ws.on('game_state', (payload) => {
        handleGameState(payload as GameState);
      });

      ws.on('error', (payload) => {
        const err = payload as ErrorPayload;
        setError(err.message);
        setIsLoading(false);
        if (err.message.includes('No game found') || err.message.includes('game not found')) {
          setGameState(null);
        }
      });

      ws.on('hand_complete', (payload) => {
        setLastHandResult(payload as HandCompletePayload);
      });

      ws.on('table_notice', (payload) => {
        const notice = payload as TableNoticePayload;
        setTableNotice(notice.kind ? notice : null);
      });

      ws.on('hand_start', () => {
        setTableNotice(null);
        setLastHandResult(null);
        setButtonDetermination(null); // Clear button determination when hand starts
        clearQueues();
      });

      ws.on('llm_thinking', (payload) => {
        handleLLMThinking(payload as { playerIdx: number; playerName: string });
      });

      ws.on('llm_action', (payload) => {
        handleLLMAction(payload as LLMDecision);
      });

      ws.on('button_card', (payload) => {
        const bc = payload as ButtonCardPayload;
        setButtonDetermination(prev => ({
          cards: [...(prev?.cards || []), { playerIdx: bc.playerIdx, playerName: bc.playerName, card: bc.card }],
          winnerIdx: null,
          winnerName: null,
          isComplete: false,
        }));
      });

      ws.on('button_winner', (payload) => {
        const bw = payload as ButtonWinnerPayload;
        setButtonDetermination(prev => prev ? {
          ...prev,
          winnerIdx: bw.playerIdx,
          winnerName: bw.playerName,
          isComplete: true,
        } : null);
      });

      ws.onStatus = (status) => {
        setIsConnected(status === 'open');
        setGaveUp(status === 'gave_up');
        // The server resends the current turn and any notice on join, so drop what we had
        if (status === 'open') {
          setTableNotice(null);
          clearQueues();
        }
      };
      try {
        await ws.connect();
      } catch {
        // A failed first attempt closes the socket, which starts the reconnect loop;
        // onStatus reports when it gives up.
      }
      // Set after the first attempt (not before) so a Strict Mode effect cleanup
      // during the handshake does not close it.
      wsRef.current = ws;
    } finally {
      setIsLoading(false);
      connectingRef.current = false;
    }
  }, [handleGameState, handleLLMThinking, handleLLMAction, clearQueues, isLoading]);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.disconnect();
      wsRef.current = null;
    }
    setIsConnected(false);
    setGameState(null);
    clearQueues();
  }, [clearQueues]);

  const retry = useCallback(() => {
    if (wsRef.current) wsRef.current.retry();
    else connect();
  }, [connect]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  // Auto-connect if option is set
  useEffect(() => {
    if (autoConnect) {
      connect();
    }

    return () => {
      if (wsRef.current) {
        wsRef.current.disconnect();
        wsRef.current = null;
      }
      clearTimers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoConnect]);

  return {
    gameState,
    isConnected,
    gaveUp,
    tableNotice,
    isLoading,
    error,
    lastHandResult,
    displayState,
    shotClockRemaining,
    buttonDetermination,
    connect,
    retry,
    disconnect,
    clearError,
  };
}
