// G8-54: this authenticated /org/[slug]/executive page turns ON every internal-only affordance of
// the shared briefingCards.tsx blocks (public-by-default). share/briefing/[token]/page.test.tsx
// pins the public page keeps them off. Walk the async server-component tree (no DOM). Impact Ledger
// wiring lives in ExecutiveTab.impact.test.tsx (200-line cap).

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
import type { ExecBriefing } from "@/lib/org/briefing";

const {
  mockBuildExecBriefing,
  mockResolveOrgWindow,
  mockResolveStackScope,
  mockHasOrgRole,
  mockBriefingShareEnabled,
  mockGetOrgImpactLedger,
  mockGetOrgBranding,
  mockGetCreditState,
  mockPlanAllowsWhiteLabel,
} = vi.hoisted(() => ({
  mockBuildExecBriefing: vi.fn(),
  mockResolveOrgWindow: vi.fn(),
  mockResolveStackScope: vi.fn(),
  mockHasOrgRole: vi.fn(),
  mockBriefingShareEnabled: vi.fn(),
  mockGetOrgImpactLedger: vi.fn(),
  mockGetOrgBranding: vi.fn(),
  mockGetCreditState: vi.fn(),
  mockPlanAllowsWhiteLabel: vi.fn(),
}));

vi.mock("@/lib/org/briefing", () => ({
  buildExecBriefing: mockBuildExecBriefing,
  briefingMarkdown: () => "md",
  engineMixLabel: () => "1 model",
  engineMixCaveat: () => null,
  briefingTrajectory: (b: { forecastHeadline: string | null; forecastConfidence: number | null }) => ({
    headline: b.forecastHeadline,
    confidence: b.forecastConfidence,
    basis: null,
    insufficiency: null,
  }),
  briefingTrajectoryNote: (b: { forecastConfidence: number | null }) =>
    b.forecastConfidence != null ? `trend confidence ${b.forecastConfidence}%` : null,
  briefingGoal: (g: { insufficiency?: string | null }) => ({ headline: null, confidence: null, basis: null, insufficiency: g.insufficiency ?? null }),
  valueRealizedLine: () => null,
}));
vi.mock("@/lib/org/period", () => ({
  resolveOrgWindow: mockResolveOrgWindow,
  orgWindowBounds: (w: { start: Date | null; endExclusive: Date | null }) => ({ start: w.start, endExclusive: w.endExclusive }),
}));
vi.mock("@/lib/org/scope", () => ({ resolveStackScope: mockResolveStackScope }));
vi.mock("@/lib/authz", () => ({ hasOrgRole: mockHasOrgRole }));
vi.mock("@/lib/briefing-share", () => ({ briefingShareEnabled: mockBriefingShareEnabled }));
vi.mock("@/lib/db", () => ({
  getOrgBranding: mockGetOrgBranding,
  getCreditState: mockGetCreditState,
}));
vi.mock("@/lib/plans", () => ({ planAllowsWhiteLabel: mockPlanAllowsWhiteLabel }));
vi.mock("@/lib/db/org-impact", () => ({ getOrgImpactLedger: mockGetOrgImpactLedger }));

import { ExecutiveTab } from "./ExecutiveTab";
import {
  BriefingBrandHeader,
  BriefingDimensionCards,
  BriefingGoalsCard,
  BriefingMovementCard,
  BriefingTiles,
} from "./briefingCards";
import { BriefingBasisNote } from "./BriefingBasisNote";

