// Who makes each model, whether its weights are public, its logo and its line colour: the Race filters, the logos and
// the charts. Derived from the roster in llm/registry.py (display name -> OpenRouter slug, whose prefix is the maker);
// the stats payload's `model` field is "mock" in mock mode, so the display name is the key.
// Every line colour is at least 3:1 on white and at least ~28 CIELAB ΔE from every other, so Gemini takes its red and
// Gemma a teal rather than three near-identical blues. Logos are in public/logos (glm is Z.ai's mark, kimi Moonshot's).
// shortcut: keyed by a name substring, first row that matches wins; a new roster family needs a row here.
const MODELS: [match: string, family: string, open: boolean, logo: string, color: string][] = [
  ['gpt-oss', 'OpenAI', true, 'gpt', '#10A37F'],
  ['gpt', 'Other', false, 'gpt', '#10A37F'],
  ['claude', 'Anthropic', false, 'claude', '#D97757'],
  ['gemma', 'Google', true, 'gemma', '#0B7FA8'],
  ['gemini', 'Google', false, 'gemini', '#D93025'],
  ['llama', 'Meta', true, 'llama', '#0050B3'],
  ['mistral', 'Mistral', true, 'mistral', '#C46A00'],
  ['deepseek', 'DeepSeek', true, 'deepseek', '#4D6BFE'],
  ['grok', 'Other', false, 'grok', '#1F1F1F'],
  ['phi', 'Microsoft', true, 'phi', '#5E8C00'],
  ['qwen 3.7 flash', 'Qwen', false, 'qwen', '#9333EA'], // API-only Flash tier
  ['qwen', 'Qwen', true, 'qwen', '#9333EA'],
  ['cohere', 'Cohere', true, 'cohere', '#39594D'], // Command R7B: weights on Hugging Face (CC-BY-NC)
  ['glm', 'Zhipu', true, 'glm', '#C2185B'],
  ['kimi', 'Moonshot', true, 'kimi', '#6D4C41'],
  ['nemotron', 'NVIDIA', true, 'nemotron', '#3A6B35'],
];

const find = (name: string) => MODELS.find(([k]) => name.toLowerCase().includes(k));

export const family = (name: string) => find(name)?.[1] ?? 'Other';
export const openWeights = (name: string) => find(name)?.[2] ?? false;
export const logoFile = (name: string) => { const m = find(name); return m ? `/logos/${m[3]}.svg` : null; };
export const familyColor = (name: string) => find(name)?.[4];
