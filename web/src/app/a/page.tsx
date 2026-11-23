// Phone draft A (owner, 2026-11-22): the phone page with the desktop table at its own proportions, shrunk to the phone's
// width (Fit); the rest of the first screen is the landing fill (LandingFill: Trends, ?fill=pnl for this session's P&L, or
// ?fill=none for nothing), and the window under it the Mac's stats overview, drawn the same way (StatsSections'
// MacOverview). Open /a on a phone.
import Home from "../page";


export default function DraftA() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('phone-a')" }} />
      <Home />
    </>
  );
}
