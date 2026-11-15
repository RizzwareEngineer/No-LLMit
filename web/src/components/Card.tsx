'use client'

import { Club, Diamond, Heart, Spade } from '@phosphor-icons/react';
import { motion } from "motion/react"


interface CardProps {
  value: string;
  className?: string;
  rise?: boolean; // rises into place as it mounts (a board card dealt while watching); otherwise it is simply there
}

const RANK_NAMES: Record<string, string> = {
  A: 'Ace', K: 'King', Q: 'Queen', J: 'Jack', T: '10',
};
// Suit letter -> icon, colour (hearts red, diamonds blue, clubs green, spades grey) and name.
const SUITS: Record<string, [typeof Heart, string, string]> = {
  h: [Heart, 'text-red-500', 'hearts'],
  d: [Diamond, 'text-blue-500', 'diamonds'],
  c: [Club, 'text-green-500', 'clubs'],
  s: [Spade, 'text-neutral-700', 'spades'],
};

const Card = ({ value, className = "", rise = false }: CardProps) => {
  const rank = value.slice(0, -1); // the ten is T, like every other rank: one letter, one size
  const [Suit, suitColor, suitName] = SUITS[value.slice(-1)] ?? [null, 'text-neutral-200', undefined];
  const rankName = RANK_NAMES[rank] ?? rank;
  const label = !suitName ? 'hidden card' : `${rankName} of ${suitName}`;
  
  return (
    <motion.div 
      initial={rise ? { opacity: 0, y: 20 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      role="img"
      aria-label={label}
      className={`relative bg-white flex items-center justify-center rounded ${className}`}
      style={{ boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px' }}
    >
      <div aria-hidden className="flex flex-row gap-1 items-center justify-center w-full h-full" style={{ color: 'rgb(55, 53, 47)' }}>
        <span className="font-bold text-xs sm:text-sm">{rank}</span>
        {Suit && <Suit className={`w-3 h-3 shrink-0 ${suitColor}`} weight="fill" />}
      </div>
    </motion.div>
  );
};

export default Card;

