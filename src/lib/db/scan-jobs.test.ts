// The queue's money-and-fairness invariants (moonshot #10):
//
//   • ENQUEUE IS IDEMPOTENT — a redelivered webhook computes the same idempotencyKey and yields ONE
//     job. Fails against the pre-queue tree, which had no dedup for the interactive/import paths at
//     all beyond a process-local Map.
//   • CLAIM IS A CAS — the conditional updateMany on `state: "queued"` means two concurrent workers
//     cannot both win the same row (`count !== 1` ⇒ null). This is the guard that replaces the
//     module-global Map with a cross-instance one, and therefore the double-billing guard.
//   • PEER DEDUP — two runs legitimately enqueue two DIFFERENT jobs for the same repo (two runIds);
//     the second claim yields to the older live claim instead of scanning the repo twice.
//   • LEASE SELF-HEAL — an expired lease returns to `queued` while attempts remain, and settles
//     `failed` (never loops) once they are exhausted.

import { describe, it, expect, beforeEach, vi } from "vitest";

const { mockIsDbConfigured, mockGetPrisma, mockGetOrgId } = vi.hoisted(() => ({
  mockIsDbConfigured: vi.fn(),
  mockGetPrisma: vi.fn(),
  mockGetOrgId: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({ isDbConfigured: mockIsDbConfigured, getPrisma: mockGetPrisma }));
vi.mock("@/lib/db/org-rollup", () => ({ getOrgId: mockGetOrgId }));

import {
  claimJobById,
  enqueueScanJob,
  idempotencyKeyFor,
  MAX_JOB_ATTEMPTS,
  queueDepth,
  reapExpiredLeases,
  settleJob,
} from "./scan-jobs";

beforeEach(() => {
  mockIsDbConfigured.mockReset().mockReturnValue(true);
  mockGetPrisma.mockReset();
  mockGetOrgId.mockReset().mockResolvedValue("org_1");
});

const repoFind = () => vi.fn(async () => ({ id: "repo_1" }));

describe("enqueue idempotency", () => {
  it("keys on org|repo|lane|bucket, lower-casing the repo so casing can't fork the key", () => {
    expect(idempotencyKeyFor("org_1", "Acme/API", "probe", "d-9")).toBe("org_1|acme/api|probe|d-9");
  });

  it("a REDELIVERED webhook yields ONE job: the unique key rejects the second create", async () => {
    const create = vi
      .fn()
      .mockResolvedValueOnce({ id: "job_1" })
      .mockRejectedValueOnce(new Error("Unique constraint failed on the fields: (`idempotencyKey`)"));
    const findUnique = vi.fn(async () => ({ id: "job_1" }));
    mockGetPrisma.mockReturnValue({
      repository: { findUnique: repoFind() },
      scanJob: { create, findUnique },
    });

    const first = await enqueueScanJob({ orgSlug: "acme", repoFullName: "acme/api", lane: "probe", reason: "webhook:repository", bucket: "d-9" });
    const second = await enqueueScanJob({ orgSlug: "acme", repoFullName: "acme/api", lane: "probe", reason: "webhook:repository", bucket: "d-9" });

    expect(first).toEqual({ id: "job_1", created: true });
    // Same id, created:false — the caller learns the work is already owed and enqueues nothing new.
    expect(second).toEqual({ id: "job_1", created: false });
    expect(create).toHaveBeenCalledTimes(2);
  });

  it("defaults the bucket to the ISO DATE of notBefore, so two cadence seeds in one day collapse", async () => {
    const create = vi.fn(async () => ({ id: "job_2" }));
    mockGetPrisma.mockReturnValue({ repository: { findUnique: repoFind() }, scanJob: { create, findUnique: vi.fn() } });
    await enqueueScanJob({
      orgSlug: "acme",
      repoFullName: "acme/api",
      lane: "rescore",
      reason: "cadence",
      notBefore: new Date("2026-08-30T06:00:00.000Z"),
    });
    expect(create.mock.calls[0]![0].data.idempotencyKey).toBe("org_1|acme/api|rescore|2026-08-30");
  });
});

describe("claimJobById — the cross-instance CAS that replaced the process-local Map", () => {
  function prismaWith(updateCount: number, peers: { id: string; claimedAt: Date | null }[] = []) {
    const claimedAt = new Date("2026-08-30T10:00:00.000Z");
    const update = vi.fn(async () => ({}));
    return {
      update,
      prisma: {
        scanJob: {
          updateMany: vi.fn(async () => ({ count: updateCount })),
          findUnique: vi.fn(async () => ({
            id: "job_1",
            orgId: "org_1",
            repoId: "repo_1",
            repoFullName: "acme/api",
            lane: "rescore",
            reason: "manual",
            state: "claimed",
            priority: 10,
            runId: "run_1",
            idempotencyKey: "k",
            notBefore: claimedAt,
            claimedAt,
            claimedBy: "w1",
            leaseUntil: claimedAt,
            attempts: 1,
            creditCharged: false,
            resultJson: null,
            error: null,
            createdAt: claimedAt,
            updatedAt: claimedAt,
            settledAt: null,
          })),
          findMany: vi.fn(async () => peers),
          update,
        },
      },
    };
  }

  it("wins only when the conditional update matched EXACTLY one queued row", async () => {
    const a = prismaWith(1);
    mockGetPrisma.mockReturnValue(a.prisma);
    const won = await claimJobById("job_1", "w1");
    expect(won?.id).toBe("job_1");
    // Timestamps cross to a client as ISO strings, never Date (AGENTS.md wire-safe rule).
    expect(typeof won?.claimedAt).toBe("string");

    const b = prismaWith(0);
    mockGetPrisma.mockReturnValue(b.prisma);
    expect(await claimJobById("job_1", "w2")).toBeNull();
  });

  it("yields to an OLDER live claim on the same repo, and re-queues its own row (work still owed)", async () => {
    const older = [{ id: "job_0", claimedAt: new Date("2026-08-30T09:59:00.000Z") }];
    const p = prismaWith(1, older);
    mockGetPrisma.mockReturnValue(p.prisma);

    expect(await claimJobById("job_1", "w2")).toBeNull();
    expect(p.update).toHaveBeenCalledTimes(1);
    expect(p.update.mock.calls[0]![0].data.state).toBe("queued");
  });

  it("keeps the claim when the only live peer claim is YOUNGER (the first writer always wins)", async () => {
    const younger = [{ id: "job_2", claimedAt: new Date("2026-08-30T10:00:30.000Z") }];
    const p = prismaWith(1, younger);
    mockGetPrisma.mockReturnValue(p.prisma);
    expect((await claimJobById("job_1", "w1"))?.id).toBe("job_1");
  });
});

describe("lease reaping", () => {
  it("re-queues an expired lease while attempts remain, and FAILS it once they are exhausted", async () => {
    const updateMany = vi.fn().mockResolvedValueOnce({ count: 2 }).mockResolvedValueOnce({ count: 1 });
    mockGetPrisma.mockReturnValue({ scanJob: { updateMany } });

    expect(await reapExpiredLeases()).toBe(3);

    const requeue = updateMany.mock.calls[0]![0];
    expect(requeue.where.attempts).toEqual({ lt: MAX_JOB_ATTEMPTS });
    expect(requeue.data.state).toBe("queued");
    const giveUp = updateMany.mock.calls[1]![0];
    expect(giveUp.where.attempts).toEqual({ gte: MAX_JOB_ATTEMPTS });
    // Settled, not re-queued: nothing retries forever.
    expect(giveUp.data.state).toBe("failed");
  });
});

describe("settleJob honest nulls", () => {
  it("writes resultJson only when there IS a result — never '{}' for a job that produced nothing", async () => {
    const update = vi.fn(async () => ({}));
    mockGetPrisma.mockReturnValue({ scanJob: { update } });

    await settleJob("job_1", { state: "skipped" });
    expect(update.mock.calls[0]![0].data.resultJson).toBeNull();

    await settleJob("job_1", { state: "done", result: { observed: 3 } });
    expect(update.mock.calls[1]![0].data.resultJson).toBe('{"observed":3}');
  });

  it("clears creditCharged ONLY on an explicit refund — a kept credit stays recorded on the row", async () => {
    const update = vi.fn(async () => ({}));
    mockGetPrisma.mockReturnValue({ scanJob: { update } });

    await settleJob("job_1", { state: "failed", error: "boom" });
    expect(update.mock.calls[0]![0].data).not.toHaveProperty("creditCharged");

    await settleJob("job_1", { state: "failed", error: "boom", creditRefunded: true });
    expect(update.mock.calls[1]![0].data.creditCharged).toBe(false);
  });
});

describe("queueDepth honest nulls", () => {
  it("reports oldestAgeMs as NULL for an empty lane, never 0", async () => {
    mockGetPrisma.mockReturnValue({
      scanJob: { count: vi.fn(async () => 0), findFirst: vi.fn(async () => null) },
    });
    const depth = await queueDepth();
    expect(depth.rescore).toEqual({ queued: 0, oldestAgeMs: null });
    expect(depth.probe).toEqual({ queued: 0, oldestAgeMs: null });
  });
});
