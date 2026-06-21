// robots.ts + sitemap.ts are the SEO crawl contract for the public surface. Both are pure functions
// of process.env (robots via its own baseUrl(), sitemap via @/lib/site publicBaseUrl()), so we drive
// them by toggling ASCENT_PUBLIC_URL / NEXT_PUBLIC_APP_URL with save/restore (the repo's existing env
// pattern) — no mocks needed.
//
// The contract these tests LOCK so a merge/refactor can't silently break it:
//  - robots ALWAYS disallows the machine API + the private per-user funnels (/api/, /connect,
//    /onboarding, /launch). Dropping any entry = an indexable private route = a test failure here.
//  - robots allows the public marketing/report surface at "/".
//  - robots only emits the absolute sitemap/host lines when a base URL is configured (they require an
//    absolute origin); with no base it omits them rather than shipping a relative/broken value.
//  - sitemap is gated off the canonical base URL: no base → [] (never relative/empty-host entries);
//    with a base, every entry is an absolute URL under that base and the set contains ONLY public,
//    indexable routes — no /api/, no per-tenant /org/ path ever leaks in.
//  - robots' local baseUrl() and lib/site publicBaseUrl() resolve identically for the same env (they
//    duplicate the trailing-slash-strip logic and would otherwise drift).

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import robots from "./robots";
import sitemap from "./sitemap";
import { publicBaseUrl } from "@/lib/site";

const ENV_KEYS = ["ASCENT_PUBLIC_URL", "NEXT_PUBLIC_APP_URL", "VERCEL_PROJECT_PRODUCTION_URL"] as const;
let savedEnv: Record<string, string | undefined>;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
});

// The exact set the disallow list must always cover. Pinned so removing an entry fails the suite.
const REQUIRED_DISALLOW = ["/api/", "/connect", "/onboarding", "/launch"];

describe("robots.ts — private/funnel routes stay out of the index", () => {
  it("disallows the machine API + every private funnel route (exact pinned set)", () => {
    const rules = robots().rules;
    // robots() returns a single rule object (not an array) in this codebase.
    const single = Array.isArray(rules) ? rules[0] : rules;
    expect(single.userAgent).toBe("*");
    const disallow = single.disallow;
    const list = Array.isArray(disallow) ? disallow : [disallow];
    for (const path of REQUIRED_DISALLOW) {
      expect(list).toContain(path);
    }
    // Pin the exact set so an ADDED-but-also a DROPPED entry is caught (no silent drift).
    expect([...list].sort()).toEqual([...REQUIRED_DISALLOW].sort());
  });

  it("allows the public marketing/report surface at the site root", () => {
    const rules = robots().rules;
    const rule = Array.isArray(rules) ? rules[0] : rules;
    expect(rule.allow).toBe("/");
  });

  it("omits the absolute sitemap/host lines when no base URL is configured", () => {
    const r = robots();
    expect(r.sitemap).toBeUndefined();
    expect(r.host).toBeUndefined();
  });

  it("emits absolute sitemap + host (origin only, trailing slash stripped) when a base is set", () => {
    process.env.ASCENT_PUBLIC_URL = "https://ascent.dev/";
    const r = robots();
    expect(r.sitemap).toBe("https://ascent.dev/sitemap.xml");
    expect(r.host).toBe("https://ascent.dev");
  });
});

describe("sitemap.ts — only public, indexable routes, gated off an absolute base", () => {
  it("emits nothing when no public base is configured (no relative/empty-host entries)", () => {
    expect(sitemap()).toEqual([]);
  });

  it("every entry is an absolute URL under the configured base", () => {
    process.env.ASCENT_PUBLIC_URL = "https://ascent.dev";
    const entries = sitemap();
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(typeof e.url).toBe("string");
      expect(e.url.startsWith("https://ascent.dev")).toBe(true);
      // Absolute: parses as a URL and carries a real host (no broken/empty-host entry).
      const u = new URL(e.url);
      expect(u.protocol).toBe("https:");
      expect(u.host).toBe("ascent.dev");
    }
  });

  it("never leaks a private/authenticated path (no /api/, no per-tenant /org/, no funnel-only /launch)", () => {
    process.env.ASCENT_PUBLIC_URL = "https://ascent.dev";
    const paths = sitemap().map((e) => new URL(e.url).pathname);
    for (const p of paths) {
      expect(p.startsWith("/api/")).toBe(false);
      expect(p.startsWith("/org")).toBe(false);
      expect(p).not.toBe("/launch");
    }
    // The legitimate public surface IS present (a positive control so the test can't pass vacuously).
    expect(paths).toContain("/");
    expect(paths).toContain("/report");
    expect(paths).toContain("/pricing");
  });

  it("strips a trailing slash on the base so URLs are not double-slashed", () => {
    process.env.ASCENT_PUBLIC_URL = "https://ascent.dev/";
    for (const e of sitemap()) {
      expect(e.url).not.toContain("//report");
      expect(e.url).not.toMatch(/ascent\.dev\/\//);
    }
  });
});

