// EVERY POST-CLAIM WRITE IS FENCED TO THE CLAIM GENERATION THAT AUTHORIZED IT.
//
// Holder identity is no substitute for a fence: a token whose lease lapsed, was swept and was claimed
// again by its own second session looks exactly like the stale holder. These cases run against a fake
// Prisma whose `updateMany` really is a compare-and-set, the same shape `followup-claims.test.ts` uses.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface Row {
  id: string;
  status: string;
  claimActor: string | null;
  claimExecutor: string | null;
  leaseUntil: Date | null;
  needsHuman: boolean;
  orgId: string;
}

let rows: Row[] = [];
let events: { recommendationId: string; kind: string; toValue: string | null }[] = [];
let audits: { action: string; meta: Record<string, unknown> }[] = [];

const row = (over: Partial<Row> = {}): Row => ({
  id: "rec-1",
  status: "open",
  claimActor: null,
  claimExecutor: null,
  leaseUntil: null,
  needsHuman: false,
  orgId: "org-acme",
  ...over,
});

function matches(r: Row, where: Record<string, unknown>): boolean {
  if (typeof where.id === "string" && r.id !== where.id) return false;
  const idIn = (where.id as { in?: string[] } | undefined)?.in;
  if (Array.isArray(idIn) && !idIn.includes(r.id)) return false;
  if (typeof where.status === "string" && r.status !== where.status) return false;
  if ("claimActor" in where) {
    const want = where.claimActor as string | null | { in?: string[] };
    if (want && typeof want === "object") {
      if (!Array.isArray(want.in) || r.claimActor === null || !want.in.includes(r.claimActor)) return false;
    } else if (r.claimActor !== want) return false;
  }
  if ("leaseUntil" in where) {
    const l = where.leaseUntil as Date | null | { not?: null; lt?: Date };
    if (l === null) {
      if (r.leaseUntil !== null) return false;
    } else if (l instanceof Date) {
      if (r.leaseUntil?.getTime() !== l.getTime()) return false;
    } else if (l && typeof l === "object") {
      if ("not" in l && l.not === null && r.leaseUntil === null) return false;
      if (l.lt && !(r.leaseUntil && r.leaseUntil < l.lt)) return false;
    }
  }
  if (Array.isArray(where.OR) && !(where.OR as Record<string, unknown>[]).some((c) => matches(r, c))) return false;
  const scan = where.scan as { repo?: { orgId?: string } } | undefined;
  if (scan?.repo?.orgId && r.orgId !== scan.repo.orgId) return false;
  return true;
}

const project = (r: Row) => ({ ...r, title: "t", scan: { repo: { fullName: "acme/api" } } });
const recommendation = {
  findMany: async ({ where }: { where: Record<string, unknown> }) => rows.filter((r) => matches(r, where)).map(project),
  findFirst: async ({ where }: { where: Record<string, unknown> }) => {
    const hit = rows.find((r) => matches(r, where));
    return hit ? project(hit) : null;
  },
  findUnique: async ({ where }: { where: { id: string } }) => {
    const hit = rows.find((r) => r.id === where.id);
    return hit ? project(hit) : null;
  },
  updateMany: async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
    const hits = rows.filter((r) => matches(r, where));
    for (const r of hits) Object.assign(r, data);
    return { count: hits.length };
  },
};
const recommendationEvent = {
  create: async ({ data }: { data: (typeof events)[number] }) => {
    events.push(data);
    return data;
  },
};

vi.mock("@/lib/db/org-shared", () => ({ getOrgBySlug: vi.fn(async (s: string) => (s === "acme" ? { id: "org-acme" } : null)) }));
vi.mock("@/lib/db/scans-audit", () => ({
  recordAudit: vi.fn(async (action: string, meta: Record<string, unknown>) => {
    audits.push({ action, meta });
    return true;
  }),
}));
vi.mock("@/lib/db/client", () => ({
  isDbConfigured: () => true,
  getPrisma: () => ({
    recommendation,
    recommendationEvent,
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => fn({ recommendation, recommendationEvent }),
  }),
}));

const { claimFollowups, heldFollowups, reportAttempt, sweepExpiredLeases } = await import("@/lib/db/followup-claims");

const LEASE = 45 * 60_000;
const agentClaim = (actor = "agent:tok_A") =>
  claimFollowups({ org: "acme", ids: ["rec-1"], actor, executor: "remote-agent", leaseMs: LEASE, note: "n" });

