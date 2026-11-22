// Phone draft A (owner, 2026-11-22): the phone page with the desktop table at its own proportions, shrunk to the phone's
// width (PokerTable's Fit); the rest of the first screen is the landing fill (LandingFill: ?fill=graph, pnl or both), and
// Trends is the first stats window. Open /a on a phone.
import Home from "../page";


export default function DraftA() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('phone-a')" }} />
      <Home />
    </>
  );
}
