'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  PokerWebSocket,
  GameState,
  ActionRequiredPayload,
  HandCompletePayload,
  ErrorPayload,
  NewGamePayload,
  ActionPayload,
  ButtonCardPayload,
  ButtonWinnerPayload,
} from '@/lib/api';

import { SHOT_CLOCK_MS } from '@/lib/timing';

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
type DisplayPhase = 'idle' | 'waiting' | 'thinking' | 'reasoning' | 'revealed';

// What's currently being displayed to the user
interface DisplayState {
  phase: DisplayPhase;
  playerIdx: number;
  playerName: string;
  reason: string | null;
  action: string | null;
  amount: number;
  turnStartTime: number; // For shot clock countdown
}

// Button determination state
interface ButtonCard {
  playerIdx: number;
  playerName: string;
  card: string;
}

interface ButtonDetermination {
  cards: ButtonCard[];
  winnerIdx: number | null;
  winnerName: string | null;
  isComplete: boolean;
}

interface UseGameStateReturn {
  gameState: GameState | null;
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;
  actionRequired: ActionRequiredPayload | null;
  lastHandResult: HandCompletePayload | null;
  displayState: DisplayState | null;
  isPaused: boolean;
  shotClockRemaining: number; // Seconds remaining on shot clock
  buttonDetermination: ButtonDetermination | null;
  connect: () => Promise<void>;
  disconnect: () => void;
  newGame: (payload: NewGamePayload) => void;
  startHand: () => void;
  submitAction: (action: ActionPayload['action'], amount?: number) => void;
  clearError: () => void;
  pause: () => void;
  resume: () => void;
}

const initialDisplayState: DisplayState = {
  phase: 'idle',
  playerIdx: -1,
  playerName: '',
  reason: null,
  action: null,
  amount: 0,
  turnStartTime: 0,
};

export function useGameState(options: UseGameStateOptions = {}): UseGameStateReturn {
  const { autoConnect = false } = options;
  
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const connectingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [actionRequired, setActionRequired] = useState<ActionRequiredPayload | null>(null);
  const [lastHandResult, setLastHandResult] = useState<HandCompletePayload | null>(null);
  const [isPaused, setIsPaused] = useState(false);
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

      ws.on('action_required', (payload) => {
        setActionRequired(payload as ActionRequiredPayload);
      });

      ws.on('hand_complete', (payload) => {
        setLastHandResult(payload as HandCompletePayload);
        setActionRequired(null);
      });

      ws.on('hand_start', () => {
        setLastHandResult(null);
        setActionRequired(null);
        setButtonDetermination(null); // Clear button determination when hand starts
        clearQueues();
      });

      ws.on('street_change', () => {
        // Street changed - continue processing, don't interrupt
      });

      ws.on('llm_thinking', (payload) => {
        handleLLMThinking(payload as { playerIdx: number; playerName: string });
      });

      ws.on('llm_action', (payload) => {
        handleLLMAction(payload as LLMDecision);
      });

      ws.on('paused', () => {
        setIsPaused(true);
      });

      ws.on('resumed', () => {
        setIsPaused(false);
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

      await ws.connect();
      wsRef.current = ws;
      setIsConnected(true);
      setIsLoading(false);
      connectingRef.current = false;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to connect');
      setIsConnected(false);
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
    setActionRequired(null);
    clearQueues();
  }, [clearQueues]);

  const newGame = useCallback((payload: NewGamePayload) => {
    if (!wsRef.current?.isConnected()) {
      setError('Not connected');
      return;
    }
    setIsLoading(true);
    setError(null);
    setLastHandResult(null);
    clearQueues();
    wsRef.current.newGame(payload);
  }, [clearQueues]);

  const startHand = useCallback(() => {
    if (!wsRef.current?.isConnected()) {
      setError('Not connected');
      return;
    }
    setIsLoading(true);
    setError(null);
    setLastHandResult(null);
    clearQueues();
    wsRef.current.startHand();
  }, [clearQueues]);

  const submitAction = useCallback((action: ActionPayload['action'], amount?: number) => {
    if (!wsRef.current?.isConnected()) {
      setError('Not connected');
      return;
    }
    if (gameState === null) {
      setError('No game state');
      return;
    }

    const payload: ActionPayload = {
      playerIdx: gameState.currentPlayerIdx,
      action,
      amount,
    };

    setActionRequired(null);
    wsRef.current.action(payload);
  }, [gameState]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const pause = useCallback(() => {
    if (!wsRef.current?.isConnected()) {
      return;
    }
    // Pause is immediate now - backend will respond with 'paused' message
    wsRef.current.send({ type: 'pause' });
  }, []);

  const resume = useCallback(() => {
    if (!wsRef.current?.isConnected()) {
      return;
    }
    wsRef.current.send({ type: 'resume' });
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
    isLoading,
    error,
    actionRequired,
    lastHandResult,
    displayState,
    isPaused,
    shotClockRemaining,
    buttonDetermination,
    connect,
    disconnect,
    newGame,
    startHand,
    submitAction,
    clearError,
    pause,
    resume,
  };
}
