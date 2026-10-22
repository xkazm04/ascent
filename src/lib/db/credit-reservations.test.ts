// The scan-credit reservation's ledger identity: debit key, refund key, and the "held" read derived
// from them. Plus the one interactive caller (scanCreditGate), whose at-most-once refund is now the
// ledger's unique key rather than a closure boolean, and two guards on what must NOT move: the
// reconciliation buckets and a keyless owner grant.

import { describe, it, expect, beforeEach, vi } from "vitest";

type Row = { externalId: string; delta: number; reason: string; createdAt: Date };
const h = vi.hoisted(() => ({
  state: { balance: 5, ledger: [] as { externalId: string; delta: number; reason: string; createdAt: Date }[] },
}));

function fakePrisma() {
  const s = h.state;
  const org = () => ({ id: "org_1", slug: "acme", plan: "free", scanCredits: s.balance });
  const p2002 = () => Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
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
        if (s.ledger.some((r) => r.externalId === data.externalId)) throw p2002();
        s.ledger.push({ externalId: data.externalId, delta: data.delta, reason: data.reason, createdAt: new Date() });
        return data;
      },
      findMany: async ({ where }: { where: { OR?: { externalId: { startsWith: string } }[] } }) =>
        where.OR ? s.ledger.filter((r) => where.OR!.some((c) => r.externalId.startsWith(c.externalId.startsWith))) : s.ledger,
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
vi.mock("@/lib/db", async () => {
  const c = await vi.importActual<typeof import("./credits")>("./credits");
  return { ...c, recordQuotaEvent: vi.fn(async () => {}) };
});
vi.mock("@/lib/scan-alerts", () => ({ maybeAlertLowCredits: vi.fn(async () => {}) }));
vi.mock("@/lib/entitlement", () => ({
  isMeteredScan: () => true,
  checkScanEntitlement: async () => ({ allowed: true, unlimited: false, balance: 5, orgExists: true }),
}));

import { heldScanReservation, readScanJobReservation, refundKeyFor, scanJobReservationKey } from "./credit-reservations";
import { getCreditReconciliation, grantCredits, CREDIT_REASON } from "./credits";
import { refundScanCredit, reserveScanCredit } from "@/lib/scan-credit";
import { scanCreditGate } from "@/lib/scan-gates";

beforeEach(() => {
  h.state.balance = 5;
  h.state.ledger = [];
});

describe("reservation keys", () => {
  it("a job's debit is scan-job:<jobId>:<attempt> and its refund names it", () => {
    expect(scanJobReservationKey("J", 2)).toBe("scan-job:J:2");
    expect(refundKeyFor("scan-job:J:2")).toBe("refund:scan-job:J:2");
  });

  it("held = the newest scan-job debit with no refund row", async () => {
    expect(await heldScanReservation("acme", "J")).toBeNull();
    expect(await readScanJobReservation("acme", "J")).toEqual({ held: null, keyed: false });

    await reserveScanCredit("acme", "acme/api", { reservationKey: "scan-job:J:1" });
    expect(await heldScanReservation("acme", "J")).toBe("scan-job:J:1");

    await refundScanCredit("acme", true, { reservationKey: "scan-job:J:1" });
    expect(await readScanJobReservation("acme", "J")).toEqual({ held: null, keyed: true });

    await reserveScanCredit("acme", "acme/api", { reservationKey: "scan-job:J:2" });
    expect(await heldScanReservation("acme", "J")).toBe("scan-job:J:2");
    // Another job's keys never leak into this one's answer.
    expect(await heldScanReservation("acme", "J2")).toBeNull();
  });

  it("re-reserving the same key debits once (P2002 rolls the second decrement back)", async () => {
    await reserveScanCredit("acme", "acme/api", { reservationKey: "scan-job:J:1" });
    const again = await reserveScanCredit("acme", "acme/api", { reservationKey: "scan-job:J:1" });
    expect(again.reserved).toBe(true);
    expect(h.state.ledger.filter((r) => r.delta < 0)).toHaveLength(1);
    expect(h.state.balance).toBe(4);
  });
});

describe("scanCreditGate: the hold's refund is keyed refund:scan-hold:<id>", () => {
  it("two refund calls for one reservation write ONE +1 row; the second is a no-op", async () => {
    const res = await scanCreditGate("acme", { mock: false, repoFullName: "acme/api" });
    if (!res.ok) throw new Error("gate refused");
    const debit = h.state.ledger.find((r) => r.delta < 0)!;
    expect(debit.externalId).toMatch(/^scan-hold:[0-9a-f-]{36}$/);

    await Promise.all([res.hold.refund(), res.hold.refund()]);
    await res.hold.refund();

    const refunds = h.state.ledger.filter((r) => r.delta > 0);
    expect(refunds).toEqual([expect.objectContaining({ externalId: `refund:${debit.externalId}`, reason: CREDIT_REASON.REFUND })]);
    expect(h.state.balance).toBe(5);
    expect(res.hold.remaining).toBe(5);
  });
});

describe("guards: what the keyed reservation must not move", () => {
  it("reconciliation still buckets a keyed refund as refunded", async () => {
    await reserveScanCredit("acme", "acme/api", { reservationKey: "scan-job:J:1" });
    await refundScanCredit("acme", true, { reservationKey: "scan-job:J:1" });
    const rec = await getCreditReconciliation("acme", { since: new Date(0), before: new Date(Date.now() + 60_000) });
    expect(rec).toMatchObject({ debited: 1, refunded: 1, granted: 0, net: 0 });
  });

  it("an owner grant with no externalId still gets an auto:<uuid> key, and two both land", async () => {
    await grantCredits("acme", 3, { reason: CREDIT_REASON.GRANT, actor: "owner" });
    await grantCredits("acme", 3, { reason: CREDIT_REASON.GRANT, actor: "owner" });
    const grants = h.state.ledger.filter((r) => r.reason === CREDIT_REASON.GRANT);
    expect(grants).toHaveLength(2);
    expect(grants.every((g) => /^auto:[0-9a-f-]{36}$/.test(g.externalId))).toBe(true);
    expect(h.state.balance).toBe(11);
  });
});