beforeEach(() => {
  rows = [row()];
  events = [];
  audits = [];
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("the claim mints a fence", () => {
  it("a leased claim's fence is its leaseUntil ISO; an unleased human claim's fence is null", async () => {
    const res = await agentClaim();
    const c = res!.claimed[0]!;
    expect(c.fence).toBe(c.leaseUntil);
    expect(c.fence).toBe(rows[0]!.leaseUntil!.toISOString());

    rows = [row()];
    const human = await claimFollowups({ org: "acme", ids: ["rec-1"], actor: "alice", executor: "human", leaseMs: null, note: "n" });
    expect(human!.claimed[0]!.fence).toBeNull();
  });

  it("guard: a human claim survives every sweep and its fence stays null", async () => {
    await claimFollowups({ org: "acme", ids: ["rec-1"], actor: "alice", executor: "human", leaseMs: null, note: "n" });
    expect(await sweepExpiredLeases("acme", new Date(Date.now() + 365 * 86_400_000))).toBe(0);
    expect((await heldFollowups("acme", ["rec-1"], "alice"))[0]!.fence).toBeNull();
  });

  it("a new generation carries none of the previous one's flags: needsHuman resets on claim", async () => {
    rows = [row({ needsHuman: true })];
    const res = await agentClaim();
    expect(res!.claimed[0]!.needsHuman).toBe(false);
    expect(rows[0]!.needsHuman).toBe(false);
  });
});

describe("reportAttempt is fenced to the claim generation", () => {
  /** Claim, let the lease lapse, sweep, claim again as the SAME token: two generations, one holder. */
  async function twoGenerations(): Promise<{ F1: string; F2: string }> {
    vi.useFakeTimers({ toFake: ["Date"] });
    const F1 = (await agentClaim())!.claimed[0]!.fence!;
    // The first session pauses past its lease: the clock moves, the lease really lapses.
    vi.setSystemTime(Date.now() + LEASE + 60_000);
    expect(await sweepExpiredLeases("acme")).toBe(1);
    const F2 = (await agentClaim())!.claimed[0]!.fence!;
    expect(F2).not.toBe(F1);
    events = [];
    audits = [];
    return { F1, F2 };
  }

  it("a stale fence from the superseded session is refused and nothing is written", async () => {
    const { F1, F2 } = await twoGenerations();
    const res = await reportAttempt({ org: "acme", id: "rec-1", actor: "agent:tok_A", fence: F1, verdict: "resolved", reason: "r" });
    expect(res).toMatchObject({ refused: "stale-claim", leaseUntil: F2 });
    expect(rows[0]).toMatchObject({ status: "in_progress", claimActor: "agent:tok_A" });
    expect(rows[0]!.leaseUntil!.toISOString()).toBe(F2);
    expect(events.filter((e) => e.kind === "attempt")).toEqual([]);
    expect(audits.filter((a) => a.action === "followup.attempt")).toEqual([]);
  });

  it("the current fence is accepted and clears the lease", async () => {
    const { F2 } = await twoGenerations();
    const res = await reportAttempt({ org: "acme", id: "rec-1", actor: "agent:tok_A", fence: F2, verdict: "resolved", reason: "r" });
    expect(res).toMatchObject({ id: "rec-1", leaseUntil: null });
    expect(rows[0]!.leaseUntil).toBeNull();
    expect(events.at(-1)).toMatchObject({ kind: "attempt", toValue: "resolved" });
    expect(audits.map((a) => a.action)).toEqual(["followup.attempt"]);
  });

  it("an UNFENCED report on a leased row by its holder is still accepted, with a deprecation logged once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await agentClaim("agent:tok_legacy_client");
    const res = await reportAttempt({ org: "acme", id: "rec-1", actor: "agent:tok_legacy_client", verdict: "needs_human", reason: "r" });
    expect(res).toMatchObject({ id: "rec-1", needsHuman: true });
    rows = [row()];
    await agentClaim("agent:tok_legacy_client");
    await reportAttempt({ org: "acme", id: "rec-1", actor: "agent:tok_legacy_client", verdict: "skipped", reason: "r" });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]![0])).toContain("fence");
  });

  it("guard: a holder that is not this actor is still answered null, fence or not", async () => {
    const F = (await agentClaim())!.claimed[0]!.fence;
    expect(await reportAttempt({ org: "acme", id: "rec-1", actor: "agent:tok_B", fence: F, verdict: "resolved", reason: "r" })).toBeNull();
  });
});
