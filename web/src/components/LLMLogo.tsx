'use client';

interface LLMLogoProps {
  model: string;
  size?: number;
  className?: string;
}

// Brand logos in public/logos, from @lobehub/icons-static-svg (MIT). The marks belong to
// their owners and are used only to identify each model.
const LLM_KEYS = ['gpt', 'claude', 'gemini', 'gemma', 'llama', 'mistral', 'deepseek', 'grok', 'phi', 'qwen', 'cohere'];

// Initials shown for a model we have no logo for
const LLM_ABBREV: Record<string, string> = {
  'gpt': 'GPT',
  'claude': 'CL',
  'gemini': 'GEM',
  'llama': 'LL',
  'mistral': 'MIS',
  'deepseek': 'DS',
  'grok': 'GRK',
  'qwen': 'QW',
  'cohere': 'CO',
};

function getModelKey(name: string): string {
  const lower = name.toLowerCase();
  for (const key of LLM_KEYS) {
    if (lower.includes(key)) return key;
  }
  return '';
}

// One line color per model, from its logo where that works on a chart. Every color is at
// least 3:1 on white and at least ~28 CIELAB ΔE from every other, so Gemini takes its red and
// Gemma a teal rather than three near-identical blues.
const LLM_COLORS: Record<string, string> = {
  gpt: '#10A37F',
  claude: '#D97757',
  gemini: '#D93025',
  gemma: '#0B7FA8',
  llama: '#0050B3',
  mistral: '#C46A00',
  deepseek: '#4D6BFE',
  grok: '#1F1F1F',
  phi: '#5E8C00',
  qwen: '#9333EA',
  cohere: '#39594D',
};

export function modelColor(name: string): string {
  return LLM_COLORS[getModelKey(name)] || 'rgb(120, 119, 116)';
}

export default function LLMLogo({ model, size = 28, className = '' }: LLMLogoProps) {
  const key = getModelKey(model);
  const box = { width: size, height: size, minWidth: size, minHeight: size };

  if (key) {
    return (
      <div
        className={`bg-white border border-neutral-200 rounded-sm flex items-center justify-center shrink-0 ${className}`}
        style={box}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={`/logos/${key}.svg`} alt={`${model} logo`} width={size * 0.68} height={size * 0.68} />
      </div>
    );
  }

  return (
    <div
      className={`bg-neutral-800/20 text-neutral-400 border border-neutral-600/50 rounded-sm flex items-center justify-center shrink-0 font-mono font-bold text-[11px] ${className}`}
      style={box}
    >
      {LLM_ABBREV[key] || model.slice(0, 2).toUpperCase()}
    </div>
  );
}
