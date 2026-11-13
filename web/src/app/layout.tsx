import type { Metadata, Viewport } from "next";
import "./globals.css";

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
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    // suppressHydrationWarning: the home page's inline script (page.tsx) sets --stage-w here before React hydrates.
    <html lang="en" style={{ background: '#FFFFFF' }} suppressHydrationWarning>
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