function baseBriefing(overrides: Partial<ExecBriefing> = {}): ExecBriefing {
  return {
    org: "acme",
    periodTitle: "Last 90 days",
    generatedOn: "2026-07-28",
    maturity: { overall: 62, levelId: "L3", levelName: "Established", adoption: 50, rigor: 55 },
    coverage: { scanned: 10, total: 10 },
    realScoredCount: 10,
    mockCount: 0,
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
  return ExecutiveTab({ slug, sp: {} }) as Promise<React.ReactElement>;
}

beforeEach(() => {
  mockBuildExecBriefing.mockReset();
  mockResolveOrgWindow.mockReset().mockResolvedValue({ start: null, end: null, endExclusive: null, title: "Last 90 days", key: "90d", from: null, to: null, comparisonLabel: "vs last 90 days" });
  mockResolveStackScope.mockReset().mockResolvedValue({ techGroups: [], activeStack: null, techGroupId: null });
  mockHasOrgRole.mockReset().mockResolvedValue(false);
  mockBriefingShareEnabled.mockReset().mockReturnValue(false);
  mockGetOrgImpactLedger.mockReset().mockResolvedValue(null);
  mockGetOrgBranding.mockReset().mockResolvedValue(null);
  mockGetCreditState.mockReset().mockResolvedValue(null);
  mockPlanAllowsWhiteLabel.mockReset().mockReturnValue(false);
});

describe("OrgExecutive page — internal-only affordances turned ON (proves the shared props are a real switch)", () => {
  it("passes orgSlug so headline tiles deep-link into the org dashboard", async () => {
    mockBuildExecBriefing.mockResolvedValue(baseBriefing());
    const el = await renderPage();
    const tiles = findElement(el, BriefingTiles)!;
    expect(tiles).not.toBeNull();
    expect(tiles.props.orgSlug).toBe("acme");
    const note = findElement(el, BriefingBasisNote)!;
    expect(note).not.toBeNull();
    expect(note.props.briefing.coverage).toEqual({ scanned: 10, total: 10 });
    expect(findElement(el, BriefingBrandHeader)).toBeNull();
  });

  it("passes practiceOrgSlug and the security dimension into BriefingDimensionCards", async () => {
    mockBuildExecBriefing.mockResolvedValue(baseBriefing());
    const el = await renderPage();
    const dims = findElement(el, BriefingDimensionCards)!;
    expect(dims).not.toBeNull();
    expect(dims.props.practiceOrgSlug).toBe("acme");
    expect(dims.props.security).toEqual({ dimId: "D9", label: "Security", avg: 90 });
  });

  it("passes reportLinks:true so movers link to their per-repo report permalink", async () => {
    mockBuildExecBriefing.mockResolvedValue(baseBriefing());
    const el = await renderPage();
    const movement = findElement(el, BriefingMovementCard)!;
    expect(movement).not.toBeNull();
    expect(movement.props.reportLinks).toBe(true);
  });

  it("renders BriefingGoalsCard without a management action (goals are read-only since the Plan tab retired)", async () => {
    mockBuildExecBriefing.mockResolvedValue(baseBriefing());
    const el = await renderPage();
    const goals = findElement(el, BriefingGoalsCard)!;
    expect(goals).not.toBeNull();
    expect(goals.props.right).toBeUndefined();
  });

  it("renders nothing (SectionEmpty) and skips the briefing cards entirely when there's no scanned data", async () => {
    mockBuildExecBriefing.mockResolvedValue(null);
    expect(findElement(await renderPage(), BriefingTiles)).toBeNull();
  });
});

describe("OrgExecutive page — in-app white-label header", () => {
  const brand = { brandName: "Acme Inc.", brandColor: "#c41e3a", logoUrl: "https://cdn.example/acme.png" };

  it("renders stored brand name, logo and accent on the briefing header when canBrand", async () => {
    mockBuildExecBriefing.mockResolvedValue(baseBriefing());
    mockHasOrgRole.mockResolvedValue(true);
    mockPlanAllowsWhiteLabel.mockReturnValue(true);
    mockGetCreditState.mockResolvedValue({ plan: "team" });
    mockGetOrgBranding.mockResolvedValue(brand);
    const header = findElement(await renderPage(), BriefingBrandHeader)!;
    expect(header).not.toBeNull();
    expect(header.props.branding.brandName).toBe("Acme Inc.");
    expect(header.props.branding.logoUrl).toBe("https://cdn.example/acme.png");
    expect(header.props.branding.brandColor).toBe("#c41e3a");
  });

  it("omits the branded header when no brand fields are set", async () => {
    mockBuildExecBriefing.mockResolvedValue(baseBriefing());
    mockHasOrgRole.mockResolvedValue(true);
    mockPlanAllowsWhiteLabel.mockReturnValue(true);
    mockGetCreditState.mockResolvedValue({ plan: "team" });
    mockGetOrgBranding.mockResolvedValue({ brandName: null, brandColor: null, logoUrl: null });
    expect(findElement(await renderPage(), BriefingBrandHeader)).toBeNull();
  });
});
