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

import {
  POST_ACTION_DELAY_MS,
  THINKING_DURATION_MS,
  MIN_REASONING_DURATION_MS,
  MAX_REASONING_DURATION_MS,
  SHOT_CLOCK_MS,
} from '@/lib/timing';

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

interface UseGameStateReturn {
  gameState: GameState | null;
  isConnected: boolean;
  isLoading: boolean;
  error: string | null;
  actionRequired: ActionRequiredPayload | null;
  lastHandResult: HandCompletePayload | null;
  displayState: DisplayState | null;
  isPaused: boolean;
  isPausePending: boolean;
  shotClockRemaining: number; // Seconds remaining on shot clock
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
  const [isPausePending, setIsPausePending] = useState(false);
  const [displayState, setDisplayState] = useState<DisplayState | null>(null);
  const [shotClockRemaining, setShotClockRemaining] = useState(30);
  
  const wsRef = useRef<PokerWebSocket | null>(null);
  
  // Queue of pending decisions from backend (computed ahead)
  const decisionQueueRef = useRef<LLMDecision[]>([]);
  // Queue of pending game states from backend
  const gameStateQueueRef = useRef<GameState[]>([]);
  // Is the display system currently processing a player's turn?
  const isProcessingRef = useRef(false);
  // Timer refs
  const phaseTimerRef = useRef<NodeJS.Timeout | null>(null);
  const shotClockTimerRef = useRef<NodeJS.Timeout | null>(null);
  const shotClockIntervalRef = useRef<NodeJS.Timeout | null>(null);

  // Calculate reasoning duration based on text length (5-10 seconds)
  const getReasoningDuration = (reason: string): number => {
    const length = reason?.length || 0;
    // Scale from 5s (short) to 10s (long) based on text length
    // Assume ~50 chars = 5s, ~200+ chars = 10s
    const scale = Math.min(1, Math.max(0, (length - 50) / 150));
    return MIN_REASONING_DURATION_MS + (scale * (MAX_REASONING_DURATION_MS - MIN_REASONING_DURATION_MS));
  };

  // Clear all timers
  const clearTimers = useCallback(() => {
    if (phaseTimerRef.current) {
      clearTimeout(phaseTimerRef.current);
      phaseTimerRef.current = null;
    }
    if (shotClockTimerRef.current) {
      clearTimeout(shotClockTimerRef.current);
      shotClockTimerRef.current = null;
    }
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

  // Process the next decision in the queue
  const processNextDecision = useCallback(() => {
    if (isPaused) return;
    if (isProcessingRef.current) return;
    
    const decision = decisionQueueRef.current.shift();
    if (!decision) {
      // No more decisions, go idle
      setDisplayState(null);
      isProcessingRef.current = false;
      return;
    }
    
    isProcessingRef.current = true;
    const turnStartTime = Date.now();
    
    // Start shot clock display
    startShotClockDisplay(turnStartTime);
    
    // PHASE 1: Thinking (5 seconds)
    setDisplayState({
      phase: 'thinking',
      playerIdx: decision.playerIdx,
      playerName: decision.playerName,
      reason: null,
      action: null,
      amount: 0,
      turnStartTime,
    });
    
    phaseTimerRef.current = setTimeout(() => {
      // PHASE 2: Reasoning (5-10 seconds based on length)
      const reasoningDuration = getReasoningDuration(decision.reason);
      
      setDisplayState({
        phase: 'reasoning',
        playerIdx: decision.playerIdx,
        playerName: decision.playerName,
        reason: decision.reason,
        action: null,
        amount: 0,
        turnStartTime,
      });
      
      phaseTimerRef.current = setTimeout(() => {
        // PHASE 3: Revealed - show action
        setDisplayState({
          phase: 'revealed',
          playerIdx: decision.playerIdx,
          playerName: decision.playerName,
          reason: decision.reason,
          action: decision.action,
          amount: decision.amount,
          turnStartTime,
        });
        
        // Apply the corresponding game state update
        const nextGameState = gameStateQueueRef.current.shift();
        if (nextGameState) {
          setGameState(nextGameState);
        }
        
        // Stop shot clock interval
        if (shotClockIntervalRef.current) {
          clearInterval(shotClockIntervalRef.current);
          shotClockIntervalRef.current = null;
        }
        
        // PHASE 4: Wait POST_ACTION_DELAY then move to next
        phaseTimerRef.current = setTimeout(() => {
          isProcessingRef.current = false;
          phaseTimerRef.current = null;
          
          // Process next decision
          processNextDecision();
        }, POST_ACTION_DELAY_MS);
        
      }, reasoningDuration);
      
    }, THINKING_DURATION_MS);
    
  }, [isPaused, startShotClockDisplay]);

  // Handle shot clock timeout (auto-fold)
  const handleShotClockTimeout = useCallback(() => {
    console.log('Shot clock timeout - would auto-fold');
    // In a real implementation, we'd send a fold action to the backend
    // For now, just continue processing
    isProcessingRef.current = false;
    processNextDecision();
  }, [processNextDecision]);

  // Handle incoming LLM decision (queued from backend)
  const handleLLMAction = useCallback((payload: LLMDecision) => {
    // Add to queue
    decisionQueueRef.current.push(payload);
    
    // If not currently processing, start
    if (!isProcessingRef.current && !isPaused) {
      processNextDecision();
    }
  }, [processNextDecision, isPaused]);

  // Handle game state update (queue it to sync with decisions)
  const handleGameState = useCallback((newState: GameState) => {
    // If we have pending decisions, queue this state
    if (decisionQueueRef.current.length > 0 || isProcessingRef.current) {
      gameStateQueueRef.current.push(newState);
    } else {
      // No pending decisions, apply immediately
      setGameState(newState);
    }
    setIsLoading(false);
  }, []);

  // Clear all queues
  const clearQueues = useCallback(() => {
    decisionQueueRef.current = [];
    gameStateQueueRef.current = [];
    isProcessingRef.current = false;
    clearTimers();
    setDisplayState(null);
    setShotClockRemaining(30);
  }, [clearTimers]);

  // Resume processing when unpaused
  useEffect(() => {
    if (!isPaused && !isProcessingRef.current && decisionQueueRef.current.length > 0) {
      processNextDecision();
    }
  }, [isPaused, processNextDecision]);

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
        // Don't clear queues - let remaining decisions play out
      });

      ws.on('hand_start', () => {
        setLastHandResult(null);
        setActionRequired(null);
        clearQueues();
      });

      ws.on('street_change', () => {
        // Street changed - continue processing, don't interrupt
      });

      ws.on('llm_thinking', () => {
        // Just a notification that LLM is thinking - we wait for llm_action
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
      connectingRef.current = false;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to connect');
      setIsConnected(false);
      setIsLoading(false);
      connectingRef.current = false;
    }
  }, [handleGameState, handleLLMAction, clearQueues, isLoading]);

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
    isPausePending,
    shotClockRemaining,
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
