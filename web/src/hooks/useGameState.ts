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

interface LLMDecision {
  playerIdx: number;
  playerName: string;
  action: string;
  amount: number;
  reason: string;
  receivedAt: number;
}

// Display phases for each LLM turn
type DisplayPhase = 'idle' | 'thinking' | 'reasoning' | 'revealed' | 'settling';

// What's currently being displayed to the user
interface DisplayState {
  phase: DisplayPhase;
  playerIdx: number;
  playerName: string;
  reason: string | null;
  action: string | null;
  amount: number;
  phaseStartTime: number;
}

import {
  THINKING_DURATION_MS,
  MIN_REASONING_DURATION_MS,
  SETTLE_DURATION_MS,
} from '@/lib/timing';

interface UseGameStateReturn {
  gameState: GameState | null;
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;
  actionRequired: ActionRequiredPayload | null;
  lastHandResult: HandCompletePayload | null;
  // Display state for UI (controlled timing)
  displayState: DisplayState | null;
  isPaused: boolean;
  isPausePending: boolean;
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
  phaseStartTime: 0,
};

export function useGameState(options: UseGameStateOptions = {}): UseGameStateReturn {
  const { autoConnect = false } = options;
  
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionRequired, setActionRequired] = useState<ActionRequiredPayload | null>(null);
  const [lastHandResult, setLastHandResult] = useState<HandCompletePayload | null>(null);
  const [isPaused, setIsPaused] = useState(false);
  const [isPausePending, setIsPausePending] = useState(false);
  const [displayState, setDisplayState] = useState<DisplayState | null>(null);
  
  const wsRef = useRef<PokerWebSocket | null>(null);
  
  // Queue of pending decisions from backend
  const decisionQueueRef = useRef<LLMDecision[]>([]);
  // Currently processing decision
  const currentDecisionRef = useRef<LLMDecision | null>(null);
  // Timer for phase transitions
  const phaseTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Process the display queue
  const processQueue = useCallback(() => {
    // If paused, don't process
    if (isPaused) return;
    
    // If already processing a decision, don't start another
    if (currentDecisionRef.current) return;
    
    // Get next decision from queue
    const nextDecision = decisionQueueRef.current.shift();
    if (!nextDecision) {
      // Queue empty, go idle
      setDisplayState(null);
      return;
    }
    
    currentDecisionRef.current = nextDecision;
    const now = Date.now();
    
    // Start with "Thinking" phase
    setDisplayState({
      phase: 'thinking',
      playerIdx: nextDecision.playerIdx,
      playerName: nextDecision.playerName,
      reason: null,
      action: null,
      amount: 0,
      phaseStartTime: now,
    });
    
      // After THINKING_DURATION, transition to "reasoning" phase
      phaseTimerRef.current = setTimeout(() => {
      if (!currentDecisionRef.current) return;
      
      const reasoningStartTime = Date.now();
      setDisplayState(prev => prev ? {
        ...prev,
        phase: 'reasoning',
        reason: currentDecisionRef.current!.reason,
        phaseStartTime: reasoningStartTime,
      } : null);
      
      // After MIN_REASONING_DURATION, reveal the action
      phaseTimerRef.current = setTimeout(() => {
        if (!currentDecisionRef.current) return;
        
        const revealTime = Date.now();
        setDisplayState(prev => prev ? {
          ...prev,
          phase: 'revealed',
          action: currentDecisionRef.current!.action,
          amount: currentDecisionRef.current!.amount,
          phaseStartTime: revealTime,
        } : null);
        
        // After SETTLE_DURATION, move to next
        phaseTimerRef.current = setTimeout(() => {
          currentDecisionRef.current = null;
          processQueue();
        }, SETTLE_DURATION_MS);
        
      }, MIN_REASONING_DURATION_MS);
      
      }, THINKING_DURATION_MS);
    
  }, [isPaused]);

  // Handle incoming LLM thinking notification (player is now deciding)
  const handleLLMThinking = useCallback((payload: { playerIdx: number; playerName: string }) => {
    // If this is just a "starting to think" notification without a reason,
    // we'll wait for the full decision to come in via llm_action
    console.log('LLM starting to think:', payload.playerName);
  }, []);

  // Handle incoming LLM decision (complete with action + reason)
  const handleLLMAction = useCallback((payload: LLMDecision) => {
    console.log('LLM decision received:', payload.playerName, payload.action);
    
    // Add to queue
    decisionQueueRef.current.push({
      ...payload,
      receivedAt: Date.now(),
    });
    
    // If not currently processing, start processing
    if (!currentDecisionRef.current) {
      processQueue();
    }
  }, [processQueue]);

  // Clear queue on hand complete or new hand
  const clearDisplayQueue = useCallback(() => {
    decisionQueueRef.current = [];
    currentDecisionRef.current = null;
    if (phaseTimerRef.current) {
      clearTimeout(phaseTimerRef.current);
      phaseTimerRef.current = null;
    }
    setDisplayState(null);
  }, []);

  // Resume processing when unpaused
  useEffect(() => {
    if (!isPaused && currentDecisionRef.current === null && decisionQueueRef.current.length > 0) {
      processQueue();
    }
  }, [isPaused, processQueue]);

  const connect = useCallback(async () => {
    if (wsRef.current?.isConnected()) {
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const ws = new PokerWebSocket();
      
      ws.on('game_state', (payload) => {
        setGameState(payload as GameState);
        setIsLoading(false);
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
        clearDisplayQueue();
      });

      ws.on('hand_start', () => {
        setLastHandResult(null);
        setActionRequired(null);
        clearDisplayQueue();
      });

      ws.on('street_change', () => {
        // Street changed - don't clear display, let current action finish
      });

      ws.on('shot_clock', () => {
        // No longer used - frontend handles timing
      });

      ws.on('llm_thinking', (payload) => {
        handleLLMThinking(payload as { playerIdx: number; playerName: string });
      });

      ws.on('llm_action', (payload) => {
        handleLLMAction(payload as LLMDecision);
      });

      ws.on('paused', () => {
        setIsPaused(true);
        setIsPausePending(false);
      });

      ws.on('resumed', () => {
        setIsPaused(false);
        setIsPausePending(false);
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
  }, [handleLLMThinking, handleLLMAction, clearDisplayQueue]);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.disconnect();
      wsRef.current = null;
    }
    setIsConnected(false);
    setGameState(null);
    setActionRequired(null);
    clearDisplayQueue();
  }, [clearDisplayQueue]);

  const newGame = useCallback((payload: NewGamePayload) => {
    if (!wsRef.current?.isConnected()) {
      setError('Not connected');
      return;
    }
    setIsLoading(true);
    setError(null);
    setLastHandResult(null);
    clearDisplayQueue();
    wsRef.current.newGame(payload);
  }, [clearDisplayQueue]);

  const startHand = useCallback(() => {
    if (!wsRef.current?.isConnected()) {
      setError('Not connected');
      return;
    }
    setIsLoading(true);
    setError(null);
    setLastHandResult(null);
    clearDisplayQueue();
    wsRef.current.startHand();
  }, [clearDisplayQueue]);

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
    setIsPausePending(true);
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

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (phaseTimerRef.current) {
        clearTimeout(phaseTimerRef.current);
      }
    };
  }, []);

  return {
    gameState,
    isConnected,
    isLoading,
    error,
    actionRequired,
    lastHandResult,
    displayState,
    isPaused,
    isPausePending,
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
