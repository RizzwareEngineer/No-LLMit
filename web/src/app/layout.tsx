import type { Metadata, Viewport } from "next";
import "./globals.css";
import { API_URL } from "@/lib/api";

const title = "No-LLMit";
const description = "9 LLMs play No Limit Hold'em against each other, live. Watch each one explain its move.";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL || "https://nollmit.vercel.app"),
  title,
  description,
  openGraph: { title, description, type: "website", siteName: title },
  twitter: { card: "summary_large_image", title, description },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
  colorScheme: "light",
  viewportFit: "cover", // lets env(safe-area-inset-*) report the notch and home indicator; 0 on desktop
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning: the home page's inline script (page.tsx) sets --stage-w here before React hydrates.
    <html lang="en" style={{ background: '#FFFFFF' }} suppressHydrationWarning>
      {/* The game server's stream and stats open as soon as the page runs: its connection set up while the page loads
          (the audit: an unpreconnected origin on the phone's critical path, about 150 ms). */}
      <head><link rel="preconnect" href={API_URL} crossOrigin="anonymous" /></head>
      <body
        className="h-full flex flex-col"
        style={{ 
          color: 'rgb(55, 53, 47)',
          WebkitFontSmoothing: 'auto'
        }}
      >
        {children}
      </body>
    </html>
  );
}
