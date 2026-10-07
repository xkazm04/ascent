// robustness-3: the tab's four optional reads (impact ledger, program, branding, credit) degrade to
// null — the intent — but each failure is logged by name and reported.
import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  build: vi.fn(), ledger: vi.fn(), program: vi.fn(), branding: vi.fn(), credit: vi.fn(), report: vi.fn(),
}));

vi.mock("@/lib/api/respond", () => ({ reportHandledError: m.report }));
vi.mock("@/lib/org/briefing", () => ({ buildExecBriefing: m.build, briefingMarkdown: () => "md" }));
vi.mock("@/lib/org/period", () => ({
  resolveOrgWindow: async () => ({ title: "Last 90 days" }),
  orgWindowBounds: () => ({ start: null, endExclusive: null }),
}));
vi.mock("@/lib/org/scope", () => ({ resolveStackScope: async () => ({ techGroups: [], activeStack: null, techGroupId: null }) }));
vi.mock("@/lib/authz", () => ({ hasOrgRole: async () => true }));
vi.mock("@/lib/briefing-share", () => ({ briefingShareEnabled: () => false }));
vi.mock("@/lib/db", () => ({ getOrgBranding: m.branding, getCreditState: m.credit }));
vi.mock("@/lib/plans", () => ({ planAllowsWhiteLabel: () => false }));
vi.mock("@/lib/db/org-impact", () => ({ getOrgImpactLedger: m.ledger }));
vi.mock("@/lib/db/org-program", () => ({ getOrgProgram: m.program }));
vi.mock("@/lib/theme/server", () => ({ getTheme: async () => "altimeter" }));
vi.mock("./ExecutiveTab.v1", () => ({ executiveV1: (v: unknown) => v }));
vi.mock("./ExecutiveTab.v2", () => ({ executiveV2: (v: unknown) => v, executiveEmptyV2: () => null }));

import { ExecutiveTab } from "./ExecutiveTab";

const boom = new Error("db down");

beforeEach(() => {
  vi.clearAllMocks();
  m.build.mockResolvedValue({ org: "acme" });
});

describe("ExecutiveTab optional reads", () => {
  it("renders with null sections, warns naming each failed read, and reports each", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    m.ledger.mockRejectedValue(boom);
    m.program.mockRejectedValue(boom);
    m.branding.mockRejectedValue(boom);
    m.credit.mockRejectedValue(boom);
    const view = (await ExecutiveTab({ slug: "acme", sp: {} })) as unknown as Record<string, unknown>;
    expect(view.impact).toBeNull();
    expect(view.program).toBeNull();
    expect(view.branding).toBeNull();
    const warned = warn.mock.calls.map((c) => String(c[0])).join("\n");
    for (const read of ["impact ledger", "program", "branding", "credit state"]) expect(warned).toContain(`briefing tab ${read} failed`);
    expect(m.report).toHaveBeenCalledTimes(4);
    warn.mockRestore();
  });
});
