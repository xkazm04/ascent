import type { MetadataRoute } from "next";
import { publicBaseUrl } from "@/lib/site";

// SEO #2: resolve the base URL through the SAME canonical resolver sitemap.ts uses (lib/site
// publicBaseUrl) instead of a local copy. The old local baseUrl() read only ASCENT_PUBLIC_URL /
// NEXT_PUBLIC_APP_URL and lacked the VERCEL_PROJECT_PRODUCTION_URL fallback — so on a zero-config
// Vercel deploy sitemap.xml was emitted with absolute URLs but robots.txt dropped the Sitemap/host
// lines, defeating sitemap auto-discovery. Sharing one resolver keeps the two contracts in lockstep.
export default function robots(): MetadataRoute.Robots {
  const base = publicBaseUrl();
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // APIs are machine endpoints; the per-user funnels carry no indexable content.
        disallow: ["/api/", "/connect", "/onboarding", "/launch"],
      },
    ],
    ...(base ? { sitemap: `${base}/sitemap.xml`, host: base } : {}),
  };
}
