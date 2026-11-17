import type { Metadata } from "next";
import Home from "@/app/page";
import { firstFrame } from "@/lib/firstFrame";

// The ?ssr=1 draft of the home page (next.config.ts rewrites /?ssr=1 here): rendered per request with the engine's
// latest table snapshot and stats (lib/firstFrame, read at most a second ago), so the first paint shows the table as
// it is; the stream then resumes from that frame (hooks/useGameState). An engine that cannot be read within half a
// second gives the default page's blank first frame instead. Not for search engines while it is a draft.
export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false }, alternates: { canonical: "/" } };

export default async function SsrPage() {
  return <Home initial={(await firstFrame()) ?? undefined} />;
}
