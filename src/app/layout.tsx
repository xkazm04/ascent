import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { DIMENSIONS, LEVELS } from "@/lib/maturity/model";
import { publicBaseUrl } from "@/lib/site";
import { DevInspector } from "./_dev-inspector/DevInspector";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const SITE_DESCRIPTION = `Score how AI-native your engineering org is from a GitHub repo: a ${LEVELS.length}-level maturity ladder across ${DIMENSIONS.length} dimensions, with evidence and a roadmap to the next level.`;
const BASE_URL = publicBaseUrl();

export const metadata: Metadata = {
  // metadataBase makes the OG/twitter image + icon URLs (here and in the report/org cards) resolve to
  // ABSOLUTE urls, which unfurlers require. Only set when a public origin is configured (else Next
  // warns and falls back to a relative base) — SHELL-4.
  ...(BASE_URL ? { metadataBase: new URL(BASE_URL) } : {}),
  title: "Ascent — the maturity index for AI-native engineering",
  // Built from the canonical rubric so the share/search snippet can never drift from the model
  // (it previously hardcoded "7 dimensions" while the model defines 9 and the hero rendered 9).
  description: SITE_DESCRIPTION,
  icons: { icon: "/brand/logo-mark-nobg.png" },
  // SHELL-3: standalone iOS web-app chrome to match the manifest's installable shell.
  appleWebApp: { capable: true, title: "Ascent", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#080d1a",
};

// SHELL-4: site-wide structured data (Organization + the app itself) so search engines can render a
// richer result + knowledge panel. Built from the rubric so the dimension/level counts can't drift.
const STRUCTURED_DATA = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      name: "Ascent",
      description: "The maturity index for AI-native engineering.",
      ...(BASE_URL ? { url: BASE_URL, logo: `${BASE_URL}/brand/logo-mark.png` } : {}),
    },
    {
      "@type": "SoftwareApplication",
      name: "Ascent",
      applicationCategory: "DeveloperApplication",
      operatingSystem: "Web",
      description: SITE_DESCRIPTION,
      ...(BASE_URL ? { url: BASE_URL } : {}),
      offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
    },
  ],
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
      <body className="min-h-full flex flex-col">
        {/* SHELL-4: JSON-LD for the org + app. Safe: the payload is static rubric-derived strings
            with no user input, so it can't break out of the script. */}
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(STRUCTURED_DATA) }} />
        <a
          href="#main"
          className="focus-ring sr-only rounded-md bg-accent px-3 py-2 text-on-accent focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50"
        >
          Skip to content
        </a>
        {children}
        {process.env.NODE_ENV === "development" && <DevInspector />}
      </body>
    </html>
  );
}
