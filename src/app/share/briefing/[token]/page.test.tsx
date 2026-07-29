// Pins G5-11 (regression warning) and G5-12 (comparison label) on the PUBLIC share page, plus the
// boundary they must respect: the public page renders MORE CONTEXT (a comparison label, a regression
// caveat) than before, but still exposes none of the internal-only affordances `briefingCards.tsx`
// gates behind optional props (org deep links, practice links, the security dimension row, per-repo
// report links). Style: call the async server-component function directly and walk the returned React
// element tree (no DOM render needed for a server component) — same pattern as
// src/app/org/[slug]/members/page.test.tsx.

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
import type { ExecBriefing } from "@/lib/org/briefing";

const { mockVerify, mockBuildExecBriefing } = vi.hoisted(() => ({
  mockVerify: vi.fn(),
  mockBuildExecBriefing: vi.fn(),
}));

vi.mock("@/lib/briefing-share", () => ({ verifyBriefingShareToken: mockVerify }));
vi.mock("@/lib/org/briefing", () => ({
  buildExecBriefing: mockBuildExecBriefing,
  engineMixLabel: () => "1 model",
  engineMixCaveat: () => null,
  forecastConfidenceNote: () => null,
  valueRealizedLine: () => null,
}));
vi.mock("@/lib/db", () => ({
  isDbConfigured: () => true,
  getOrgBranding: vi.fn(async () => null),
  getCreditState: vi.fn(async () => null),
  getTechGroupIdByKey: vi.fn(async () => null),
}));
vi.mock("@/lib/db/members", () => ({
  getMembershipRole: vi.fn(async () => "owner"),
  roleAtLeast: () => true,
}));
vi.mock("@/lib/plans", () => ({ planAllowsWhiteLabel: () => false }));

import SharedBriefingPage from "./page";
import {
  BriefingDimensionCards,
  BriefingGoalsCard,
  BriefingMovementCard,
  BriefingTiles,
} from "@/components/org/intelligence/executive/briefingCards";

function baseBriefing(overrides: Partial<ExecBriefing> = {}): ExecBriefing {
  return {
    org: "acme",
    periodTitle: "Last 90 days",
    generatedOn: "2026-07-28",
    maturity: { overall: 62, levelId: "L3", levelName: "Established", adoption: 50, rigor: 55 },
    coverage: { scanned: 10, total: 10 },
    periodDelta: 4,
    priorPeriod: null,
    forecastHeadline: "On track to reach L4 in ~6 weeks",
    forecastConfidence: 80,
    engineMix: [],
    adoptionRate: 40,
    movement: { up: 2, down: 1, compared: 3 },
    valueRealized: { recsEngaged: 0, recsActioned: 0, pointsMoved: null, reposPromoted: 0 },
    benchmark: null,
    strengths: [{ dimId: "D1", label: "Testing", avg: 80 }],
    risks: [{ dimId: "D2", label: "Docs", avg: 30 }],
    security: { dimId: "D9", label: "Security", avg: 90 },
    topGainers: [],
    topRegressions: [],
    goals: [],
    regressionCount: 0,
    ...overrides,
  } as ExecBriefing;
}

/** Depth-first search the returned element tree for the first element whose `type` matches. */
function findElement(node: unknown, type: unknown): React.ReactElement | null {
  if (!React.isValidElement(node)) return null;
  if (node.type === type) return node;
  const children = (node.props as { children?: unknown })?.children;
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) {
    const found = findElement(child, type);
    if (found) return found;
  }
  return null;
}

/** Depth-first collect all text content in the tree, so we can assert on rendered copy without a DOM render. */
function collectText(node: unknown, out: string[] = []): string[] {
  if (typeof node === "string" || typeof node === "number") {
    out.push(String(node));
    return out;
  }
  if (!React.isValidElement(node)) return out;
  const children = (node.props as { children?: unknown })?.children;
  const list = Array.isArray(children) ? children : [children];
  for (const child of list) collectText(child, out);
  return out;
}

async function renderPage(token = "tok") {
  return SharedBriefingPage({ params: Promise.resolve({ token }) }) as Promise<React.ReactElement>;
}

beforeEach(() => {
  mockVerify.mockReset();
  mockBuildExecBriefing.mockReset();
  mockVerify.mockReturnValue({ org: "acme", range: "90d", winStart: null, winEnd: null });
});

describe("SharedBriefingPage — G5-12 comparison label", () => {
  it("passes a comparison deltaLabel to the maturity tile (mirrors the internal page's 'vs …' context)", async () => {
    mockBuildExecBriefing.mockResolvedValue(baseBriefing({ periodTitle: "Last 90 days", periodDelta: 4 }));

    const el = await renderPage();
    const tiles = findElement(el, BriefingTiles);

    expect(tiles).not.toBeNull();
    expect(tiles!.props.delta).toBe(4);
    expect(tiles!.props.deltaLabel).toBe("vs last 90 days");
  });
});

describe("SharedBriefingPage — G5-11 regression warning", () => {
  it("renders the regression caveat when regressionCount > 0", async () => {
    mockBuildExecBriefing.mockResolvedValue(baseBriefing({ regressionCount: 3 }));

    const el = await renderPage();
    const text = collectText(el).join("").replace(/\s+/g, " ").trim();

    expect(text).toContain("3 repos regressed");
  });

  it("renders singular phrasing for regressionCount === 1", async () => {
    mockBuildExecBriefing.mockResolvedValue(baseBriefing({ regressionCount: 1, forecastHeadline: null }));

    const el = await renderPage();
    const text = collectText(el).join("").replace(/\s+/g, " ").trim();

    expect(text).toContain("1 repo regressed");
    expect(text).not.toContain("1 repos regressed");
  });

  it("omits the regression caveat when regressionCount is 0", async () => {
    mockBuildExecBriefing.mockResolvedValue(baseBriefing({ regressionCount: 0 }));

    const el = await renderPage();
    const text = collectText(el).join("").replace(/\s+/g, " ").trim();

    expect(text).not.toContain("regressed");
  });

  it("still renders the Trajectory card on regressionCount alone, even with no forecast headline", async () => {
    mockBuildExecBriefing.mockResolvedValue(baseBriefing({ regressionCount: 2, forecastHeadline: null }));

    const el = await renderPage();
    const text = collectText(el).join("").replace(/\s+/g, " ").trim();

    expect(text).toContain("2 repos regressed");
    expect(text).toContain("Not enough history yet to project a trajectory.");
  });
});

describe("SharedBriefingPage — public-safe boundary (no internal-only affordance added)", () => {
  it("keeps every internal-only prop off, even with the new comparison label + regression warning", async () => {
    mockBuildExecBriefing.mockResolvedValue(baseBriefing({ regressionCount: 2 }));

    const el = await renderPage();

    const tiles = findElement(el, BriefingTiles)!;
    expect(tiles.props.orgSlug).toBeFalsy(); // no deep links into the authenticated org dashboard

    const dims = findElement(el, BriefingDimensionCards)!;
    expect(dims.props.practiceOrgSlug ?? null).toBeNull(); // no practice deep links
    expect(dims.props.security ?? null).toBeNull(); // security dimension never surfaced publicly

    const movement = findElement(el, BriefingMovementCard)!;
    expect(movement.props.reportLinks ?? false).toBe(false); // no /report/... permalinks leaked

    const goals = findElement(el, BriefingGoalsCard);
    expect(goals?.props.right ?? null).toBeFalsy(); // no "Manage goals" action for an anonymous viewer
  });
});
