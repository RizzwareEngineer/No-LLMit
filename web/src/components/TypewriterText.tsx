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
  const intervalRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    // Clear any existing interval
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }

    // Trim and validate text
    const trimmedText = text?.trim() || "";
    
    if (!trimmedText) {
      setDisplayedText("");
      setIsTyping(false);
      return;
    }

    // Start typing
    setIsTyping(true);
    setDisplayedText("");
    
    let currentIndex = 0;
    intervalRef.current = setInterval(() => {
      if (currentIndex < trimmedText.length) {
        currentIndex++;
        setDisplayedText(trimmedText.slice(0, currentIndex));
      } else {
        setIsTyping(false);
        if (intervalRef.current) {
          clearInterval(intervalRef.current);
          intervalRef.current = null;
        }
      }
    }, speed);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [text, speed]);

  // Fallback: if no text to show
  if (!text?.trim()) {
    return <span className={className}>...</span>;
  }

  return (
    <span className={className}>
      {displayedText}
      {isTyping && <span className="animate-pulse">▌</span>}
    </span>
  );
}

