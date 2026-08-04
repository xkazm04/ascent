import type { MetadataRoute } from "next";
import { publicBaseUrl } from "@/lib/site";

// Static marketing/entry routes only. Report and org pages are per-repo/per-tenant and dynamic
// (many gated), so they're left to crawlers following links rather than enumerated here. A sitemap
// needs absolute URLs, so with no public base configured (publicBaseUrl() === "") we emit nothing.
//
// SHELL-5: the badge generator, pricing, trends and usage are public, indexable marketing routes that
// were missing — a crawler reached them only by following links.
//
// SEO #1: /connect and /launch are intentionally DISALLOWED in robots.ts (private per-user funnels
// with no indexable content), so they must NOT appear here — advertising a robots-blocked URL produces
// "Submitted URL blocked by robots.txt" warnings in Search Console. The two SEO contracts must stay
// disjoint; seo.test.ts asserts that invariant. /onboarding used to sit on the disallow side, but it
// is the guided entry funnel with real explanatory content, so it is now indexable + enumerated here.
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
    // The two marketing decks. Both are public, indexable, linked from the header nav, and carry the
    // page's FAQ structured data — but neither was enumerated here, so discovery depended entirely on
    // a crawler following links from "/". /about-org is the org edition's only entry point.
    { path: "/about", priority: 0.6 },
    { path: "/about-org", priority: 0.6 },
    { path: "/badge", priority: 0.5 },
    { path: "/trends", priority: 0.5 },
    { path: "/usage", priority: 0.5 },
    // Guided onboarding entry — public explanatory funnel, no longer robots-blocked (see SEO #1 above).
    { path: "/onboarding", priority: 0.5 },
    // Legal pages — low priority, but enumerated so crawlers (and reviewers) find them directly.
    { path: "/privacy", priority: 0.3 },
    { path: "/terms", priority: 0.3 },
  ];
  return routes.map(({ path, priority }) => ({
    url: `${base}${path}`,
    changeFrequency: "weekly",
    priority,
  }));
}
