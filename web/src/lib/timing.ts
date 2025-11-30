// Display timing constants for LLM decision phases
// Used by useGameState.ts (logic) and ReasoningPanel.tsx (UI)

/** Duration of "Thinking..." phase in milliseconds */
export const THINKING_DURATION_MS = 3000;

/** Minimum time to display reasoning before revealing action (milliseconds) */
export const MIN_REASONING_DURATION_MS = 10000;

/** Time to show action after reveal before moving to next (milliseconds) */
export const SETTLE_DURATION_MS = 5000;

// Convenience exports in seconds for UI display
export const THINKING_DURATION_S = THINKING_DURATION_MS / 1000;
export const MIN_REASONING_DURATION_S = MIN_REASONING_DURATION_MS / 1000;
export const SETTLE_DURATION_S = SETTLE_DURATION_MS / 1000;

