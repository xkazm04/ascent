// The authenticated Briefing tab (Prism). Internal-only affordances are ON here (deep links into the org
// dashboard, PDF, branded header); share/briefing/[token]/page.test.tsx pins the public page keeps them
// off. The async server component is rendered to static markup. Impact Ledger wiring lives in
// ExecutiveTab.impact.test.tsx and the Goals section in ExecutiveTab.goals.test.tsx (200-line cap).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { liveBriefing } from "./executiveFixtures";

const m = vi.hoisted(() => ({
  build: vi.fn(), window: vi.fn(), scope: vi.fn(), role: vi.fn(), share: vi.fn(), impact: vi.fn(),
  branding: vi.fn(), credit: vi.fn(), allowsBrand: vi.fn(),
}));

vi.mock("@/lib/org/briefing", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/org/briefing")>()),
  buildExecBriefing: m.build,
}));
vi.mock("@/lib/org/period", () => ({
  resolveOrgWindow: m.window,
  orgWindowBounds: (w: { start: Date | null; endExclusive: Date | null }) => ({ start: w.start, endExclusive: w.endExclusive }),
}));
vi.mock("@/lib/org/scope", () => ({ resolveStackScope: m.scope }));
vi.mock("@/lib/authz", () => ({ hasOrgRole: m.role }));
vi.mock("@/lib/briefing-share", () => ({ briefingShareEnabled: m.share }));
vi.mock("@/lib/db", () => ({ getOrgBranding: m.branding, getCreditState: m.credit }));
vi.mock("@/lib/plans", () => ({ planAllowsWhiteLabel: m.allowsBrand }));
vi.mock("@/lib/db/org-impact", () => ({ getOrgImpactLedger: m.impact }));
vi.mock("@/lib/db/org-program", () => ({ getOrgProgram: async () => null }));

import { ExecutiveTab } from "./ExecutiveTab";

async function markup(slug = "acme") {
  return renderToStaticMarkup(await ExecutiveTab({ slug, sp: {} }));
}

beforeEach(() => {
  m.build.mockReset();
  m.window.mockReset().mockResolvedValue({ start: null, end: null, endExclusive: null, title: "Last 90 days", key: "90d", from: null, to: null, comparisonLabel: "vs last 90 days", reviewTitle: "Last 90 days" });
  m.scope.mockReset().mockResolvedValue({ techGroups: [], activeStack: null, techGroupId: null });
  m.role.mockReset().mockResolvedValue(false);
  m.share.mockReset().mockReturnValue(false);
  m.impact.mockReset().mockResolvedValue(null);
  m.branding.mockReset().mockResolvedValue(null);
  m.credit.mockReset().mockResolvedValue(null);
  m.allowsBrand.mockReset().mockReturnValue(false);
});

describe("Briefing tab — internal-only affordances turned ON", () => {
  it("renders the Prism composition with the org-scoped links of the authenticated page", async () => {
    m.build.mockResolvedValue(liveBriefing());
    const html = await markup();
    expect(html).toContain('data-role="executive-v2"');
    expect(html).toContain("/api/org/briefing/pdf?org=acme");
    expect(html).toContain("/org/acme?tab=");
    expect(html).not.toContain("<img");
  });

  it("shows the dimensions and movers of a live-scored fleet", async () => {
    m.build.mockResolvedValue(liveBriefing());
    const html = await markup();
    for (const label of ["Testing", "Docs", "Security", "repo-a"]) expect(html).toContain(label);
  });

  it("renders nothing but the empty sentence when there is no scanned data", async () => {
    m.build.mockResolvedValue(null);
    const html = await markup();
    expect(html).toContain("No scanned repositories yet.");
    expect(html).not.toContain("Testing");
  });
});

describe("Briefing tab — in-app white-label header", () => {
  const brand = { brandName: "Acme Inc.", brandColor: "#c41e3a", logoUrl: "https://cdn.example/acme.png" };
  const asOwner = () => {
    m.build.mockResolvedValue(liveBriefing());
    m.role.mockResolvedValue(true);
    m.allowsBrand.mockReturnValue(true);
    m.credit.mockResolvedValue({ plan: "team" });
  };

  it("renders stored brand name, logo and accent on the briefing header when canBrand", async () => {
    asOwner();
    m.branding.mockResolvedValue(brand);
    const html = await markup();
    expect(html).toContain("Acme Inc.");
    expect(html).toContain("<img src=\"https://cdn.example/acme.png\"");
    expect(html).toContain("#c41e3a");
  });

  it("omits the branded header when no brand fields are set", async () => {
    asOwner();
    m.branding.mockResolvedValue({ brandName: null, brandColor: null, logoUrl: null });
    expect(await markup()).not.toContain("<img");
  });
});
