"use client";

import { useState, useEffect, useRef } from "react";

interface TypewriterTextProps {
  text: string;
  speed?: number; // ms per character
  className?: string;
}

export default function TypewriterText({ 
  text, 
  speed = 20,
  className = ""
}: TypewriterTextProps) {
  const [displayedText, setDisplayedText] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const prevTextRef = useRef<string>("");

  useEffect(() => {
    // Only animate if text changed
    if (text === prevTextRef.current) return;
    
    prevTextRef.current = text;
    setIsTyping(true);
    setDisplayedText("");

    if (!text) {
      setIsTyping(false);
      return;
    }

    let currentIndex = 0;
    const interval = setInterval(() => {
      if (currentIndex < text.length) {
        setDisplayedText(text.slice(0, currentIndex + 1));
        currentIndex++;
      } else {
        setIsTyping(false);
        clearInterval(interval);
      }
    }, speed);

    return () => clearInterval(interval);
  }, [text, speed]);

  return (
    <span className={className}>
      {displayedText}
      {isTyping && <span className="animate-pulse">▌</span>}
    </span>
  );
}

