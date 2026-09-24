// clearRepoWatch: the unwatch that never creates a row (backlog develop-2026-09-17 row 39).
// setRepoWatch(false) upserts, and a Repository row is the org's tenancy fact (orgTracksRepo), so the
// watch route unwatches an out-of-scope name through this update-only path instead.

import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockIsDbConfigured, mockGetPrisma, mockGetOrgId } = vi.hoisted(() => ({
  mockIsDbConfigured: vi.fn(),
  mockGetPrisma: vi.fn(),
  mockGetOrgId: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ isDbConfigured: mockIsDbConfigured, getPrisma: mockGetPrisma }));
vi.mock("@/lib/db/org-rollup", () => ({ getOrgId: mockGetOrgId }));

import { clearRepoWatch } from "./org-watch";

beforeEach(() => {
  vi.clearAllMocks();
  mockIsDbConfigured.mockReturnValue(true);
  mockGetOrgId.mockResolvedValue("org_1");
});

describe("clearRepoWatch", () => {
  it("clears the flag on an existing row with updateMany and never upserts", async () => {
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const upsert = vi.fn();
    mockGetPrisma.mockReturnValue({ repository: { updateMany, upsert } });

    await clearRepoWatch("acme", "octocat/Hello-World");

    expect(updateMany).toHaveBeenCalledWith({
      where: { orgId: "org_1", fullName: "octocat/Hello-World" },
      data: { watched: false },
    });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("is a no-op for an unknown org (nothing to clear, nothing minted)", async () => {
    mockGetOrgId.mockResolvedValue(null);
    const updateMany = vi.fn();
    mockGetPrisma.mockReturnValue({ repository: { updateMany } });

    await clearRepoWatch("ghost", "octocat/Hello-World");

    expect(updateMany).not.toHaveBeenCalled();
  });
});
