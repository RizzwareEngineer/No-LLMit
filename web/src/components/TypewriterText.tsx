"use client";

import { useState, useEffect } from "react";

interface TypewriterTextProps {
  text: string; // the caller keys it by the text, so a new text starts typing afresh
}

const SPEED = 25; // ms per character

export default function TypewriterText({ text }: TypewriterTextProps) {
  const full = text.trim();
  // Characters shown; one past the end keeps the cursor one more tick after the last character.
  const [n, setN] = useState(() =>
    typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches ? full.length + 1 : 0);

  useEffect(() => {
    if (n > full.length) return;
    const id = setTimeout(() => setN(n + 1), SPEED);
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