describe("base-URL resolution does not drift between robots and lib/site", () => {
  it("robots' sitemap host matches publicBaseUrl() for the same env (both strip trailing slashes)", () => {
    process.env.ASCENT_PUBLIC_URL = "https://ascent.dev///";
    expect(publicBaseUrl()).toBe("https://ascent.dev");
    expect(robots().host).toBe(publicBaseUrl());
  });

  it("falls back to NEXT_PUBLIC_APP_URL identically in both resolvers", () => {
    process.env.NEXT_PUBLIC_APP_URL = "https://app.ascent.dev/";
    expect(publicBaseUrl()).toBe("https://app.ascent.dev");
    expect(robots().host).toBe("https://app.ascent.dev");
  });

  // SEO #2: on a zero-config Vercel deploy (no explicit ASCENT/NEXT url) sitemap.xml is emitted from
  // VERCEL_PROJECT_PRODUCTION_URL, so robots MUST point at it too — the old local baseUrl() lacked this
  // fallback and silently dropped the Sitemap/host lines, defeating auto-discovery.
  it("falls back to VERCEL_PROJECT_PRODUCTION_URL in BOTH resolvers (zero-config Vercel)", () => {
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "ascent.vercel.app";
    expect(publicBaseUrl()).toBe("https://ascent.vercel.app");
    const r = robots();
    expect(r.host).toBe("https://ascent.vercel.app");
    expect(r.sitemap).toBe("https://ascent.vercel.app/sitemap.xml");
    // sitemap.xml itself resolves under the same base, so robots' Sitemap line is not a dangling pointer.
    expect(sitemap().length).toBeGreaterThan(0);
    expect(sitemap()[0]!.url.startsWith("https://ascent.vercel.app")).toBe(true);
  });

  it("explicit ASCENT_PUBLIC_URL still wins over the Vercel fallback in both resolvers", () => {
    process.env.ASCENT_PUBLIC_URL = "https://ascent.dev";
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "ascent.vercel.app";
    expect(publicBaseUrl()).toBe("https://ascent.dev");
    expect(robots().host).toBe("https://ascent.dev");
  });
});

describe("SEO #1: the sitemap and robots-disallow contracts are disjoint", () => {
  // A crawler that finds a sitemap URL then gets blocked by robots.txt logs a "Submitted URL blocked
  // by robots.txt" warning. Advertising a disallowed path is self-contradicting — pin that no sitemap
  // entry's path is (or is under) any robots-disallowed prefix.
  it("no sitemap entry path is covered by a robots disallow entry", () => {
    process.env.ASCENT_PUBLIC_URL = "https://ascent.dev";
    const rules = robots().rules;
    const single = Array.isArray(rules) ? rules[0] : rules;
    const disallow = single.disallow;
    const blocked = (Array.isArray(disallow) ? disallow : [disallow]).filter((d): d is string => typeof d === "string");
    const sitemapPaths = sitemap().map((e) => new URL(e.url).pathname);
    for (const p of sitemapPaths) {
      for (const d of blocked) {
        // robots prefixes match a path if it equals the rule or starts with it (e.g. "/connect" blocks
        // "/connect" and "/connect/x"). "/api/" (trailing slash) only matches under that prefix.
        const matches = p === d || p.startsWith(d.endsWith("/") ? d : `${d}/`);
        expect(matches, `sitemap path "${p}" must not be blocked by robots disallow "${d}"`).toBe(false);
      }
    }
  });

  it("the previously-advertised private funnels are no longer in the sitemap", () => {
    process.env.ASCENT_PUBLIC_URL = "https://ascent.dev";
    const paths = sitemap().map((e) => new URL(e.url).pathname);
    expect(paths).not.toContain("/connect");
    expect(paths).not.toContain("/onboarding");
  });
});
