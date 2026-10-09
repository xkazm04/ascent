// A per-client (segment-scoped) share link omits the account-wide goals and corpus percentile and
// says so in their place: the recipient is the reseller's client, who must not see the account's other
// goals. Walks the async server-component tree (no DOM), like page.test.tsx.

import { describe, it, expect, vi, beforeEach } from "vitest";
import * as React from "react";
import type { ExecBriefing } from "@/lib/org/briefing";

const { mockVerify, mockBuildExecBriefing } = vi.hoisted(() => ({ mockVerify: vi.fn(), mockBuildExecBriefing: vi.fn() }));
const NOTICE = "Account-wide goals and the corpus percentile are not shown on a per-client briefing.";

vi.mock("@/lib/briefing-share", () => ({
  verifyBriefingShareToken: mockVerify,
  briefingFigureDigest: () => "stub-digest",
  shareIntegrity: () => "unverifiable" as const,
}));
vi.mock("@/lib/db/org-share", () => ({ briefingShareLinkState: async () => "live" }));
vi.mock("@/lib/org/briefing", () => ({
  buildExecBriefing: mockBuildExecBriefing,
  engineMixLabel: () => "1 model",
  engineMixCaveat: () => null,
  valueRealizedLine: () => null,
  mockDisclosure: () => null,
}));
vi.mock("@/lib/db", () => ({
  isDbConfigured: () => true,
  getOrgBranding: vi.fn(async () => null),
  getCreditState: vi.fn(async () => null),
  getTechGroupIdByKey: vi.fn(async () => null),
  getOrgId: vi.fn(async () => "org1"),
  recordAudit: vi.fn(async () => true),
}));
vi.mock("@/lib/db/members", () => ({ getMembershipRole: vi.fn(async () => "owner"), roleAtLeast: () => true }));
vi.mock("@/lib/plans", () => ({ planAllowsWhiteLabel: () => false }));

import SharedBriefingPage from "./page";
import { BriefingGoalsCard, BriefingTiles } from "@/features/bought/executive/briefingCards";
import { SectionHeader } from "@/components/org/shared/ui";

function find(node: unknown, type: unknown): React.ReactElement | null {
  if (!React.isValidElement(node)) return null;
  if (node.type === type) return node;
  const children = (node.props as { children?: unknown })?.children;
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = find(child, type);
    if (found) return found;
  }
  return null;
}

const briefing = (over: Partial<ExecBriefing> = {}) =>
  ({
    org: "acme",
    periodTitle: "Last 90 days",
    generatedOn: "2026-07-28",
    maturity: { overall: 62, levelId: "L3", levelName: "Established", adoption: 50, rigor: 55 },
    coverage: { scanned: 10, total: 10 },
    realScoredCount: 10,
    mockCount: 0,
    periodDelta: null,
    priorPeriod: null,
    forecastHeadline: null,
    forecastConfidence: null,
    engineMix: [],
    movement: { up: 0, down: 0, compared: 0 },
    valueRealized: { recsEngaged: 0, recsActioned: 0, pointsMoved: null, reposPromoted: 0 },
    benchmark: null,
    strengths: [],
    risks: [],
    security: null,
    topGainers: [],
    topRegressions: [],
    goals: [],
    regressionCount: 0,
    ...over,
  }) as ExecBriefing;

beforeEach(() => {
  mockVerify.mockReset();
  mockBuildExecBriefing.mockReset();
  mockVerify.mockReturnValue({ org: "acme", range: "90d", winStart: null, winEnd: null, segment: "seg_1" });
});

describe("share page — segment-scoped link", () => {
  it("prints the notice in the Goals slot and captions the percentile tile as omitted", async () => {
    mockBuildExecBriefing.mockResolvedValue(briefing({ accountFiguresNotice: NOTICE }));
    const el = (await SharedBriefingPage({ params: Promise.resolve({ token: "t" }) })) as React.ReactElement;
    expect(find(el, BriefingGoalsCard)!.props.emptyText).toBe(NOTICE);
    expect(find(el, BriefingTiles)!.props.benchmarkOmitted).toBe(true);
  });

  it("an unscoped link with no goals omits the Goals section and keeps the normal percentile caption", async () => {
    mockVerify.mockReturnValue({ org: "acme", range: "90d", winStart: null, winEnd: null });
    mockBuildExecBriefing.mockResolvedValue(briefing());
    const el = (await SharedBriefingPage({ params: Promise.resolve({ token: "t" }) })) as React.ReactElement;
    expect(find(el, BriefingGoalsCard)).toBeNull();
    expect(find(el, BriefingTiles)!.props.benchmarkOmitted).toBe(false);
  });

  it("heads a per-client link with the CLIENT, and builds from the segment the signed token carries", async () => {
    mockBuildExecBriefing.mockResolvedValue(briefing({ segmentName: "Globex Corp", accountFiguresNotice: NOTICE }));
    const el = (await SharedBriefingPage({ params: Promise.resolve({ token: "t" }) })) as React.ReactElement;
    expect(find(el, SectionHeader)!.props.title).toBe("Globex Corp: executive briefing");
    expect(mockBuildExecBriefing.mock.calls[0]![3]).toBe("seg_1");
  });

  it("an unscoped link is headed with the org exactly as before", async () => {
    mockVerify.mockReturnValue({ org: "acme", range: "90d", winStart: null, winEnd: null });
    mockBuildExecBriefing.mockResolvedValue(briefing({ segmentName: null }));
    const el = (await SharedBriefingPage({ params: Promise.resolve({ token: "t" }) })) as React.ReactElement;
    expect(find(el, SectionHeader)!.props.title).toBe("acme: executive briefing");
    expect(mockBuildExecBriefing.mock.calls[0]![3]).toBeNull();
  });
});
