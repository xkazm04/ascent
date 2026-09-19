// The accounting half of "best effort with accounting": a swallowed audit write must still be COUNTED.
//
// The first case is the one that matters — it drives a real `recordAudit` through a prisma client whose
// `create` rejects (the same mocking shape scans-audit.test.ts uses) and asserts the counter moved. A
// unit test of noteAuditWriteFailure alone would pass even if nothing ever called it, which is exactly
// the failure mode this direction exists to close.

import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockIsDbConfigured, mockGetPrisma } = vi.hoisted(() => ({
  mockIsDbConfigured: vi.fn(),
  mockGetPrisma: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  isDbConfigured: mockIsDbConfigured,
  getPrisma: mockGetPrisma,
  withRetry: (fn: () => unknown) => fn(),
}));

import { getAuditHealth, noteAuditWriteFailure, resetAuditHealth } from "./audit-health";
import { recordAudit, claimOrgAuditOnce, releaseAuditClaim } from "./scans-audit";

beforeEach(() => {
  resetAuditHealth();
  mockIsDbConfigured.mockReset();
  mockGetPrisma.mockReset();
  mockIsDbConfigured.mockReturnValue(true);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("audit-health counter", () => {
  it("starts empty — no failures, no since, nothing to surface", () => {
    expect(getAuditHealth()).toEqual({ failed: 0, since: null, lastAction: null, lastError: null });
  });

  it("keeps the FIRST failure's instant as `since` while counting every subsequent one", () => {
    noteAuditWriteFailure("scan.created", new Error("boom"));
    const first = getAuditHealth();
    noteAuditWriteFailure("org.plan", new Error("later"));
    const second = getAuditHealth();

    expect(second.failed).toBe(2);
    expect(second.since).toBe(first.since); // the window START, not the latest failure
    expect(second.lastAction).toBe("org.plan");
    expect(second.lastError).toBe("later");
  });

  it("carries a message, never the error object (this snapshot crosses to a client)", () => {
    noteAuditWriteFailure("scan.created", "a bare string rejection");
    expect(getAuditHealth().lastError).toBe("a bare string rejection");
    expect(typeof getAuditHealth().since).toBe("string"); // ISO string, never a Date
  });
});

describe("the three swallowing catch sites all report", () => {
  it("recordAudit: a failing prisma create is counted, and the caller still gets false (not a throw)", async () => {
    mockGetPrisma.mockReturnValue({
      auditLog: { create: vi.fn(async () => { throw new Error("connection reset"); }) },
    });

    await expect(recordAudit("scan.created", { scanId: "s1" })).resolves.toBe(false);

    const health = getAuditHealth();
    expect(health.failed).toBe(1);
    expect(health.lastAction).toBe("scan.created");
    expect(health.lastError).toContain("connection reset");
    expect(health.since).not.toBeNull();
  });

  it("claimOrgAuditOnce: a failing transaction is counted, and the claim still fails CLOSED", async () => {
    mockGetPrisma.mockReturnValue({
      organization: { findUnique: vi.fn(async () => ({ id: "org_1" })) },
      $transaction: vi.fn(async () => { throw new Error("tx aborted"); }),
    });

    const res = await claimOrgAuditOnce("org.digest.sent", "acme", new Date(0), {});

    expect(res).toEqual({ claimed: false, id: null });
    expect(getAuditHealth()).toMatchObject({ failed: 1, lastAction: "org.digest.sent" });
  });

  it("releaseAuditClaim: a failing release is counted under the claim.released action", async () => {
    mockGetPrisma.mockReturnValue({
      auditLog: {
        findUnique: vi.fn(async () => ({
          id: "aud_1",
          action: "org.digest.sent",
          orgId: "org_1",
          actorId: null,
          at: new Date("2026-01-02T00:00:00.000Z"),
        })),
        create: vi.fn(async () => { throw new Error("write failed"); }),
      },
    });

    await expect(releaseAuditClaim("aud_1")).resolves.toBeUndefined(); // still never throws

    expect(getAuditHealth()).toMatchObject({ failed: 1, lastAction: "claim.released" });
  });

  it("counts nothing on the happy path", async () => {
    mockGetPrisma.mockReturnValue({ auditLog: { create: vi.fn(async () => ({ id: "a1" })) } });
    await expect(recordAudit("scan.created", {})).resolves.toBe(true);
    expect(getAuditHealth().failed).toBe(0);
  });
});
