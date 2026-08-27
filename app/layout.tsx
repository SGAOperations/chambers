import type { Metadata, Viewport } from "next";
import type React from "react";
import { Space_Grotesk } from "next/font/google";
import { SpeedInsights } from "@vercel/speed-insights/next";
import "./globals.css";

// Self-hosted via next/font -- same variable font Google Fonts served, but from
// our own origin with no render-blocking cross-origin stylesheet and a
// size-adjusted fallback to cut the swap reflow. app/display/[spaceId] already
// loads Space Grotesk this way.
const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-space-grotesk",
});

export const metadata: Metadata = {
  title: "Chambers",
  description: "SGA's Space Manager",
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  themeColor: "#0a1628",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={spaceGrotesk.variable}>
      <body>
        {children}
        <SpeedInsights />
      </body>
    </html>
  );
}
