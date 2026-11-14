"use client";

import { useEffect, useState } from "react";
import { API_URL } from "@/lib/api";
import { MUTED } from "@/lib/stats";

const PACE_URL = `${API_URL}/dev/pace`;

// "0.5 = twice as fast": the pace multiplies every pause, so 1 / pace is the speed.
function words(p: number): string {
  if (p === 1) return "normal speed";
  const x = Math.round((p < 1 ? 1 / p : p) * 10) / 10;
  if (p < 1) return x === 2 ? "twice as fast" : `${x} times as fast`;
  return `pauses ${x} times as long`;
}

// The owner's pace dial, on /?pace with an engine started with DEV_CONTROLS=1 (engine/api/server.go).
// Without either it draws nothing; it is fixed in the corner, so the page's layout never moves.
export default function DevPace() {
  const [pace, setPace] = useState<number | null>(null);

  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has("pace")) return;
    fetch(PACE_URL)
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => typeof b?.pace === "number" && setPace(b.pace))
      .catch(() => {});
  }, []);

  if (pace === null) return null;

  const send = () =>
    fetch(`${PACE_URL}?pace=${pace}`, { method: "POST" })
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => typeof b?.pace === "number" && setPace(b.pace))
      .catch(() => {});

  return (
    <label className="fixed bottom-3 right-3 z-50 flex flex-col gap-1 rounded border bg-white px-3 py-2 text-[11px] shadow-sm" style={{ borderColor: "rgba(55, 53, 47, 0.16)", color: "rgb(55, 53, 47)" }}>
      <span className="tabular-nums">
        Pace <b>{pace.toFixed(2)}</b> <span style={{ color: MUTED }}>= {words(pace)}</span>
      </span>
      <input
        type="range"
        min={0.25}
        max={1.5}
        step={0.05}
        value={pace}
        aria-label="Table pace"
        onChange={(e) => setPace(Number(e.target.value))}
        onPointerUp={send}
        onKeyUp={send}
      />
    </label>
  );
}
