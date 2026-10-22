// The Impact Ledger half of the ExecutiveTab suite, split out of ExecutiveTab.test.tsx for the
// 200-line cap. The async server component is rendered to static markup.
//
// W1d — the Impact Ledger is an AUTHENTICATED, in-app panel. It reads ImprovementPr rows directly
// rather than riding on ExecBriefing, precisely so it cannot leak onto the public share page or into
// the board PDF, both of which render from the briefing object. These pin the wiring: same period,
// and a read failure degrades the panel away instead of failing the tab.

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

describe("Briefing tab — the Impact Ledger (W1d)", () => {
  it("scopes the ledger to the SAME period as the rest of the briefing", async () => {
    m.build.mockResolvedValue(liveBriefing());
    const start = new Date("2026-05-01T00:00:00Z");
    const endExclusive = new Date("2026-08-01T00:00:00Z");
    m.window.mockResolvedValue({ ...WINDOW, start, end: new Date(endExclusive.getTime() - 1), endExclusive });
    m.impact.mockResolvedValue({
      mergedCount: 1, verifiedCount: 1, awaitingRescan: 0, unmeasurable: 0,
      reposMoved: 1, dimPoints: 6, regressions: 0, byDim: [{ dimId: "D1", points: 6, prs: 1 }], rows: [],
    });

    const html = await markup();

    // Half-open bounds: the same shape buildExecBriefing gets, so the ledger and the briefing beside it
    // cannot disagree about a boundary scan.
    expect(m.impact).toHaveBeenCalledWith("acme", { start, endExclusive });
    expect(html).toContain("Impact ledger");
  });

  it("omits the panel rather than failing the tab when the read errors", async () => {
    m.build.mockResolvedValue(liveBriefing());
    m.impact.mockRejectedValue(new Error("db down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const html = await markup();
    warn.mockRestore();
    expect(html).not.toContain("Impact ledger");
    expect(html).toContain("Org maturity"); // the rest of the briefing still renders
  });

  it("omits the panel when there is no database to read from", async () => {
    m.build.mockResolvedValue(liveBriefing());
    m.impact.mockResolvedValue(null);
    expect(await markup()).not.toContain("Impact ledger");
  });
});
