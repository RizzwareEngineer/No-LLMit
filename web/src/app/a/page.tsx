// Phone draft A (owner, 2026-11-22): the phone page with the desktop table at its own proportions, shrunk to the phone's
// width (Fit); the rest of the first screen is the landing fill (LandingFill: Trends, ?fill=pnl for this session's P&L, or
// ?fill=none for nothing), and the window under it the Mac's stats overview, drawn the same way (StatsSections'
// MacOverview). ?table=tall: the tall table instead (PokerTable), filling the first screen over its caption. Open /a on a phone.
import Home from "../page";


export default function DraftA() {
  return (
    <>
      {/* data-fill: which landing (LandingFill; tall: the tall table's, which has none), for globals.css, before the first paint. */}
      <script dangerouslySetInnerHTML={{ __html: "document.documentElement.classList.add('phone-a');var q=new URLSearchParams(location.search),f=q.get('fill');document.documentElement.dataset.fill=q.get('table')==='tall'?'tall':f==='pnl'||f==='none'?f:'trends'" }} />
      <Home />
    </>
  );
}
