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
    <html lang="en" className="bg-stone-100">
      <body
        className={`antialiased h-full ${jetbrainsMono.variable} font-mono flex flex-col`}
      >
        {children}
      </body>
    </html>
  );
}
