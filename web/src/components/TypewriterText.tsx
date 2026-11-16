"use client";

import { useState, useEffect } from "react";
import { typedSoFar, typingMs } from "@/lib/stream";

interface TypewriterTextProps {
  text: string; // the caller keys it by the text, so a new text starts typing afresh
}

let pace = 1; // the table's pace, from the stream's game_state; the page sets it
export const setTypingPace = (p?: number) => { pace = p || 1; };
// The reason being typed and when it began, outside any one panel: crossing the layout switch swaps the reasoning
// panel for the phone caption (or back), and the new one resumes where the typing stands.
let began: { text: string; at: number } | null = null;

export default function TypewriterText({ text }: TypewriterTextProps) {
  const full = text.trim();
  // Characters shown; one past the end keeps the cursor one more tick after the last character.
  const [n, setN] = useState(() => {
    if (typeof window === "undefined") return 0;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return full.length + 1;
    const now = performance.now(), at = typedSoFar(full, began, now, pace);
    if (at === 0) began = { text: full, at: now };
    return at;
  });

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
