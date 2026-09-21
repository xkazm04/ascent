// ADR-0001 T2 — the ledger side of the per-org hosted ceiling, against an in-memory Prisma double.
//
// The pure decision is pinned in hosted-ceiling.test.ts; this file pins what only IO can get wrong:
// the debit is ONE atomic movement for the whole run with a ledger row stamping the post-debit
// balance, month-to-date spend is counted per ORG from its hosted-worker lanes only, and a refund is
// idempotent on the reservation.

import { beforeEach, describe, expect, it, vi } from "vitest";

interface Org { id: string; slug: string; plan: string; scanCredits: number }
interface Run { id: string; orgId: string; createdAt: Date }
interface Lane { runId: string; executor: string }

// Hoisted: `vi.mock` factories run before module-level code, so the fixture they close over must too.
const { env, grantCredits, state, prisma } = vi.hoisted(() => {
  const env = { selfHosted: false, dbConfigured: true };
  const grantCredits = vi.fn(async (..._args: unknown[]) => 0);
  const state = { orgs: [] as Org[], runs: [] as Run[], lanes: [] as Lane[], ledger: [] as Record<string, unknown>[] };
  const prisma = {
    organization: {
      findUnique: vi.fn(async ({ where }: { where: { slug?: string; id?: string } }) => state.orgs.find((o) => o.slug === where.slug || o.id === where.id) ?? null),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => state.orgs.find((o) => o.id === where.id)!),
      updateMany: vi.fn(async ({ where, data }: { where: { id: string; scanCredits: { gte: number } }; data: { scanCredits: { decrement: number } } }) => {
        const org = state.orgs.find((o) => o.id === where.id && o.scanCredits >= where.scanCredits.gte);
        if (!org) return { count: 0 };
        org.scanCredits -= data.scanCredits.decrement;
        return { count: 1 };
      }),
    },
    loopRun: {
      findMany: vi.fn(async ({ where }: { where: { orgId: string; createdAt: { gte: Date } } }) =>
        state.runs.filter((r) => r.orgId === where.orgId && r.createdAt >= where.createdAt.gte),
      ),
    },
    loopRunLane: {
      count: vi.fn(async ({ where }: { where: { runId: { in: string[] }; executor: string } }) =>
        state.lanes.filter((l) => where.runId.in.includes(l.runId) && l.executor === where.executor).length,
      ),
    },
    creditLedger: {
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => void state.ledger.push(data)),
      findUnique: vi.fn(async () => null),
    },
    $transaction: async (fn: (tx: unknown) => unknown) => fn(prisma),
  };
  return { env, grantCredits, state, prisma };
});

vi.mock("@/lib/env", () => ({ selfHosted: () => env.selfHosted }));
vi.mock("@/lib/db/credits", () => ({ CREDIT_REASON: { REFUND: "refund", HOSTED_RUN: "hosted-run" }, grantCredits }));
vi.mock("@/lib/db/client", () => ({
  getPrisma: () => prisma,
  isDbConfigured: () => env.dbConfigured,
  isP2002Error: () => false,
  withRetry: <T>(fn: () => Promise<T>) => fn(),
}));

import { readHostedCeilingState, refundHostedReservation, reserveHostedRunCredits } from "./hosted-credits";
import { HOSTED_LANE_CREDITS as L, HOSTED_MONTHLY_CEILING_CREDITS } from "@/lib/local/hosted-ceiling";

const NOW = new Date("2026-09-14T12:00:00Z");
const TEAM_CEILING = HOSTED_MONTHLY_CEILING_CREDITS.team;

/** Give `orgId` `n` hosted-worker lanes on one run created at `at`. */
function spend(orgId: string, n: number, at = NOW, executor = "hosted-worker") {
  const id = `run-${state.runs.length}`;
  state.runs.push({ id, orgId, createdAt: at });
  for (let i = 0; i < n; i++) state.lanes.push({ runId: id, executor });
}

beforeEach(() => {
  env.selfHosted = false;
  env.dbConfigured = true;
  state.orgs = [
    { id: "o-acme", slug: "acme", plan: "team", scanCredits: 100 },
    { id: "o-big", slug: "big", plan: "enterprise", scanCredits: 0 },
    { id: "o-other", slug: "other", plan: "team", scanCredits: 100 },
  ];
  state.runs = [];
  state.lanes = [];
  state.ledger = [];
  grantCredits.mockClear();
});

