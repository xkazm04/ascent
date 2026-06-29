import type { MetadataRoute } from "next";
import { publicBaseUrl } from "@/lib/site";

// Static marketing/entry routes only. Report and org pages are per-repo/per-tenant and dynamic
// (many gated), so they're left to crawlers following links rather than enumerated here. A sitemap
// needs absolute URLs, so with no public base configured (publicBaseUrl() === "") we emit nothing.
//
// SHELL-5: the badge generator, pricing, trends and usage are public, indexable marketing routes that
// were missing — a crawler reached them only by following links.
//
// SEO #1: /connect and /onboarding are intentionally DISALLOWED in robots.ts (private per-user funnels
// with no indexable content), so they must NOT appear here — advertising a robots-blocked URL produces
// "Submitted URL blocked by robots.txt" warnings in Search Console. The two SEO contracts must stay
// disjoint; seo.test.ts now asserts that invariant.
export default function sitemap(): MetadataRoute.Sitemap {
  const base = publicBaseUrl();
  if (!base) return [];
  const routes: { path: string; priority: number }[] = [
    { path: "/", priority: 1 },
    { path: "/report", priority: 0.7 },
    // The public AI-native leaderboard is a prime indexable/viral surface (README badge → report →
    // scan-your-own), but it was reachable only by following links. It is public and NOT robots-blocked
    // (robots.ts disallows only /api, /connect, /onboarding, /launch), so list it for discovery.
    { path: "/leaderboard", priority: 0.6 },
    { path: "/pricing", priority: 0.6 },
    { path: "/badge", priority: 0.5 },
    { path: "/trends", priority: 0.5 },
    { path: "/usage", priority: 0.5 },
  ];
  return routes.map(({ path, priority }) => ({
    url: `${base}${path}`,
    changeFrequency: "weekly",
    priority,
  }));
}
