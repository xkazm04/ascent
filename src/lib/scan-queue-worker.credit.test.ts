// A queued rescore's credit reservation is a KEYED LEDGER OBJECT (debit `scan-job:<jobId>:<attempt>`,
// refund `refund:<debitKey>`), and "does this job hold a credit" is read from the ledger, not from the
// best-effort `creditCharged` flag. Each case is a money defect the flag-only version had:
//
//   1. KILL BETWEEN RESERVE AND MARK - the debit committed, markJobCredit never ran, the reaped row says
//      `false`; the retry reserved a second credit for one scan.
//   2. REFUND COMMITTED, SETTLE LOST - the row still says `true`; the retry carried a credit that was
//      already returned and refunded it AGAIN on a fresh key: +2 for one -1.
//   3. REFUNDED KEY, REAL RETRY - the retry of a refunded attempt runs real inference and must be
//      charged once (the stated policy), not served free on the refunded key.
//   4. LOST REFUND - the grant throws; the worker still said `creditRefunded: true`, settleJob cleared
//      the flag, and the held credit vanished without a trace.
//
// Real scan-credit, real credits.ts, real credit-reservations.ts over an in-memory ledger; only the
// queue rows, the scanner and the persist door are doubles.

import { describe, it, expect, beforeEach, vi } from "vitest";

type Row = { externalId: string; delta: number; reason: string };
const h = vi.hoisted(() => ({
  state: { balance: 5, ledger: [] as { externalId: string; delta: number; reason: string }[], failRefunds: false },
  scanRepository: vi.fn(),
  claimJob: vi.fn(),
  settleJob: vi.fn(),
  markJobCredit: vi.fn(),
  persistScanReport: vi.fn(),
}));

/** The ledger double: one org, a unique externalId (P2002), and a transaction that rolls back on throw. */
function fakePrisma() {
  const s = h.state;
  const org = () => ({ id: "org_1", slug: "acme", plan: "free", scanCredits: s.balance });
  const p2002 = () => Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
  const prefix = (w: { startsWith?: string } | undefined) => w?.startsWith ?? "\u0000";
  const tx = {
    organization: {
      findUnique: async () => org(),
      findUniqueOrThrow: async () => org(),
      updateMany: async () => (s.balance > 0 ? ((s.balance -= 1), { count: 1 }) : { count: 0 }),
      update: async ({ data }: { data: { scanCredits: { increment: number } } }) => {
        s.balance += data.scanCredits.increment;
        return org();
      },
    },
    creditLedger: {
      findUnique: async ({ where }: { where: { externalId: string } }) =>
        s.ledger.find((r) => r.externalId === where.externalId) ?? null,
      create: async ({ data }: { data: Row }) => {
        if (s.failRefunds && data.delta > 0) throw new Error("connection reset");
        if (s.ledger.some((r) => r.externalId === data.externalId)) throw p2002();
        s.ledger.push({ externalId: data.externalId, delta: data.delta, reason: data.reason });
        return data;
      },
      findMany: async ({ where }: { where: { OR: { externalId: { startsWith: string } }[] } }) =>
        s.ledger.filter((r) => where.OR.some((c) => r.externalId.startsWith(prefix(c.externalId)))),
    },
  };
  return {
    ...tx,
    scan: { count: async () => 9999 },
    $transaction: async <T,>(fn: (t: typeof tx) => Promise<T>) => {
      const snap = { balance: s.balance, ledger: [...s.ledger] };
      try {
        return await fn(tx);
      } catch (err) {
        s.balance = snap.balance;
        s.ledger = snap.ledger;
        throw err;
      }
    },
  };
}

vi.mock("@/lib/db/client", () => ({
  isDbConfigured: () => true,
  getPrisma: () => fakePrisma(),
  withRetry: (fn: () => unknown) => fn(),
  isP2002Error: (e: unknown) => typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002",
}));
vi.mock("@/lib/db/org-rollup", () => ({ getOrgId: async () => "org_1" }));
vi.mock("@/lib/scan", () => ({ scanRepository: h.scanRepository }));
vi.mock("@/lib/db", async () => {
  const c = await vi.importActual<typeof import("./db/credits")>("./db/credits");
  return {
    consumeScanCredit: c.consumeScanCredit,
    grantCredits: c.grantCredits,
    CREDIT_REASON: c.CREDIT_REASON,
    advanceScheduleAfterFailure: vi.fn(async () => {}),
    advanceToFullCadence: vi.fn(async () => {}),
    getInstallationIdForOwner: vi.fn(async () => 1),
    getOrgId: vi.fn(async () => "org_1"),
    getScanReportByCommit: vi.fn(async () => null),
    isByomActive: vi.fn(async () => false),
    persistScanReport: h.persistScanReport,
    recordScanOutcome: vi.fn(async () => {}),
  };
});
vi.mock("@/lib/db/scan-jobs", () => ({
  claimJob: h.claimJob,
  claimJobById: vi.fn(),
  markJobCredit: h.markJobCredit,
  reapExpiredLeases: vi.fn(async () => 0),
  settleJob: h.settleJob,
}));
vi.mock("@/lib/db/org-watch", () => ({ getRepoSchedule: vi.fn(async () => "weekly") }));
vi.mock("@/lib/github/app", () => ({ getInstallationToken: vi.fn(async () => "tok") }));
vi.mock("@/lib/scan-alerts", () => ({ checkAndAlertRegression: vi.fn(async () => {}), maybeAlertLowCredits: vi.fn(async () => {}) }));
vi.mock("@/lib/db/practice-adoption", () => ({ reconcilePracticeAdoption: vi.fn(async () => {}) }));
vi.mock("@/lib/memory/scan-feed", () => ({ recordScanMemories: vi.fn(async () => {}) }));
vi.mock("@/lib/scan-probe", () => ({ probeRepository: vi.fn() }));

