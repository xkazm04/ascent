import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { DIMENSIONS, LEVELS } from "@/lib/maturity/model";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Ascent — the maturity index for AI-native engineering",
  // Built from the canonical rubric so the share/search snippet can never drift from the model
  // (it previously hardcoded "7 dimensions" while the model defines 9 and the hero rendered 9).
  description: `Score how AI-native your engineering org is from a GitHub repo: a ${LEVELS.length}-level maturity ladder across ${DIMENSIONS.length} dimensions, with evidence and a roadmap to the next level.`,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
