// Who makes each model and whether its weights are public, for the Race filters. Derived from
// the roster in llm/registry.py (display name -> OpenRouter slug, whose prefix is the maker);
// the stats payload's `model` field is "mock" in mock mode, so the display name is the key.
// shortcut: keyed by a name substring; a new roster family needs a row here.
const FAMILIES: [match: string, family: string, open: boolean][] = [
  ['gpt-oss', 'OpenAI', true],
  ['claude', 'Anthropic', false],
  ['gemma', 'Google', true],
  ['gemini', 'Google', false],
  ['llama', 'Meta', true],
  ['mistral', 'Mistral', true],
  ['deepseek', 'DeepSeek', true],
  ['phi', 'Microsoft', true],
  ['qwen 3.7 flash', 'Qwen', false], // API-only Flash tier
  ['qwen', 'Qwen', true],
  ['cohere', 'Cohere', true], // Command R7B: weights on Hugging Face (CC-BY-NC)
  ['glm', 'Zhipu', true],
  ['kimi', 'Moonshot', true],
  ['nemotron', 'NVIDIA', true],
];

const find = (name: string) => FAMILIES.find(([k]) => name.toLowerCase().includes(k));

export const family = (name: string) => find(name)?.[1] ?? 'Other';
export const openWeights = (name: string) => find(name)?.[2] ?? false;
