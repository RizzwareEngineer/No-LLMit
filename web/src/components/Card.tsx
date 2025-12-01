'use client'

import { Club, Diamond, Heart, Spade } from '@phosphor-icons/react';
import { motion } from "motion/react"
import React, { useState } from 'react';


interface CardProps {
  value: string;
  className?: string;
  faceDown?: boolean;
}

const Card = ({ value, className = "", faceDown = false }: CardProps) => {
  const [isHovered, setIsHovered] = useState(false);
  
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
  
  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      transition={{ duration: 0.2 }}
      className={`relative bg-white flex items-center justify-center rounded ${className}`}
      style={{ boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px' }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {(!faceDown || isHovered) ? (
        // Face up card
        <div className="flex flex-row gap-1 items-center justify-center w-full h-full" style={{ color: 'rgb(55, 53, 47)' }}>
          <span className="text-xs sm:text-sm font-bold">{rankText}</span>
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
