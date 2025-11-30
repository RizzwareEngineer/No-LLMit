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
} from '@/lib/api';

interface UseGameStateOptions {
  autoConnect?: boolean;
}

interface ShotClockState {
  playerIdx: number;
  playerName: string;
  secondsLeft: number;
}

interface LLMThinkingState {
  playerIdx: number;
  playerName: string;
  reason?: string; // Filled in once API returns
}

interface LLMActionState {
  playerIdx: number;
  playerName: string;
  action: string;
  amount: number;
  reason: string;
}

interface UseGameStateReturn {
  gameState: GameState | null;
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;
  actionRequired: ActionRequiredPayload | null;
  lastHandResult: HandCompletePayload | null;
  shotClock: ShotClockState | null;
  llmThinking: LLMThinkingState | null;
  lastLLMAction: LLMActionState | null;
  isPaused: boolean;
  connect: () => Promise<void>;
  disconnect: () => void;
  newGame: (payload: NewGamePayload) => void;
  startHand: () => void;
  submitAction: (action: ActionPayload['action'], amount?: number) => void;
  clearError: () => void;
  pause: () => void;
  resume: () => void;
}

export function useGameState(options: UseGameStateOptions = {}): UseGameStateReturn {
  const { autoConnect = false } = options;
  
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionRequired, setActionRequired] = useState<ActionRequiredPayload | null>(null);
  const [lastHandResult, setLastHandResult] = useState<HandCompletePayload | null>(null);
  const [shotClock, setShotClock] = useState<ShotClockState | null>(null);
  const [llmThinking, setLLMThinking] = useState<LLMThinkingState | null>(null);
  const [lastLLMAction, setLastLLMAction] = useState<LLMActionState | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  
  const wsRef = useRef<PokerWebSocket | null>(null);

  const connect = useCallback(async () => {
    if (wsRef.current?.isConnected()) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const ws = new PokerWebSocket();
      
      // Set up handlers before connecting
      ws.on('game_state', (payload) => {
        setGameState(payload as GameState);
        setIsLoading(false);
      });

      ws.on('error', (payload) => {
        const err = payload as ErrorPayload;
        setError(err.message);
        setIsLoading(false);
        // If game not found, clear game state so auto-create triggers
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
      });

      ws.on('street_change', () => {
        // Street changed, action_required will follow
        setShotClock(null);
        setLLMThinking(null);
      });

      ws.on('shot_clock', (payload) => {
        const clock = payload as ShotClockState;
        // -1 means clear the shot clock
        if (clock.secondsLeft < 0) {
          setShotClock(null);
        } else {
          setShotClock(clock);
        }
      });

      ws.on('llm_thinking', (payload) => {
        const thinking = payload as LLMThinkingState;
        console.log('LLM Thinking:', thinking);
        setLLMThinking(thinking);
        setLastLLMAction(null);
      });

      ws.on('llm_action', (payload) => {
        setLastLLMAction(payload as LLMActionState);
        setLLMThinking(null);
        setShotClock(null);
      });

      ws.on('paused', () => {
        setIsPaused(true);
      });

      ws.on('resumed', () => {
        setIsPaused(false);
      });

      await ws.connect();
      wsRef.current = ws;
      setIsConnected(true);
      setIsLoading(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to connect');
      setIsConnected(false);
      setIsLoading(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.disconnect();
      wsRef.current = null;
    }
    setIsConnected(false);
    setGameState(null);
    setActionRequired(null);
  }, []);

  const newGame = useCallback((payload: NewGamePayload) => {
    if (!wsRef.current?.isConnected()) {
      setError('Not connected');
      return;
    }
    setIsLoading(true);
    setError(null);
    setLastHandResult(null);
    wsRef.current.newGame(payload);
  }, []);

  const startHand = useCallback(() => {
    if (!wsRef.current?.isConnected()) {
      setError('Not connected');
      return;
    }
    setIsLoading(true);
    setError(null);
    setLastHandResult(null);
    wsRef.current.startHand();
  }, []);

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
      disconnect();
    };
  }, [autoConnect, connect, disconnect]);

  return {
    gameState,
    isConnected,
    isLoading,
    error,
    actionRequired,
    lastHandResult,
    shotClock,
    llmThinking,
    lastLLMAction,
    isPaused,
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

