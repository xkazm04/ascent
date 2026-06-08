import type { MetadataRoute } from "next";

// Static marketing/entry routes only. Report and org pages are per-repo/per-tenant and dynamic
// (many gated), so they're left to crawlers following links rather than enumerated here. A sitemap
// needs absolute URLs, so with no public base configured we emit nothing.
function baseUrl(): string {
  return (process.env.ASCENT_PUBLIC_URL || process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/+$/, "");
}

export default function sitemap(): MetadataRoute.Sitemap {
  const base = baseUrl();
  if (!base) return [];
  const routes: { path: string; priority: number }[] = [
    { path: "/", priority: 1 },
    { path: "/report", priority: 0.7 },
    { path: "/trends", priority: 0.5 },
    { path: "/usage", priority: 0.5 },
  ];
  return routes.map(({ path, priority }) => ({
    url: `${base}${path}`,
    changeFrequency: "weekly",
    priority,
  }));
}
