'use client'

import Card from "@/components/Card";
import { motion, useReducedMotion } from "motion/react";

// Seconds: the peel, calm (owner 2026-11-11: "like a pro checking them").
export const PEEL = 0.5;

// A hole card with both faces mounted: the face (Card, its role="img" and name) and the plain ink back (.card-back).
// Face down until faceUp; then it turns over about its left edge, with perspective, and stays face up. A card mounted
// already face up (a refresh mid-hand) shows its face at once; with reduced motion the faces switch with no motion.
export default function HoleCard({ value, faceUp, className = "" }: { value: string; faceUp: boolean; className?: string }) {
  const reduce = useReducedMotion();
  return (
    <div className={`relative ${className}`} style={{ perspective: 300 }}>
      <motion.div
        className="absolute inset-0"
        style={{ transformStyle: 'preserve-3d', originX: 0 }}
        initial={false}
        // Face down: turned over about the left edge and moved back over its own place (x 100%).
        animate={faceUp ? { rotateY: 0, x: '0%' } : { rotateY: -180, x: '100%' }}
        transition={{ duration: reduce ? 0 : PEEL, ease: 'easeInOut' }}
      >
        <div className="absolute inset-0" style={{ backfaceVisibility: 'hidden' }}>
          <Card value={value} className="w-full h-full" />
        </div>
        <div aria-hidden data-back className="absolute inset-0 rounded card-back" style={{ transform: 'rotateY(180deg)', backfaceVisibility: 'hidden', boxShadow: 'rgba(15, 15, 15, 0.1) 0px 0px 0px 1px' }} />
      </motion.div>
    </div>
  );
}
