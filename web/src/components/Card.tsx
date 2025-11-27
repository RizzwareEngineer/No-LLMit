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

  const getBorderColor = () => {
    switch (suit) {
      case 'h': return 'border-red-500';
      case 'd': return 'border-blue-500';
      case 'c': return 'border-green-500';
      case 's': return 'border-neutral-700';
      default: return 'border-neutral-300';
    }
  };

  const suitColor = getSuitColor();
  const borderColor = getBorderColor();
  
  return (
    <motion.div 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      transition={{ duration: 0.2 }}
      className={`relative border border-gray-300 bg-white flex items-center justify-center ${className}`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >

      <CornerBorders borderColor={borderColor} />

      {(!faceDown || isHovered) ? (
        // Face up card
        <div className={`flex flex-row gap-1 items-center justify-center w-full h-full text-gray-700`}>
          <span className="text-xs sm:text-sm font-bold">{rankText}</span>
          {suit === 'h' && <Heart className={`w-3 h-3 shrink-0 ${suitColor}`} weight="fill" />}
          {suit === 'd' && <Diamond className={`w-3 h-3 shrink-0 ${suitColor}`} weight="fill" />}
          {suit === 'c' && <Club className={`w-3 h-3 shrink-0 ${suitColor}`} weight="fill" />}
          {suit === 's' && <Spade className={`w-3 h-3 shrink-0 ${suitColor}`} weight="fill" />}
        </div>
      ) : (
        // Face down card
        <div className="w-full h-full bg-gradient-to-br from-blue-800 to-blue-600 rounded-md flex items-center justify-center">
          <div className="w-3/4 h-3/4 border-2 border-blue-300 rounded opacity-50"></div>
        </div>
      )}
    </motion.div>
  );
};

const CornerBorders = ({ borderColor }: { borderColor: string }) => {
  return (
    <>
      <div className={`border-r border-t ${borderColor} h-1 w-1 absolute -top-px -right-px`}/>
      <div className={`border-l border-b ${borderColor} h-1 w-1 absolute -bottom-px -left-px`}/>
      <div className={`border-l border-t ${borderColor} h-1 w-1 absolute -top-px -left-px`}/>
      <div className={`border-r border-b ${borderColor} h-1 w-1 absolute -bottom-px -right-px`}/>
    </>
  );
};

export default Card;
