// Shared constants for No-LLMit

// The full roster, in llm/registry.py MODELS order (a test there keeps them in sync).
// The first nine are the default lineup.
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
  "Qwen3 235B A22B",
  "Qwen3 32B",
  "DeepSeek V3.2",
  "Llama 4 Maverick",
  "Mistral Large 3",
  "Gemma 3 27B",
  "GLM-4.6",
  "Kimi K2",
  "GPT-OSS 120B",
  "Nemotron 3.5 Super",
] as const;

