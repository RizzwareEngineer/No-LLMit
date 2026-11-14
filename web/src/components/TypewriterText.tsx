"use client";

import { useState, useEffect } from "react";
import { typingMs } from "@/lib/stream";

interface TypewriterTextProps {
  text: string; // the caller keys it by the text, so a new text starts typing afresh
}

let pace = 1; // the table's pace, from the stream's game_state; the page sets it
export const setTypingPace = (p?: number) => { pace = p || 1; };

export default function TypewriterText({ text }: TypewriterTextProps) {
  const full = text.trim();
  // Characters shown; one past the end keeps the cursor one more tick after the last character.
  const [n, setN] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches ? full.length + 1 : 0);

  useEffect(() => {
    if (n > full.length) return;
    const id = setTimeout(() => setN(n + 1), typingMs(full.length, pace));
    return () => clearTimeout(id);
  }, [n, full.length]);

  if (!full) return <span>…</span>;

  return (
    <span>
      {full.slice(0, n)}
      {n <= full.length && <span>▌</span>}
    </span>
  );
}
