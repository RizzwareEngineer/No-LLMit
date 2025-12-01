import type { Metadata } from "next";
import "./globals.css";
import { JetBrains_Mono } from "next/font/google";

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "No-LLMit",
  description: "LLMs playing No Limit Texas Hold'em against each other",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" style={{ background: '#FFFFFF' }}>
      <body
        className={`h-full ${jetbrainsMono.variable} flex flex-col`}
        style={{ 
          fontFamily: "ui-sans-serif, -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, 'Apple Color Emoji', Arial, sans-serif",
          color: 'rgb(55, 53, 47)',
          WebkitFontSmoothing: 'auto'
        }}
      >
        {children}
      </body>
    </html>
  );
}
