// Display timing constants for LLM decision phases
// Used by useGameState.ts (logic) and ReasoningPanel.tsx (UI)

// ============================================
// FRONTEND TIMING FLOW (per player)
// ============================================
// 1. Previous action concludes → Wait POST_ACTION_DELAY
// 2. Current player's turn:
//    - THINKING_DURATION: Show "Thinking..."
//    - REASONING_DURATION: Typewriter effect (5-10s)
//    - When typing done: Reveal action
// 3. Wait POST_ACTION_DELAY
// 4. Next player
// ============================================

/** Delay after action reveal before moving to next player (milliseconds) */
export const POST_ACTION_DELAY_MS = 5000;

/** Duration of "Thinking..." phase in milliseconds */
export const THINKING_DURATION_MS = 5000;

/** Minimum time for reasoning typewriter (milliseconds) */
export const MIN_REASONING_DURATION_MS = 5000;

/** Maximum time for reasoning typewriter (milliseconds) */
export const MAX_REASONING_DURATION_MS = 10000;

/** Shot clock - if no response by this time, auto-fold (milliseconds) */
export const SHOT_CLOCK_MS = 30000;

// Convenience exports in seconds for UI display
export const POST_ACTION_DELAY_S = POST_ACTION_DELAY_MS / 1000;
export const THINKING_DURATION_S = THINKING_DURATION_MS / 1000;
export const MIN_REASONING_DURATION_S = MIN_REASONING_DURATION_MS / 1000;
export const MAX_REASONING_DURATION_S = MAX_REASONING_DURATION_MS / 1000;
export const SHOT_CLOCK_S = SHOT_CLOCK_MS / 1000;

// Display countdown timer - always shows 30 seconds to users
export const DISPLAY_COUNTDOWN_SECONDS = 30;

// Helper function to get timing (same for all modes now)
export function getTimingForMode(_mode: string, _street: string) {
  return {
    postActionDelay: POST_ACTION_DELAY_MS,
    thinkingDuration: THINKING_DURATION_MS,
    minReasoningDuration: MIN_REASONING_DURATION_MS,
    maxReasoningDuration: MAX_REASONING_DURATION_MS,
    shotClock: SHOT_CLOCK_MS,
  };
}
