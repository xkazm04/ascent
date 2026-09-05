// @vitest-environment jsdom
//
// Two regressions on the report's first-sight hero:
//   • HYDRATION: each credential seal drew 52 serration ticks from raw Math.cos/sin and emitted them
//     unrounded as SVG attributes (2 seals × 52 × 4 = 416 floats). Node and the browser disagree on the
//     last ULP, so the server and client markup differed and React reported a hydration mismatch on
//     every server-rendered permalink load. Coordinates are now rounded to 2dp (svgCoord.r2).
//   • DEAD TEST HOOK: the hero passed `data-testid` to <Surface>, which destructured only its styling
//     props and dropped everything else — the attribute never reached the DOM, so a query by testid
//     found nothing. Surface now forwards data-*/aria attributes.

import { describe, it, expect, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import type { AppPassport } from "@/lib/types";
import { PassportHero } from "./PassportHero";

// framer-motion needs window.matchMedia (useReducedMotion / the hero's usePrefersReducedMotion).
beforeAll(() => {
  if (!window.matchMedia) {
    window.matchMedia = ((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
      dispatchEvent: () => false,
    })) as unknown as typeof window.matchMedia;
  }
});

const PASSPORT: AppPassport = {
  passport: "app-passport",
  passportVersion: "1",
  generatedAt: "2026-07-27",
  generatedBy: "ascent",
  identity: {
    name: "slugify",
    slug: "slugify",
    purpose: "Slugify a string",
    archetype: "solo",
    visibility: "public",
    license: "MIT",
  },
  stack: {
    languages: [{ name: "TypeScript", primary: true }],
    frameworks: ["node"],
    persistence: [],
    monitoring: { errorTracking: null, logs: null, metrics: null, tracing: null, uptime: null },
    hosting: null,
    integrations: [],
  },
  automationReadiness: {
    level: "L3",
    score: 62,
    artifacts: { agentInstructions: [], contextGraph: "partial", memory: false, manifest: false, evals: "none", skills: false },
    selfVerify: { build: true, test: true, lint: true, typecheck: false },
    aiInWorkflow: true,
    blockers: [],
  },
  productionReadiness: {
    band: "beta",
    score: 55,
    ci: { level: "checks", provider: "github-actions", gates: [] },
    tests: { level: "partial", coveragePct: null, frameworks: [], criticalPathCovered: false },
    security: { level: "policy", tools: [] },
    observability: { level: "logs" },
    delivery: { migrations: "none", iac: false, rollback: false },
    blockers: [],
  },
  links: {},
  evidence: { confidence: 0.8, source: "scan", files: [] },
};

describe("PassportHero", () => {
  it("exposes its data-testid through Surface (the hook was previously dropped)", () => {
    render(<PassportHero passport={PASSPORT} repo="sindresorhus/slugify" />);
    expect(screen.getByTestId("passport-hero")).toBeInTheDocument();
  });

  it("emits seal tick coordinates rounded to 2dp, so SSR and client markup match", () => {
    const { container } = render(<PassportHero passport={PASSPORT} repo="sindresorhus/slugify" />);
    const lines = Array.from(container.querySelectorAll("line"));
    // Two seals × 52 serration ticks.
    expect(lines).toHaveLength(104);
    for (const line of lines) {
      for (const attr of ["x1", "y1", "x2", "y2"] as const) {
        const raw = line.getAttribute(attr)!;
        expect(raw).toMatch(/^-?\d+(\.\d{1,2})?$/); // never a full-precision float like 75.00000000000001
        expect(Number(raw)).toBe(Math.round(Number(raw) * 100) / 100);
      }
    }
  });
});
