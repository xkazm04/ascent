// Pins getMeasuredAttribution: the server read behind the Integrations reconcile (card providers-1).
// It must join against the SAME set Delivery draws (getOrgPrSignals.perRepo) and sum measured
// scope=repo spend over the Delivery default window, case-folded. Client + org boundaries mocked.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockIsDbConfigured, mockGetPrisma, mockGetOrgBySlug, mockGetOrgPrSignals } = vi.hoisted(() => ({
  mockIsDbConfigured: vi.fn(),
  mockGetPrisma: vi.fn(),
  mockGetOrgBySlug: vi.fn(),
  mockGetOrgPrSignals: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ isDbConfigured: mockIsDbConfigured, getPrisma: mockGetPrisma }));
vi.mock("@/lib/db/org-shared", () => ({ getOrgBySlug: mockGetOrgBySlug }));
vi.mock("@/lib/db/org-signals", () => ({ getOrgPrSignals: mockGetOrgPrSignals }));

import { getMeasuredAttribution } from "./integrations-attribution";
import { reconcile } from "@/features/admin/integrations/attributionReconcileModel";

const usageFindMany = vi.fn();
const repoFindMany = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mockIsDbConfigured.mockReturnValue(true);
  mockGetOrgBySlug.mockResolvedValue({ id: "org1", slug: "acme" });
  mockGetPrisma.mockReturnValue({ aiUsageRecord: { findMany: usageFindMany }, repository: { findMany: repoFindMany } });
  usageFindMany.mockResolvedValue([
    { scope: "repo", scopeKey: "Acme/X", costCents: 3000 },
    { scope: "repo", scopeKey: "acme/x", costCents: 1000 },
    { scope: "repo", scopeKey: "acme/y", costCents: 1000 },
  ]);
  repoFindMany.mockResolvedValue([{ fullName: "acme/x" }, { fullName: "acme/z" }]);
  mockGetOrgPrSignals.mockResolvedValue({ perRepo: [{ fullName: "acme/x" }] });
});

describe("getMeasuredAttribution", () => {
  it("sums measured repo spend case-folded and joins it to Delivery's own set", async () => {
    const wire = await getMeasuredAttribution("acme", new Date("2026-10-22T12:00:00Z"));
    expect(wire).not.toBeNull();
    expect(wire!.measured).toEqual([
      { repo: "Acme/X", costCents: 4000 },
      { repo: "acme/y", costCents: 1000 },
    ]);
    expect(wire!.deliverySet).toEqual(["acme/x"]);
    expect(wire!.fleet).toEqual(["acme/x", "acme/z"]);
    expect(wire!.windowTitle).toBe("Last 90 days");
    // Unscoped: the reconcile speaks for the whole org, as the Delivery default does.
    expect(mockGetOrgPrSignals).toHaveBeenCalledWith("acme");
    const where = usageFindMany.mock.calls[0]![0].where;
    expect(where).toMatchObject({ orgId: "org1", source: "claude-code", scope: "repo" });
    expect(where.periodStart.gte).toBeInstanceOf(Date);
    const rec = reconcile({ ...wire!, gitlabConnected: false });
    expect(rec.landed).toEqual(["Acme/X"]);
    expect(rec.outsideFleet).toEqual(["acme/y"]);
    expect(rec.hiddenShare).toBe(0.2);
  });

  it("treats no PR signals as an empty delivery set, so all measured spend is hidden", async () => {
    mockGetOrgPrSignals.mockResolvedValue(null);
    const wire = await getMeasuredAttribution("acme");
    expect(wire!.deliverySet).toEqual([]);
  });

  it("says nothing when the db is off or the org is unknown", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    expect(await getMeasuredAttribution("acme")).toBeNull();
    mockIsDbConfigured.mockReturnValue(true);
    mockGetOrgBySlug.mockResolvedValue(null);
    expect(await getMeasuredAttribution("acme")).toBeNull();
  });
});
