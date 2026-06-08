import type { MetadataRoute } from "next";

// Public base URL of the deployment (same env the alert/PR-link builders use). When unset we still
// emit crawl rules but omit the absolute sitemap/host lines, which require an absolute origin.
function baseUrl(): string {
  return (process.env.ASCENT_PUBLIC_URL || process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/+$/, "");
}

export default function robots(): MetadataRoute.Robots {
  const base = baseUrl();
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
