// Prism switches the composition. Altimeter is pinned by ExecutiveTab.test.tsx.
import { describe, expect, it, vi, beforeEach } from "vitest";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Masthead } from "@/components/kit";
import { BriefingTiles } from "./briefingCards";
import { execBriefing } from "./executiveFixtures";

const { mockBuild, mockWindow, mockScope, mockRole, mockImpact } = vi.hoisted(() => ({
  mockBuild: vi.fn(),
  mockWindow: vi.fn(),
  mockScope: vi.fn(),
  mockRole: vi.fn(),
  mockImpact: vi.fn(),
}));

vi.mock("@/lib/theme/server", () => ({ getTheme: async () => "prism" }));
vi.mock("@/lib/org/briefing", () => ({
  buildExecBriefing: mockBuild,
  briefingMarkdown: () => "md",
  coverageLine: () => "Coverage: 2/2 repositories scanned",
  scoreBasisLine: () => null,
  noScoreLine: () => "No live score can be stated.",
  benchmarkCaption: () => "no corpus yet",
  valueRealizedLine: () => null,
  valueRealizedHeading: () => "Value this period",
  briefingProofLine: () => null,
  briefingLoopProofLine: () => null,
  movementLine: () => null,
  mockDisclosure: () => null,
  engineMixLabel: () => "",
  engineMixCaveat: () => null,
  briefingTrajectory: () => ({ headline: null, confidence: null, basis: null, insufficiency: null }),
  briefingTrajectoryNote: () => null,
  briefingGoalLine: () => "",
  briefingGoalStats: () => "",
}));
vi.mock("@/lib/org/period", () => ({
  resolveOrgWindow: mockWindow,
  orgWindowBounds: (w: { start: Date | null; endExclusive: Date | null }) => ({ start: w.start, endExclusive: w.endExclusive }),
}));
vi.mock("@/lib/org/scope", () => ({ resolveStackScope: mockScope }));
vi.mock("@/lib/authz", () => ({ hasOrgRole: mockRole }));
vi.mock("@/lib/briefing-share", () => ({ briefingShareEnabled: () => false }));
vi.mock("@/lib/db", () => ({ getOrgBranding: async () => null, getCreditState: async () => null }));
vi.mock("@/lib/plans", () => ({ planAllowsWhiteLabel: () => false }));
vi.mock("@/lib/db/org-impact", () => ({ getOrgImpactLedger: mockImpact }));

import { ExecutiveTab } from "./ExecutiveTab";

function findElement(node: unknown, type: unknown): React.ReactElement | null {
  if (!React.isValidElement(node)) return null;
  if (node.type === type) return node;
  const children = (node.props as { children?: unknown })?.children;
  for (const child of Array.isArray(children) ? children : [children]) {
    const found = findElement(child, type);
    if (found) return found;
  }
  return null;
}

beforeEach(() => {
  mockBuild.mockReset();
  mockWindow.mockReset().mockResolvedValue({
    start: null, end: null, endExclusive: null, title: "Last 90 days", key: "90d", comparisonLabel: "vs last 90 days", reviewTitle: "Last 90 days",
  });
  mockScope.mockReset().mockResolvedValue({ techGroups: [], activeStack: null, techGroupId: null });
  mockRole.mockReset().mockResolvedValue(false);
  mockImpact.mockReset().mockResolvedValue(null);
});

describe("ExecutiveTab prism composition", () => {
  it("renders the kit masthead instead of the altimeter tiles", async () => {
    mockBuild.mockResolvedValue(execBriefing());
    const el = await ExecutiveTab({ slug: "acme", sp: {} });
    expect((el as React.ReactElement<{ "data-role"?: string }>).props["data-role"]).toBe("executive-v2");
    expect(findElement(el, Masthead)).not.toBeNull();
    expect(findElement(el, BriefingTiles)).toBeNull();
  });

  it("keeps the empty-fleet sentence on the prism frame", async () => {
    mockBuild.mockResolvedValue(null);
    const markup = renderToStaticMarkup(await ExecutiveTab({ slug: "acme", sp: {} }));
    expect(markup).toContain("No scanned repositories yet.");
    expect(markup).toContain("generate an executive briefing.");
  });
});