describe("reserveHostedRunCredits", () => {
  it("debits the whole run at once and stamps the post-debit balance on one ledger row", async () => {
    const r = await reserveHostedRunCredits({ orgSlug: "ACME", lanes: 3, actor: "kazimi66", now: NOW });
    expect(r).toMatchObject({ ok: true, charged: 3 * L });
    expect(state.orgs[0]!.scanCredits).toBe(100 - 3 * L);
    expect(state.ledger).toEqual([
      expect.objectContaining({ orgId: "o-acme", delta: -3 * L, balanceAfter: 100 - 3 * L, reason: "hosted-run", actor: "kazimi66" }),
    ]);
    expect(state.ledger[0]!.externalId).toBe(`hosted:${(r as { reservationId: string }).reservationId}`);
  });

  it("refuses a balance short of the run and moves nothing", async () => {
    state.orgs[0]!.scanCredits = 3 * L - 1;
    expect(await reserveHostedRunCredits({ orgSlug: "acme", lanes: 3, now: NOW })).toEqual({ ok: false, block: "no-credit" });
    expect(state.orgs[0]!.scanCredits).toBe(3 * L - 1);
    expect(state.ledger).toHaveLength(0);
  });

  it("refuses a run that would cross the org's monthly ceiling, counted from its hosted lanes", async () => {
    spend("o-acme", TEAM_CEILING / L - 1);
    expect(await reserveHostedRunCredits({ orgSlug: "acme", lanes: 2, now: NOW })).toEqual({ ok: false, block: "over-ceiling" });
    expect(state.ledger).toHaveLength(0);
  });

  // PER ORG: another org's spend, remote-agent lanes and last month's lanes are not this org's month.
  it("counts only this org's hosted-worker lanes from this UTC month", async () => {
    spend("o-other", TEAM_CEILING / L);
    spend("o-acme", TEAM_CEILING / L, NOW, "remote-agent");
    spend("o-acme", TEAM_CEILING / L, new Date("2026-08-31T23:59:59Z"));
    expect(await reserveHostedRunCredits({ orgSlug: "acme", lanes: 1, now: NOW })).toMatchObject({ ok: true, charged: L });
  });

  it("never debits an unlimited plan, but still holds it to its ceiling", async () => {
    expect(await reserveHostedRunCredits({ orgSlug: "big", lanes: 1, now: NOW })).toMatchObject({ ok: true, charged: 0 });
    expect(state.ledger).toHaveLength(0);
    spend("o-big", HOSTED_MONTHLY_CEILING_CREDITS.enterprise / L);
    expect(await reserveHostedRunCredits({ orgSlug: "big", lanes: 1, now: NOW })).toEqual({ ok: false, block: "over-ceiling" });
  });

  it("refuses an unknown org as unknown, not as a paywall", async () => {
    expect(await reserveHostedRunCredits({ orgSlug: "ghost", lanes: 1, now: NOW })).toEqual({ ok: false, block: "unknown-org" });
  });

  // The conditional decrement is the hard gate: a concurrent spend landing between the read and the
  // debit must refuse rather than drive the balance below the run's cost.
  it("refuses when the balance moved under the read and the conditional debit matches nothing", async () => {
    prisma.organization.updateMany.mockResolvedValueOnce({ count: 0 });
    expect(await reserveHostedRunCredits({ orgSlug: "acme", lanes: 1, now: NOW })).toEqual({ ok: false, block: "no-credit" });
    expect(state.ledger).toHaveLength(0);
  });
});

describe("readHostedCeilingState", () => {
  it("reports plan, balance, month-to-date spend and ceiling", async () => {
    spend("o-acme", 2);
    expect(await readHostedCeilingState("acme", NOW)).toEqual({
      orgExists: true, plan: "team", unlimited: false, balance: 100, spentThisMonth: 2 * L, ceiling: TEAM_CEILING,
    });
  });

  it("has no ceiling on a self-hosted deployment", async () => {
    env.selfHosted = true;
    expect(await readHostedCeilingState("acme", NOW)).toMatchObject({ ceiling: null, unlimited: true });
  });

  it("is null without a database", async () => {
    env.dbConfigured = false;
    expect(await readHostedCeilingState("acme", NOW)).toBeNull();
  });
});

describe("refundHostedReservation", () => {
  it("grants the charged credits back under an idempotency key derived from the reservation", async () => {
    await refundHostedReservation({ orgSlug: "acme", reservationId: "res-9", charged: 20 });
    expect(grantCredits).toHaveBeenCalledWith("acme", 20, expect.objectContaining({ reason: "refund", externalId: "hosted-refund:res-9" }));
  });

  it("does nothing for a reservation that charged nothing", async () => {
    await refundHostedReservation({ orgSlug: "big", reservationId: "res-0", charged: 0 });
    expect(grantCredits).not.toHaveBeenCalled();
  });
});
