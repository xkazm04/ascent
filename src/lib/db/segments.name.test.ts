// getSegmentName — the client name a per-client briefing prints (value-1). It is read
// gate-then-constrain (AGENTS.md "An [id] route authorizes against the row's org"): the caller has gated
// the org, and the segment id is matched only INSIDE that org, so another org's id is simply not found.
import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockIsDbConfigured, mockGetPrisma } = vi.hoisted(() => ({ mockIsDbConfigured: vi.fn(), mockGetPrisma: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ isDbConfigured: mockIsDbConfigured, getPrisma: mockGetPrisma }));
vi.mock("@/lib/db/org-rollup", () => ({
  getOrgId: vi.fn(async (slug: string) => ({ acme: "org_acme", globex: "org_globex" })[slug] ?? null),
}));
vi.mock("@/lib/db/org", () => ({ getOrgRollup: vi.fn() }));

import { getSegmentName } from "./segments";

const SEGMENTS = [
  { id: "seg_acme", orgId: "org_acme", name: "Initech" },
  { id: "seg_globex", orgId: "org_globex", name: "Globex Corp" },
];
const findFirst = vi.fn(async ({ where }: { where: { id: string; orgId: string } }) => {
  const s = SEGMENTS.find((x) => x.id === where.id && x.orgId === where.orgId);
  return s ? { name: s.name } : null;
});

beforeEach(() => {
  vi.clearAllMocks();
  mockIsDbConfigured.mockReturnValue(true);
  mockGetPrisma.mockReturnValue({ segment: { findFirst } });
});

describe("getSegmentName", () => {
  it("resolves the org's own segment to its name", async () => {
    expect(await getSegmentName("acme", "seg_acme")).toBe("Initech");
    expect(findFirst).toHaveBeenCalledWith({ where: { id: "seg_acme", orgId: "org_acme" }, select: { name: true } });
  });

  it("another org's segment id yields no name", async () => {
    expect(await getSegmentName("acme", "seg_globex")).toBeNull();
  });

  it("an unknown org or id yields no name, and nothing is read without a database", async () => {
    expect(await getSegmentName("nobody", "seg_acme")).toBeNull();
    expect(await getSegmentName("acme", "seg_missing")).toBeNull();
    mockIsDbConfigured.mockReturnValue(false);
    findFirst.mockClear();
    expect(await getSegmentName("acme", "seg_acme")).toBeNull();
    expect(findFirst).not.toHaveBeenCalled();
  });

  it("a failed read throws rather than reading as 'no name'", async () => {
    findFirst.mockRejectedValueOnce(new Error("db down"));
    await expect(getSegmentName("acme", "seg_acme")).rejects.toThrow("db down");
  });
});
