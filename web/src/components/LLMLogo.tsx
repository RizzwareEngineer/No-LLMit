'use client';

import { familyColor, logoFile } from '@/lib/families';

interface LLMLogoProps {
  model: string;
  size?: number;
}

// Brand logos in public/logos, from @lobehub/icons-static-svg (MIT). The marks belong to
// their owners and are used only to identify each model.

// A vendor's second and third models get their own hue, so two Qwens never share a Race line
// colour. Same rule as lib/families' colours: at least 3:1 on white and about 34+ ΔE from every other colour.
const MODEL_COLORS: Record<string, string> = {
  'GPT-OSS 120B': '#440044',
  'Gemma 3 27B': '#665500',
  'Llama 4 Maverick': '#0000FF',
  'Mistral Large 3': '#660000',
  'DeepSeek V3.2': '#000088',
  'Qwen3 235B A22B': '#FF33CC',
  'Qwen3 32B': '#BB77BB',
};

export function modelColor(name: string): string {
  return MODEL_COLORS[name] || familyColor(name) || 'rgb(120, 119, 116)';
}

export default function LLMLogo({ model, size = 28 }: LLMLogoProps) {
  const logo = logoFile(model);
  const box = { width: size, height: size, minWidth: size, minHeight: size };

  if (logo) {
    return (
      <div
        className="bg-white border border-neutral-200 rounded-sm flex items-center justify-center shrink-0"
        style={box}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logo} alt={`${model} logo`} width={size * 0.68} height={size * 0.68} />
      </div>
    );
  }

  return (
    <div
      className="bg-neutral-800/20 text-neutral-700 border border-neutral-600/50 rounded-sm flex items-center justify-center shrink-0 font-bold text-[11px]"
      style={box}
    >
      {model.slice(0, 2).toUpperCase()}
    </div>
  );
}