import { drainLane } from "./scan-queue-worker";
import { heldScanReservation } from "./db/credit-reservations";
import { refundScanCredit, reserveScanCredit } from "./scan-credit";

const job = (over: Record<string, unknown> = {}) => ({
  id: "J",
  orgId: "org_1",
  repoId: null,
  repoFullName: "acme/api",
  lane: "rescore",
  reason: "manual",
  state: "claimed",
  priority: 0,
  runId: null,
  idempotencyKey: "k",
  notBefore: "2026-10-22T00:00:00.000Z",
  claimedAt: "2026-10-22T00:00:00.000Z",
  claimedBy: "w",
  leaseUntil: "2026-10-22T00:15:00.000Z",
  attempts: 1,
  creditCharged: false,
  resultJson: null,
  error: null,
  createdAt: "2026-10-22T00:00:00.000Z",
  updatedAt: "2026-10-22T00:00:00.000Z",
  settledAt: null,
  ...over,
});
const report = (provider = "sonnet") => ({
  engine: { provider },
  level: { id: "managed" },
  overallScore: 71,
  posture: { id: "steady" },
  adoptionScore: 60,
  rigorScore: 80,
});

async function drain(row: ReturnType<typeof job>) {
  h.claimJob.mockResolvedValueOnce(row).mockResolvedValue(null);
  return drainLane("rescore", { concurrency: 1, deadlineAt: Date.now() + 600_000, orgSlug: "acme" });
}
const rows = (pred: (r: Row) => boolean) => h.state.ledger.filter(pred);
const settled = () => h.settleJob.mock.calls.at(-1)?.[1] as { creditRefunded?: boolean } | undefined;

beforeEach(() => {
  h.state.balance = 5;
  h.state.ledger = [];
  h.state.failRefunds = false;
  for (const fn of [h.scanRepository, h.claimJob, h.settleJob, h.markJobCredit, h.persistScanReport]) fn.mockReset();
  h.settleJob.mockResolvedValue(undefined);
  h.markJobCredit.mockResolvedValue(undefined);
  h.persistScanReport.mockResolvedValue({ deduped: false });
  h.scanRepository.mockResolvedValue(report());
});

describe("a queued rescore's credit is a keyed ledger object", () => {
  it("kill between reserve and markJobCredit: attempt 2 carries scan-job:J:1, no second debit", async () => {
    await reserveScanCredit("acme", "acme/api", { actor: "queue:manual", reservationKey: "scan-job:J:1" });
    expect(await heldScanReservation("acme", "J")).toBe("scan-job:J:1");

    await drain(job({ attempts: 2, creditCharged: false }));

    expect(rows((r) => r.delta < 0)).toEqual([expect.objectContaining({ externalId: "scan-job:J:1", delta: -1 })]);
    expect(h.state.balance).toBe(4);
  });

  it("refund committed, settle lost: the retry refunds refund:scan-job:J:1 exactly once and nets 0", async () => {
    h.persistScanReport.mockResolvedValue({ deduped: true });
    await drain(job({ attempts: 1 }));
    expect(rows((r) => r.externalId === "refund:scan-job:J:1")).toHaveLength(1);

    // settleJob's write was lost: the reaped row still says creditCharged:true.
    await drain(job({ attempts: 2, creditCharged: true }));

    expect(rows((r) => r.externalId === "refund:scan-job:J:1")).toHaveLength(1);
    expect(rows((r) => r.delta > 0).every((r) => rows((d) => `refund:${d.externalId}` === r.externalId).length === 1)).toBe(true);
    expect(h.state.ledger.reduce((n, r) => n + r.delta, 0)).toBe(0);
    expect(h.state.balance).toBe(5);
  });

  it("a retry of a refunded attempt that runs REAL inference is charged once, on scan-job:J:2", async () => {
    await reserveScanCredit("acme", "acme/api", { reservationKey: "scan-job:J:1" });
    await refundScanCredit("acme", true, { reservationKey: "scan-job:J:1" });
    expect(await heldScanReservation("acme", "J")).toBeNull();

    await drain(job({ attempts: 2, creditCharged: true }));

    expect(rows((r) => r.externalId === "scan-job:J:2")).toHaveLength(1);
    expect(h.state.balance).toBe(4);
    expect(settled()?.creditRefunded).toBe(false);
  });

  it("a refund that fails to land settles creditRefunded:false and the credit stays held", async () => {
    h.state.failRefunds = true;
    h.scanRepository.mockRejectedValueOnce(new Error("github 500"));

    await drain(job({ attempts: 1 }));

    expect(settled()?.creditRefunded).toBe(false);
    expect(await heldScanReservation("acme", "J")).toBe("scan-job:J:1");
    expect(h.state.balance).toBe(4);
  });
});
