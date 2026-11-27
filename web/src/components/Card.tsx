'use client'

import { Club, Diamond, Heart, Spade } from '@phosphor-icons/react';
import { motion } from "motion/react"
import { useCardLook } from '@/lib/tableSwitches';


interface CardProps {
  value: string;
  className?: string;
  rise?: boolean; // rises into place as it mounts (a board card dealt while watching); otherwise it is simply there
  covered?: number; // px of its right side under the next card (a seat's pair with look c): its face centres in the rest
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

// The draft looks (lib/tableSwitches' ?cards=a|b|c): a darker 1px edge (rgb(55, 53, 47) at 55%: about 3.2:1 on white,
// past the 3:1 a control's edge needs to be seen) and a soft drop shadow, so the card stands off the white seat and the
// pale felt; b and c add a bigger, heavier rank over its suit, the suits a shade deeper (the same four colours).
const EDGE = 'rgba(55, 53, 47, 0.55) 0px 0px 0px 1px, rgba(15, 15, 15, 0.16) 0px 1px 3px';
const DEEP: Record<string, string> = { 'text-red-500': 'text-red-600', 'text-blue-500': 'text-blue-600', 'text-green-500': 'text-green-600', 'text-neutral-700': 'text-neutral-800' };

const Card = ({ value, className = "", rise = false, covered = 0 }: CardProps) => {
  const look = useCardLook();
  const rank = value.slice(0, -1); // the ten is T, like every other rank: one letter, one size
  const [Suit, suitColor, suitName] = SUITS[value.slice(-1)] ?? [null, 'text-neutral-200', undefined];
  const rankName = RANK_NAMES[rank] ?? rank;
  const label = !suitName ? 'hidden card' : `${rankName} of ${suitName}`;
  // b and c: the rank over its suit, sized to the card (its height in px from the class: phones' cards are under 50).
  const big = look === 'b' || look === 'c', small = /h-10\b|h-\[44px\]/.test(className);
  const [rankPx, suitPx] = small ? [14, 11] : look === 'c' ? [21, 16] : [18, 14];

  return (
    <motion.div 
      initial={rise ? { opacity: 0, y: 20 } : false}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      role="img"
      aria-label={label}
      data-card-look={look ?? undefined}
      className={`relative bg-white flex items-center justify-center rounded ${className}`}
      style={{ boxShadow: look ? EDGE : 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px' }}
    >
      {big ? (
        <div aria-hidden className="flex flex-col items-center justify-center w-full h-full" style={{ color: 'rgb(37, 36, 32)', gap: small ? 1 : 2, paddingRight: covered }}>
          <span className="font-extrabold leading-none" style={{ fontSize: rankPx }}>{rank}</span>
          {Suit && <Suit className={`shrink-0 ${DEEP[suitColor] ?? suitColor}`} weight="fill" style={{ width: suitPx, height: suitPx }} />}
        </div>
      ) : (
        <div aria-hidden className="flex flex-row gap-1 items-center justify-center w-full h-full" style={{ color: 'rgb(55, 53, 47)' }}>
          <span className="font-bold text-xs sm:text-sm">{rank}</span>
          {Suit && <Suit className={`w-3 h-3 shrink-0 ${suitColor}`} weight="fill" />}
        </div>
      )}
    </motion.div>
  );
};

export default Card;

