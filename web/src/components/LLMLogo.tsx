'use client';

interface LLMLogoProps {
  model: string;
  size?: number;
  className?: string;
}

// LLM brand colors
const LLM_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  'gpt': { bg: 'bg-[#10a37f]/20', text: 'text-[#10a37f]', border: 'border-[#10a37f]/50' },
  'claude': { bg: 'bg-[#cc785c]/20', text: 'text-[#cc785c]', border: 'border-[#cc785c]/50' },
  'gemini': { bg: 'bg-[#4285f4]/20', text: 'text-[#4285f4]', border: 'border-[#4285f4]/50' },
  'llama': { bg: 'bg-[#7c3aed]/20', text: 'text-[#7c3aed]', border: 'border-[#7c3aed]/50' },
  'mistral': { bg: 'bg-[#ff7000]/20', text: 'text-[#ff7000]', border: 'border-[#ff7000]/50' },
  'deepseek': { bg: 'bg-[#00d4aa]/20', text: 'text-[#00d4aa]', border: 'border-[#00d4aa]/50' },
  'grok': { bg: 'bg-[#f43f5e]/20', text: 'text-[#f43f5e]', border: 'border-[#f43f5e]/50' },
  'qwen': { bg: 'bg-[#6366f1]/20', text: 'text-[#6366f1]', border: 'border-[#6366f1]/50' },
  'cohere': { bg: 'bg-[#39594d]/20', text: 'text-[#39594d]', border: 'border-[#39594d]/50' },
};

const DEFAULT_COLORS = { bg: 'bg-neutral-800/20', text: 'text-neutral-400', border: 'border-neutral-600/50' };

// LLM logo abbreviations
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
  for (const key of Object.keys(LLM_COLORS)) {
    if (lower.includes(key)) return key;
  }
  return '';
}

export default function LLMLogo({ model, size = 28, className = '' }: LLMLogoProps) {
  const key = getModelKey(model);
  const colors = LLM_COLORS[key] || DEFAULT_COLORS;
  const abbrev = LLM_ABBREV[key] || model.slice(0, 2).toUpperCase();

  return (
    <div
      className={`
        ${colors.bg} ${colors.text} ${colors.border}
        border rounded-sm
        flex items-center justify-center shrink-0
        font-mono font-bold text-[10px]
        ${className}
      `}
      style={{ width: size, height: size, minWidth: size, minHeight: size }}
    >
      {abbrev}
    </div>
  );
}

