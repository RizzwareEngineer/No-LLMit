"use client";

import CornerBorders from "@/components/CornerBorders";
import TypewriterText from "@/components/TypewriterText";

interface ShotClockState {
  playerIdx: number;
  playerName: string;
  secondsLeft: number;
}

interface LLMThinkingState {
  playerIdx: number;
  playerName: string;
  reason?: string;
}

interface ReasoningPanelProps {
  shotClock: ShotClockState | null;
  llmThinking: LLMThinkingState | null;
  isPaused?: boolean;
  currentPlayerName?: string;
}

export default function ReasoningPanel({
  shotClock,
  llmThinking,
  isPaused = false,
  currentPlayerName = "",
}: ReasoningPanelProps) {
  // Determine display state
  const playerName = shotClock?.playerName || llmThinking?.playerName || currentPlayerName || "—";
  const secondsLeft = shotClock?.secondsLeft ?? null;
  const reason = llmThinking?.reason || "";
  const isWaiting = !shotClock && !llmThinking;

  return (
    <div className="relative border border-gray-300 bg-stone-50 shadow-sm h-[72px]">
      <CornerBorders />
      <div className="flex h-full">
        {/* Shot clock section - fixed width */}
        <div className={`w-[160px] flex flex-col items-center justify-center border-r border-gray-300 ${
          isPaused ? 'bg-amber-50' : secondsLeft !== null ? 'bg-blue-50' : 'bg-gray-50'
        }`}>
          <span className="text-[10px] uppercase tracking-wider text-gray-500 mb-1">
            {isWaiting ? "Waiting" : "Acting"}
          </span>
          <span className="text-xs font-bold text-gray-700 truncate max-w-[140px] px-2">
            {playerName}
          </span>
          {secondsLeft !== null && (
            <div className="flex items-center gap-1 mt-1">
              <span className={`font-mono text-lg font-bold ${
                secondsLeft <= 5 ? 'text-red-600' : isPaused ? 'text-amber-600' : 'text-blue-600'
              }`}>
                {secondsLeft}s
              </span>
              {isPaused && <span className="text-amber-600 text-xs">⏸</span>}
            </div>
          )}
        </div>

        {/* Reasoning section - flexible width */}
        <div className="flex-1 flex flex-col justify-center px-4 min-w-0">
          {reason ? (
            <>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] uppercase tracking-wider text-blue-500">Reasoning</span>
              </div>
              <p className="text-sm text-gray-700 italic line-clamp-2">
                <TypewriterText text={reason} speed={15} />
              </p>
            </>
          ) : (
            <div className="text-gray-400 text-xs italic">
              {isWaiting ? "Waiting for next action..." : "Thinking..."}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

