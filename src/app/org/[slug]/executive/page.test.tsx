// G8-54: the public /share/briefing/[token] page and this authenticated /org/[slug]/executive page
// render the SAME shared Card blocks (briefingCards.tsx), whose prop contract is deliberately
// "public by default" — every internal-only affordance (org deep links, practice deep links, the
// security dimension row, per-repo report links, the "Manage goals" action) is optional and defaults
// to OFF. share/briefing/[token]/page.test.tsx already pins that the PUBLIC page keeps all of those
// off. That alone doesn't prove the props are doing any gating — an always-absent feature would pass
// the same assertions. This file pins the other half: the authenticated exec page DOES turn every one
// of those affordances on, so the boundary is provably a prop switch, not a feature that's simply
// unimplemented everywhere.
//
// Style: call the async server-component function directly and walk the returned React element tree
// (no DOM render needed for a server component) — same pattern as
// src/app/org/[slug]/members/page.test.tsx and src/app/share/briefing/[token]/page.test.tsx.

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
import type { ExecBriefing } from "@/lib/org/briefing";

const { mockBuildExecBriefing, mockResolveOrgWindow, mockResolveStackScope, mockHasOrgRole, mockBriefingShareEnabled } =
  vi.hoisted(() => ({
    mockBuildExecBriefing: vi.fn(),
    mockResolveOrgWindow: vi.fn(),
    mockResolveStackScope: vi.fn(),
    mockHasOrgRole: vi.fn(),
    mockBriefingShareEnabled: vi.fn(),
  }));

vi.mock("@/lib/org/briefing", () => ({
  buildExecBriefing: mockBuildExecBriefing,
  briefingMarkdown: () => "md",
  engineMixLabel: () => "1 model",
  engineMixCaveat: () => null,
  forecastConfidenceNote: () => null,
  valueRealizedLine: () => null,
}));
vi.mock("@/lib/org/period", () => ({ resolveOrgWindow: mockResolveOrgWindow }));
vi.mock("@/lib/org/scope", () => ({ resolveStackScope: mockResolveStackScope }));
vi.mock("@/lib/authz", () => ({ hasOrgRole: mockHasOrgRole }));
vi.mock("@/lib/briefing-share", () => ({ briefingShareEnabled: mockBriefingShareEnabled }));
vi.mock("@/lib/db", () => ({
  getOrgBranding: vi.fn(async () => null),
  getCreditState: vi.fn(async () => null),
}));
vi.mock("@/lib/plans", () => ({ planAllowsWhiteLabel: () => false }));

import OrgExecutive from "./page";
import {
  BriefingDimensionCards,
  BriefingGoalsCard,
  BriefingMovementCard,
  BriefingTiles,
} from "@/components/org/executive/briefingCards";

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
    topGainers: [{ name: "repo-a", fullName: "acme/repo-a", dOverall: 5, levelFrom: "L2", levelTo: "L3" }],
    topRegressions: [],
    goals: [{ label: "Reach L4", pct: 60, current: 60, target: 100, etaDays: 30 }],
    regressionCount: 0,
    recommendations: [],
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

async function renderPage(slug = "acme") {
  return OrgExecutive({
    params: Promise.resolve({ slug }),
    searchParams: Promise.resolve({}),
  }) as Promise<React.ReactElement>;
}

beforeEach(() => {
  mockBuildExecBriefing.mockReset();
  mockResolveOrgWindow.mockReset().mockResolvedValue({ start: null, end: null, title: "Last 90 days", key: "90d", from: null, to: null, comparisonLabel: "vs last 90 days" });
  mockResolveStackScope.mockReset().mockResolvedValue({ techGroups: [], activeStack: null, techGroupId: null });
  mockHasOrgRole.mockReset().mockResolvedValue(false);
  mockBriefingShareEnabled.mockReset().mockReturnValue(false);
});

describe("OrgExecutive page — internal-only affordances turned ON (proves the shared props are a real switch)", () => {
  it("passes orgSlug so headline tiles deep-link into the org dashboard", async () => {
    mockBuildExecBriefing.mockResolvedValue(baseBriefing());

    const el = await renderPage();
    const tiles = findElement(el, BriefingTiles)!;

    expect(tiles).not.toBeNull();
    expect(tiles.props.orgSlug).toBe("acme"); // deep link switch ON — share page proves it OFF
  });

  it("passes practiceOrgSlug and the security dimension into BriefingDimensionCards", async () => {
    mockBuildExecBriefing.mockResolvedValue(baseBriefing());

    const el = await renderPage();
    const dims = findElement(el, BriefingDimensionCards)!;

    expect(dims).not.toBeNull();
    expect(dims.props.practiceOrgSlug).toBe("acme"); // practice deep links ON
    expect(dims.props.security).toEqual({ dimId: "D9", label: "Security", avg: 90 }); // D9 row surfaced
  });

  it("passes reportLinks:true so movers link to their per-repo report permalink", async () => {
    mockBuildExecBriefing.mockResolvedValue(baseBriefing());

    const el = await renderPage();
    const movement = findElement(el, BriefingMovementCard)!;

    expect(movement).not.toBeNull();
    expect(movement.props.reportLinks).toBe(true); // per-repo report link ON
  });

  it("passes a 'Manage goals' action into BriefingGoalsCard's header slot", async () => {
    mockBuildExecBriefing.mockResolvedValue(baseBriefing());

    const el = await renderPage();
    const goals = findElement(el, BriefingGoalsCard)!;

    expect(goals).not.toBeNull();
    expect(React.isValidElement(goals.props.right)).toBe(true); // "Manage goals →" link present
  });

  it("renders nothing (SectionEmpty) and skips the briefing cards entirely when there's no scanned data", async () => {
    mockBuildExecBriefing.mockResolvedValue(null);

    const el = await renderPage();

    expect(findElement(el, BriefingTiles)).toBeNull();
  });
});
