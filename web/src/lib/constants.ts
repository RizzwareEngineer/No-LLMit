// Shared constants for No-LLMit

// All available LLM players
export const ALL_LLMS = [
  "GPT-OSS 20B",
  "Claude Haiku 5.5",
  "Gemma 3 12B",
  "Llama 3.1 8B",
  "Mistral Nemo",
  "DeepSeek V4 Flash",
  "Phi-4",
  "Qwen 3.7 Flash",
  "Cohere Command R7B",
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

