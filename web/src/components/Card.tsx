'use client'

import { Club, Diamond, Heart, Spade } from '@phosphor-icons/react';
import { motion } from "motion/react"
import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { Segmented } from '@/components/Section';


interface CardProps {
  value: string;
  className?: string;
  faceDown?: boolean;
}

const RANK_NAMES: Record<string, string> = {
  A: 'Ace', K: 'King', Q: 'Queen', J: 'Jack', T: '10',
};
const SUIT_NAMES: Record<string, string> = { h: 'hearts', d: 'diamonds', c: 'clubs', s: 'spades' };

const Card = ({ value, className = "", faceDown = false }: CardProps) => {
  const [isHovered, setIsHovered] = useState(false);
  
  // Determine card color based on suit
  const suit = value.slice(-1);
  const rank = value.slice(0, -1);

  const rankText = rank; // the ten is T, like every other rank: one letter, one size

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
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      transition={{ duration: 0.2 }}
      role="img"
      aria-label={label}
      className={`relative bg-white flex items-center justify-center rounded ${className}`}
      style={{ boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px' }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {(!faceDown || isHovered) ? (
        // Face up card
        <div aria-hidden className="flex flex-row gap-1 items-center justify-center w-full h-full" style={{ color: 'rgb(55, 53, 47)' }}>
          <span className="font-bold text-xs sm:text-sm">{rankText}</span>
          {suit === 'h' && <Heart className={`w-3 h-3 shrink-0 ${suitColor}`} weight="fill" />}
          {suit === 'd' && <Diamond className={`w-3 h-3 shrink-0 ${suitColor}`} weight="fill" />}
          {suit === 'c' && <Club className={`w-3 h-3 shrink-0 ${suitColor}`} weight="fill" />}
          {suit === 's' && <Spade className={`w-3 h-3 shrink-0 ${suitColor}`} weight="fill" />}
        </div>
      ) : (
        // Face down card
        <div className="card-back relative w-full h-full rounded" />
      )}
    </motion.div>
  );
};

export default Card;

// Card back drafts on the real page until the owner picks one (owner 2026-11-09: "the card backs I don't like"):
// ?cards=a|b|c, the current back otherwise. It sets <html data-cards>, which globals.css's .card-back follows, so the
// deck and the flights drawn outside React follow too. shortcut: the losing drafts and this switcher go once one is picked.
const BACKS = [
  { label: 'Current', value: '' },
  { label: 'A', value: 'a' },
  { label: 'B', value: 'b' },
  { label: 'C', value: 'c' },
];
const backListeners = new Set<() => void>();
const subscribeBack = (l: () => void) => { backListeners.add(l); return () => { backListeners.delete(l); }; };
const readBack = () => BACKS.find(b => b.value && b.value === new URLSearchParams(window.location.search).get('cards'))?.value ?? '';
const chooseBack = (v: string) => {
  const url = new URL(window.location.href);
  if (v) url.searchParams.set('cards', v); else url.searchParams.delete('cards');
  history.replaceState(null, '', url);
  backListeners.forEach(l => l());
};

export function CardBackSwitcher({ className = '' }: { className?: string }) {
  const back = useSyncExternalStore(subscribeBack, readBack, () => '');
  useEffect(() => {
    if (back) document.documentElement.dataset.cards = back;
    else delete document.documentElement.dataset.cards;
  }, [back]);
  return (
    <div data-cards-switcher className={`flex items-center gap-2 text-[13px] ${className}`} style={{ color: 'rgba(55, 53, 47, 0.65)' }}>
      Card back
      <Segmented label="Card back draft" options={BACKS} value={back} onChange={chooseBack} />
    </div>
  );
}
