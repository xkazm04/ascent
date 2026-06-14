import type { MetadataRoute } from "next";
import { publicBaseUrl } from "@/lib/site";

// Static marketing/entry routes only. Report and org pages are per-repo/per-tenant and dynamic
// (many gated), so they're left to crawlers following links rather than enumerated here. A sitemap
// needs absolute URLs, so with no public base configured (publicBaseUrl() === "") we emit nothing.
//
// SHELL-5: the badge generator, pricing, and the connect/onboarding entry points are public,
// indexable marketing routes that were missing — a crawler reached them only by following links.
export default function sitemap(): MetadataRoute.Sitemap {
  const base = publicBaseUrl();
  if (!base) return [];
  const routes: { path: string; priority: number }[] = [
    { path: "/", priority: 1 },
    { path: "/report", priority: 0.7 },
    { path: "/pricing", priority: 0.6 },
    { path: "/connect", priority: 0.6 },
    { path: "/badge", priority: 0.5 },
    { path: "/onboarding", priority: 0.5 },
    { path: "/trends", priority: 0.5 },
    { path: "/usage", priority: 0.5 },
  ];
  return routes.map(({ path, priority }) => ({
    url: `${base}${path}`,
    changeFrequency: "weekly",
    priority,
  }));
}
