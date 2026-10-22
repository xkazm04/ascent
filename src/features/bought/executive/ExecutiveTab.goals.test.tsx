// The Goals section of the authenticated briefing tab: goals are read-only, so with none and no notice
// the section is omitted (split from ExecutiveTab.test.tsx for the 200-line cap).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { liveBriefing } from "./executiveFixtures";

const m = vi.hoisted(() => ({ build: vi.fn(), window: vi.fn(), impact: vi.fn() }));

vi.mock("@/lib/org/briefing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/org/briefing")>()),
  buildExecBriefing: m.build,
}));
vi.mock("@/lib/org/period", () => ({
  resolveOrgWindow: m.window,
  orgWindowBounds: (w: { start: Date | null; endExclusive: Date | null }) => ({ start: w.start, endExclusive: w.endExclusive }),
}));
vi.mock("@/lib/org/scope", () => ({ resolveStackScope: async () => ({ techGroups: [], activeStack: null, techGroupId: null }) }));
vi.mock("@/lib/authz", () => ({ hasOrgRole: async () => false }));
vi.mock("@/lib/briefing-share", () => ({ briefingShareEnabled: () => false }));
vi.mock("@/lib/db", () => ({ getOrgBranding: async () => null, getCreditState: async () => null }));
vi.mock("@/lib/plans", () => ({ planAllowsWhiteLabel: () => false }));
vi.mock("@/lib/db/org-impact", () => ({ getOrgImpactLedger: m.impact }));
vi.mock("@/lib/db/org-program", () => ({ getOrgProgram: async () => null }));

import { ExecutiveTab } from "./ExecutiveTab";

const WINDOW = { start: null, end: null, endExclusive: null, title: "Last 90 days", key: "90d", from: null, to: null, comparisonLabel: "vs last 90 days", reviewTitle: "Last 90 days" };
const markup = async () => renderToStaticMarkup(await ExecutiveTab({ slug: "acme", sp: {} }));

beforeEach(() => {
  m.build.mockReset();
  m.window.mockReset().mockResolvedValue(WINDOW);
  m.impact.mockReset().mockResolvedValue(null);
});

describe("Briefing tab — the Goals section when goals are read-only", () => {
  it("omits the section when there are no goals and no notice", async () => {
    m.build.mockResolvedValue(liveBriefing({ goals: [], accountFiguresNotice: null }));
    expect(await markup()).not.toContain("Standing against");
  });

  it("lists each goal against its target when there are goals", async () => {
    m.build.mockResolvedValue(liveBriefing());
    const html = await markup();
    expect(html).toContain("Standing against");
    expect(html).toContain("Reach L4");
  });

  it("still renders the notice in the Goals slot when accountFiguresNotice is set", async () => {
    m.build.mockResolvedValue(liveBriefing({ goals: [], accountFiguresNotice: "Account figures omitted." }));
    expect(await markup()).toContain("Account figures omitted.");
  });
});
