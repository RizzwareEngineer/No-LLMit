"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Play, ArrowLeft, ChartBar } from "@phosphor-icons/react";
import CornerBorders from "@/components/CornerBorders";
import LLMLogo from "@/components/LLMLogo";
import { ALL_LLMS } from "@/lib/constants";

export default function PlayPage() {
  const router = useRouter();
  const [selectedLLMs, setSelectedLLMs] = useState<string[]>(ALL_LLMS.slice(0, 8));

  const toggleLLMSelection = (llm: string) => {
    if (selectedLLMs.includes(llm)) {
      setSelectedLLMs(selectedLLMs.filter(l => l !== llm));
    } else if (selectedLLMs.length < 8) {
      setSelectedLLMs([...selectedLLMs, llm]);
    }
  };

  const handleStartGame = () => {
    if (selectedLLMs.length !== 8) {
      alert('Please select exactly 8 LLM opponents');
      return;
    }
    // Store selected LLMs and redirect to game
    sessionStorage.setItem('playMode', 'true');
    sessionStorage.setItem('selectedLLMs', JSON.stringify(selectedLLMs));
    router.push('/');
  };

  return (
    <div className="flex flex-col min-h-screen p-4 lg:p-8 overflow-auto bg-stone-100">
      <div className="text-gray-700 flex-1 flex flex-col items-center">
        
        {/* Header */}
        <div className="mb-8 w-full max-w-2xl flex items-center gap-4">
          <button 
            onClick={() => router.push('/')}
            className="btn-brutal px-3 py-1 text-[10px] flex items-center gap-2"
            style={{ textTransform: 'none' }}
          >
            <ArrowLeft size={12} weight="bold" />
            Back to Spectate
          </button>
          <div className="h-4 w-px bg-gray-300" />
          <h1 className="text-lg font-bold tracking-wider">Play vs. LLMs</h1>
        </div>

        {/* Main content */}
        <div className="w-full max-w-2xl flex flex-col gap-6">
          
          {/* Opponent Selection */}
          <div className="border border-gray-300 bg-stone-50 shadow-sm p-6 relative">
            <CornerBorders />
            <h2 className="text-sm font-bold uppercase tracking-wider mb-1">Select Your Opponents</h2>
            <p className="text-[10px] text-gray-500 mb-4">Choose 8 LLMs to play against</p>
            
            <div className="grid grid-cols-3 gap-3 mb-4">
              {ALL_LLMS.map(llm => (
                <button
                  key={llm}
                  onClick={() => toggleLLMSelection(llm)}
                  className={`p-3 border transition-colors flex items-center gap-2 ${
                    selectedLLMs.includes(llm) 
                      ? 'bg-green-500 text-white border-green-600' 
                      : 'bg-white text-gray-700 border-gray-300 hover:border-gray-400'
                  }`}
                >
                  <LLMLogo model={llm} size={20} />
                  <span className="text-[11px] font-bold uppercase">{llm}</span>
                </button>
              ))}
            </div>
            
            <div className="flex items-center justify-between">
              <p className="text-[10px] text-gray-400">
                Selected: {selectedLLMs.length}/8
              </p>
              <button
                onClick={handleStartGame}
                disabled={selectedLLMs.length !== 8}
                className="btn-brutal btn-brutal-success px-4 py-2 text-xs disabled:opacity-50 flex items-center gap-2"
                style={{ textTransform: 'none' }}
              >
                <Play size={14} weight="bold" />
                Start Game
              </button>
            </div>
          </div>

          {/* Stats Section (placeholder) */}
          <div className="border border-gray-300 bg-stone-50 shadow-sm p-6 relative">
            <CornerBorders />
            <div className="flex items-center gap-2 mb-1">
              <ChartBar size={16} weight="bold" className="text-gray-400" />
              <h2 className="text-sm font-bold uppercase tracking-wider">LLM Performance Stats</h2>
            </div>
            <p className="text-[10px] text-gray-500 mb-4">Historical cash game performance</p>
            
            <div className="text-center py-8 text-gray-400 text-sm">
              Coming soon...
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

