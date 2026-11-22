// Draft A (owner, 2026-11-21: "go for both let's see it"): the desktop page on a phone, without Profits & Losses, laid out
// 1,040px wide (the desktop table and its gutters) and shrunk by the phone to its screen. Open /a on a phone.
import type { Viewport } from "next";
import Home from "../page";

export const viewport: Viewport = { width: 1040, themeColor: "#ffffff", colorScheme: "light", viewportFit: "cover" };

export default function DraftA() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('phone-a')" }} />
      <Home />
    </>
  );
}
