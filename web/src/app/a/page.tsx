// Draft A (owner, 2026-11-21: "go for both let's see it"): the desktop page on a phone, without Profits & Losses, laid out
// 1,040px wide (the desktop table and its gutters) and shrunk by the phone to its screen. Open /a on a phone.
import type { Viewport } from "next";
import Home from "../page";

// Next adds initial-scale=1 unless told otherwise, which shows a 1:1 slice. A browser lays the page out at least
// screen width / initial-scale wide, so the scale is 390 / 1,040: the common iPhone width fits exactly.
export const viewport: Viewport = { width: 1040, initialScale: 0.375, themeColor: "#ffffff", colorScheme: "light", viewportFit: "cover" };

export default function DraftA() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('phone-a')" }} />
      <Home />
    </>
  );
}
