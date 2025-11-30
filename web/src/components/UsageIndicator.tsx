"use client";

import { useState, useEffect } from "react";
import { Lightning, Heart, Warning } from "@phosphor-icons/react";
import CornerBorders from "@/components/CornerBorders";

interface UsageData {
  daily_requests: number;
  monthly_requests: number;
  estimated_total_tokens: number;
  limits: {
    free: {
      tokens_remaining: number;
      tokens_used_pct: number;
      daily_requests_remaining: number;
      daily_requests_used_pct: number;
    };
  };
}

interface UsageIndicatorProps {
  isPaused?: boolean;
  inline?: boolean;
}

export default function UsageIndicator({ isPaused = false, inline = false }: UsageIndicatorProps) {
  const [usage, setUsage] = useState<UsageData | null>(null);
  const [error, setError] = useState(false);
  const [showDonate, setShowDonate] = useState(false);

  useEffect(() => {
    if (isPaused) return;

    const fetchUsage = async () => {
      try {
        const res = await fetch("http://localhost:5001/usage");
        if (res.ok) {
          const data = await res.json();
          setUsage(data);
          setError(false);
        } else {
          setError(true);
        }
      } catch {
        setError(true);
      }
    };

    fetchUsage();
    const interval = setInterval(fetchUsage, 30000);
    return () => clearInterval(interval);
  }, [isPaused]);

  const tokensUsedPct = usage?.limits?.free?.tokens_used_pct ?? 0;
  const isLow = tokensUsedPct > 50;
  const isCritical = tokensUsedPct > 80;

  const content = (
    <div className="relative">
      <div 
        className="relative border border-gray-300 bg-stone-50 shadow-sm cursor-pointer"
        onClick={() => setShowDonate(!showDonate)}
      >
        <CornerBorders />
        <div className="px-3 py-2">
          <div className="flex items-center gap-2 text-[10px] text-gray-500 mb-1">
            <Lightning size={10} weight="bold" className={error ? "text-gray-400" : isCritical ? "text-red-500" : isLow ? "text-amber-500" : "text-green-500"} />
            <span className="uppercase font-bold">API Usage</span>
            {error && <Warning size={10} weight="bold" className="text-amber-500" />}
            {!error && isCritical && <Warning size={10} weight="bold" className="text-red-500" />}
          </div>
          
          <div className="flex items-center gap-2">
            <span className="text-[9px] text-gray-400">Tokens:</span>
            <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
              <div 
                className={`h-full rounded-full transition-all ${
                  error ? 'bg-gray-400' : isCritical ? 'bg-red-500' : isLow ? 'bg-amber-500' : 'bg-green-500'
                }`}
                style={{ width: error ? '0%' : `${Math.min(100, tokensUsedPct)}%` }}
              />
            </div>
            <span className={`text-[10px] font-mono font-bold ${error ? 'text-gray-400' : isCritical ? 'text-red-600' : isLow ? 'text-amber-600' : 'text-gray-600'}`}>
              {error ? '???' : `${tokensUsedPct.toFixed(0)}%`}
            </span>
          </div>
          
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[9px] text-gray-400">Reqs/day:</span>
            <span className="text-[10px] font-mono text-gray-600">
              {error ? '???' : `${(usage?.daily_requests ?? 0).toLocaleString()} / 1,000`}
            </span>
          </div>

          <div className="mt-2 pt-2 border-t border-gray-200 flex items-center gap-1 text-[9px] text-pink-500">
            <Heart size={10} weight="fill" />
            <span>Click to support this project</span>
          </div>
        </div>
      </div>

      {/* Donate popup - opens upward */}
      {showDonate && (
        <div className="absolute bottom-full left-0 right-0 mb-2 z-50">
          <div className="relative border border-gray-300 bg-white shadow-lg p-3">
            <CornerBorders />
            <div className="text-xs text-gray-700">
              <div className="font-bold mb-2 flex items-center gap-1">
                <Heart size={12} weight="fill" className="text-pink-500" />
                Support No-LLMit
              </div>
              <p className="text-gray-600 mb-2">
                Running 9 LLMs costs real money! Help keep this project free and running.
              </p>
              {usage && (
                <p className="text-[10px] text-gray-500 mb-2">
                  ~{usage.estimated_total_tokens.toLocaleString()} tokens used this month
                </p>
              )}
              <a 
                href="https://github.com/sponsors/YOUR_GITHUB" 
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full bg-pink-500 hover:bg-pink-600 text-white text-center py-2 rounded text-[10px] font-bold"
              >
                ❤️ Become a Sponsor
              </a>
            </div>
          </div>
        </div>
      )}
    </div>
  );

  if (inline) {
    return content;
  }

  // Fixed position: matches page padding (p-4 lg:p-8) so it aligns with content
  return (
    <div className="fixed z-40 top-4 right-4 lg:top-8 lg:right-8 w-[240px]">
      {content}
    </div>
  );
}
