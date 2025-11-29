// Shared constants for No-LLMit

// All available LLM players
export const ALL_LLMS = [
  "GPT-4o",
  "Claude 3.5",
  "Gemini Pro",
  "Llama 3",
  "Mistral Large",
  "DeepSeek V3",
  "Grok 2",
  "Qwen 2.5",
  "Cohere R+",
] as const;

export type LLMName = (typeof ALL_LLMS)[number];

// Default game configuration
export const DEFAULT_GAME_CONFIG = {
  startingStack: 2000,
  smallBlind: 5,
  bigBlind: 10,
} as const;

// Game modes
export type GameMode = 'simulate' | 'play' | 'test';

