'use client'

import { Club, Diamond, Heart, Spade } from '@phosphor-icons/react';
import { motion, useReducedMotion } from "motion/react"
import React, { useState } from 'react';


interface CardProps {
  value: string;
  className?: string;
  faceDown?: boolean;
  delay?: number; // seconds before it appears (dealt cards land one after another)
  flip?: boolean; // turn over in place instead of sliding up (community cards)
}

const RANK_NAMES: Record<string, string> = {
  A: 'Ace', K: 'King', Q: 'Queen', J: 'Jack', T: '10',
};
const SUIT_NAMES: Record<string, string> = { h: 'hearts', d: 'diamonds', c: 'clubs', s: 'spades' };

const Card = ({ value, className = "", faceDown = false, delay = 0, flip = false }: CardProps) => {
  const [isHovered, setIsHovered] = useState(false);
  const reduce = useReducedMotion();
  
  // Determine card color based on suit
  const suit = value.slice(-1);
  const rank = value.slice(0, -1);

  let rankText = rank;
  if (rank === 'T') {
    rankText = '10';
  }

  // Suit colors: hearts=red, diamonds=blue, clubs=green, spades=grey
  const getSuitColor = () => {
    switch (suit) {
      case 'h': return 'text-red-500';
      case 'd': return 'text-blue-500';
      case 'c': return 'text-green-500';
      case 's': return 'text-neutral-700';
      default: return 'text-neutral-200';
    }
  };

  const suitColor = getSuitColor();
  const rankName = RANK_NAMES[rank] ?? rank;
  const suitName = SUIT_NAMES[suit];
  const label = faceDown || !suitName ? 'hidden card' : `${rankName} of ${suitName}`;
  
  return (
    <motion.div 
      initial={reduce ? false : flip ? { opacity: 0, rotateY: 90 } : { opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0, rotateY: 0 }}
      transition={{ duration: flip ? 0.35 : 0.2, delay }}
      role="img"
      aria-label={label}
      className={`relative bg-white flex items-center justify-center rounded ${className}`}
      style={{ boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px', transformPerspective: 400 }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {(!faceDown || isHovered) ? (
        // Face up card
        <div aria-hidden className="flex flex-row gap-1 items-center justify-center w-full h-full" style={{ color: 'rgb(55, 53, 47)' }}>
          <span className={`font-bold ${rankText === '10' ? 'text-[10px] sm:text-[11px] -mr-0.5' : 'text-xs sm:text-sm'}`}>{rankText}</span>
          {suit === 'h' && <Heart className={`w-3 h-3 shrink-0 ${suitColor}`} weight="fill" />}
          {suit === 'd' && <Diamond className={`w-3 h-3 shrink-0 ${suitColor}`} weight="fill" />}
          {suit === 'c' && <Club className={`w-3 h-3 shrink-0 ${suitColor}`} weight="fill" />}
          {suit === 's' && <Spade className={`w-3 h-3 shrink-0 ${suitColor}`} weight="fill" />}
        </div>
      ) : (
        // Face down card
        <div className="w-full h-full bg-gradient-to-br from-blue-800 to-blue-600 flex items-center justify-center rounded">
          <div className="w-3/4 h-3/4 border-2 border-blue-300 rounded opacity-50"></div>
        </div>
      )}
    </motion.div>
  );
};

export default Card;
