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
        className="relative bg-white cursor-pointer rounded overflow-hidden"
        style={{ boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px, rgba(15, 15, 15, 0.1) 0px 2px 4px' }}
        onClick={() => setShowDonate(!showDonate)}
      >
        <CornerBorders />
        <div className="px-3 py-2">
          <div className="flex items-center gap-2 text-[10px] mb-1" style={{ color: 'rgba(55, 53, 47, 0.5)' }}>
            <Lightning 
              size={10} 
              weight="bold" 
              style={{ color: error ? 'rgba(55, 53, 47, 0.4)' : isCritical ? 'rgb(235, 87, 87)' : isLow ? 'rgb(203, 145, 47)' : 'rgb(15, 123, 108)' }} 
            />
            <span className="uppercase font-bold">API Usage</span>
            {error && <Warning size={10} weight="bold" style={{ color: 'rgb(203, 145, 47)' }} />}
            {!error && isCritical && <Warning size={10} weight="bold" style={{ color: 'rgb(235, 87, 87)' }} />}
          </div>
          
          <div className="flex items-center gap-2">
            <span className="text-[9px]" style={{ color: 'rgba(55, 53, 47, 0.4)' }}>Tokens:</span>
            <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
              <div 
                className="h-full rounded-full transition-all"
                style={{ 
                  width: error ? '0%' : `${Math.min(100, tokensUsedPct)}%`,
                  background: error ? 'rgba(55, 53, 47, 0.4)' : isCritical ? 'rgb(235, 87, 87)' : isLow ? 'rgb(203, 145, 47)' : 'rgb(15, 123, 108)'
                }}
              />
            </div>
            <span 
              className="text-[10px] font-mono font-bold"
              style={{ color: error ? 'rgba(55, 53, 47, 0.4)' : isCritical ? 'rgb(235, 87, 87)' : isLow ? 'rgb(203, 145, 47)' : 'rgb(55, 53, 47)' }}
            >
              {error ? '???' : `${tokensUsedPct.toFixed(0)}%`}
            </span>
          </div>
          
          <div className="flex items-center gap-2 mt-1">
            <span className="text-[9px]" style={{ color: 'rgba(55, 53, 47, 0.4)' }}>Reqs/day:</span>
            <span className="text-[10px] font-mono" style={{ color: 'rgb(55, 53, 47)' }}>
              {error ? '???' : `${(usage?.daily_requests ?? 0).toLocaleString()} / 1,000`}
            </span>
          </div>

          <div className="mt-2 pt-2 border-t border-notion flex items-center gap-1 text-[9px]" style={{ color: 'rgb(235, 87, 87)' }}>
            <Heart size={10} weight="fill" />
            <span>Click to support this project</span>
          </div>
        </div>
      </div>

      {/* Donate popup - opens upward */}
      {showDonate && (
        <div className="absolute bottom-full left-0 right-0 mb-2 z-50">
          <div 
            className="relative bg-white p-3 rounded"
            style={{ boxShadow: 'rgba(15, 15, 15, 0.05) 0px 0px 0px 1px, rgba(15, 15, 15, 0.1) 0px 3px 6px, rgba(15, 15, 15, 0.2) 0px 9px 24px' }}
          >
            <CornerBorders />
            <div className="text-xs" style={{ color: 'rgb(55, 53, 47)' }}>
              <div className="font-bold mb-2 flex items-center gap-1">
                <Heart size={12} weight="fill" style={{ color: 'rgb(235, 87, 87)' }} />
                Support No-LLMit
              </div>
              <p className="mb-2" style={{ color: 'rgba(55, 53, 47, 0.65)' }}>
                Running 9 LLMs costs real money! Help keep this project free and running.
              </p>
              {usage && (
                <p className="text-[10px] mb-2" style={{ color: 'rgba(55, 53, 47, 0.5)' }}>
                  ~{usage.estimated_total_tokens.toLocaleString()} tokens used this month
                </p>
              )}
              <a 
                href="https://github.com/sponsors/YOUR_GITHUB" 
                target="_blank"
                rel="noopener noreferrer"
                className="block w-full text-white text-center py-2 rounded text-[10px] font-bold"
                style={{ background: 'rgb(235, 87, 87)' }}
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
