// THE ONE CLAIM PATH (moonshot #3), against a fake Prisma whose `updateMany` really is a
// compare-and-set — which is the only way this suite can assert the property that matters.
//
// The race guard is the reason this file exists. Under the old unconditional
// `updateRecommendation(id, {status:"in_progress"})` two concurrent claimers BOTH succeeded and the
// second silently stole the row; here exactly one comes back `claimed` and the other is told `held`.
// The three lease rules are asserted beside it: a lapsed lease is swept, a null lease (a human took
// it from the browser) survives every sweep, and no verdict any worker can report reaches `done`.

import { beforeEach, describe, expect, it, vi } from "vitest";

interface Row {
  id: string;
  title: string;
  status: string;
  claimActor: string | null;
  claimExecutor: string | null;
  leaseUntil: Date | null;
  needsHuman: boolean;
  orgId: string;
  repoFullName: string;
}

let rows: Row[] = [];
let events: { recommendationId: string; kind: string; toValue: string | null; note: string | null }[] = [];
let audits: { action: string; meta: Record<string, unknown> }[] = [];

const row = (over: Partial<Row> = {}): Row => ({
  id: "rec-1",
  title: "No dependency review on pull requests",
  status: "open",
  claimActor: null,
  claimExecutor: null,
  leaseUntil: null,
  needsHuman: false,
  orgId: "org-acme",
  repoFullName: "acme/api",
  ...over,
});

/** The subset of a Prisma `where` this module actually writes, evaluated honestly. */
function matches(r: Row, where: Record<string, unknown>): boolean {
  if (typeof where.id === "string" && r.id !== where.id) return false;
  const idIn = (where.id as { in?: string[] } | undefined)?.in;
  if (Array.isArray(idIn) && !idIn.includes(r.id)) return false;
  if (typeof where.status === "string" && r.status !== where.status) return false;
  if ("claimActor" in where) {
    const want = where.claimActor as string | null | { in?: string[] };
    // The HOLDER CLAUSE is `{ in: [...] }` since the identity moved to the token id (a transitional
    // second form is accepted). Evaluated honestly here, because "who holds this row" is the property
    // this whole file exists to pin.
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
  if (Array.isArray(where.OR)) {
    const ok = (where.OR as Record<string, unknown>[]).some((clause) => matches(r, clause));
    if (!ok) return false;
  }
  const scan = where.scan as { repo?: { orgId?: string } } | undefined;
  if (scan?.repo?.orgId && r.orgId !== scan.repo.orgId) return false;
  return true;
}

const project = (r: Row) => ({
  id: r.id,
  title: r.title,
  status: r.status,
  claimActor: r.claimActor,
  claimExecutor: r.claimExecutor,
  leaseUntil: r.leaseUntil,
  needsHuman: r.needsHuman,
  scan: { repo: { fullName: r.repoFullName } },
});

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

vi.mock("@/lib/db/org-shared", () => ({
  getOrgBySlug: vi.fn(async (slug: string) => (slug === "acme" ? { id: "org-acme" } : null)),
}));
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
    recommendationEvent: {
      create: async ({ data }: { data: { recommendationId: string; kind: string; toValue: string | null; note: string | null } }) => {
        events.push(data);
        return data;
      },
    },
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({
        recommendation,
        recommendationEvent: {
          create: async ({ data }: { data: { recommendationId: string; kind: string; toValue: string | null; note: string | null } }) => {
            events.push(data);
            return data;
          },
        },
      }),
  }),
}));

const { claimFollowups, heldFollowups, releaseFollowups, reportAttempt, sweepExpiredLeases } = await import(
  "@/lib/db/followup-claims"
);

beforeEach(() => {
  rows = [row()];
  events = [];
  audits = [];
});

describe("claimFollowups — the race guard", () => {
  it("gives the row to EXACTLY ONE of two concurrent claimers; the other is told `held`", async () => {
    const [a, b] = await Promise.all([
      claimFollowups({ org: "acme", ids: ["rec-1"], actor: "agent:ci", executor: "remote-agent", leaseMs: 60_000, note: "n" }),
      claimFollowups({ org: "acme", ids: ["rec-1"], actor: "autopilot", executor: "local", leaseMs: 60_000, note: "n" }),
    ]);
    const claimed = [...a!.claimed, ...b!.claimed];
    const refused = [...a!.refused, ...b!.refused];
    expect(claimed).toHaveLength(1);
    expect(refused).toEqual([{ id: "rec-1", reason: "held" }]);
    // And the winner is the one on the row — never a last-write-wins overwrite.
    expect(rows[0]!.claimActor).toBe(claimed[0]!.claimActor);
  });

  it("stamps executor, actor and an ISO lease — never a Date on the wire", async () => {
    const res = await claimFollowups({
      org: "acme",
      ids: ["rec-1"],
      actor: "agent:ci",
      executor: "remote-agent",
      leaseMs: 45 * 60_000,
      note: "Claimed over MCP",
    });
    expect(res!.claimed[0]).toMatchObject({
      id: "rec-1",
      repo: "acme/api",
      claimActor: "agent:ci",
      claimExecutor: "remote-agent",
      needsHuman: false,
    });
    expect(typeof res!.claimed[0]!.leaseUntil).toBe("string");
    expect(rows[0]!.status).toBe("in_progress");
  });

  it("writes a timeline event and one audit row naming the executor and the token", async () => {
    await claimFollowups({
      org: "acme",
      ids: ["rec-1"],
      actor: "agent:ci",
      executor: "remote-agent",
      leaseMs: 60_000,
      note: "Claimed over MCP",
      tokenId: "tok_9",
    });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ kind: "status", toValue: "in_progress" });
    expect(events[0]!.note).toContain("remote-agent");
    expect(audits).toHaveLength(1);
    expect(audits[0]!.action).toBe("followup.claim");
    expect(audits[0]!.meta).toMatchObject({ executor: "remote-agent", tokenId: "tok_9", ids: ["rec-1"] });
  });

  it("answers an id from another tenant the same way it answers one that does not exist", async () => {
    rows.push(row({ id: "rec-other", orgId: "org-other" }));
    const res = await claimFollowups({
      org: "acme",
      ids: ["rec-other", "rec-nope"],
      actor: "agent:ci",
      executor: "remote-agent",
      leaseMs: 60_000,
      note: "n",
    });
    expect(res!.refused).toEqual([
      { id: "rec-other", reason: "unknown" },
      { id: "rec-nope", reason: "unknown" },
    ]);
  });

  it("refuses a closed row as `not-open`, distinct from `held`", async () => {
    rows = [row({ status: "done" })];
    const res = await claimFollowups({ org: "acme", ids: ["rec-1"], actor: "a", executor: "local", leaseMs: null, note: "n" });
    expect(res!.refused).toEqual([{ id: "rec-1", reason: "not-open" }]);
  });

  it("takes over a row whose lease has already lapsed", async () => {
    rows = [row({ status: "in_progress", claimActor: "agent:dead", claimExecutor: "remote-agent", leaseUntil: new Date(Date.now() - 60_000) })];
    const res = await claimFollowups({ org: "acme", ids: ["rec-1"], actor: "agent:live", executor: "remote-agent", leaseMs: 60_000, note: "n" });
    expect(res!.claimed.map((c) => c.claimActor)).toEqual(["agent:live"]);
  });
});

describe("sweepExpiredLeases — lazy, and blind to unleased claims", () => {
  it("releases an in-progress row whose lease has passed, with an event saying so", async () => {
    rows = [row({ status: "in_progress", claimActor: "agent:dead", claimExecutor: "remote-agent", leaseUntil: new Date(Date.now() - 1) })];
    expect(await sweepExpiredLeases("acme")).toBe(1);
    expect(rows[0]).toMatchObject({ status: "open", claimActor: null, claimExecutor: null, leaseUntil: null });
    expect(events[0]!.note).toContain("Lease expired");
  });

  it("LEAVES A HUMAN HAND-OFF ALONE — a null lease is not an expired one", async () => {
    rows = [row({ status: "in_progress", claimActor: "octocat", claimExecutor: "human", leaseUntil: null })];
    expect(await sweepExpiredLeases("acme")).toBe(0);
    expect(rows[0]!.status).toBe("in_progress");
  });

  it("leaves a live lease alone", async () => {
    rows = [row({ status: "in_progress", claimActor: "agent:ci", leaseUntil: new Date(Date.now() + 60_000) })];
    expect(await sweepExpiredLeases("acme")).toBe(0);
  });
});

describe("reportAttempt — nothing here can close a row", () => {
  const claim = async () =>
    claimFollowups({ org: "acme", ids: ["rec-1"], actor: "agent:ci", executor: "remote-agent", leaseMs: 60_000, note: "n" });

  it("NEVER produces status `done`, for any verdict", async () => {
    for (const verdict of ["resolved", "skipped", "needs_human"] as const) {
      rows = [row()];
      events = [];
      await claim();
      const after = await reportAttempt({ org: "acme", id: "rec-1", actor: "agent:ci", verdict, reason: "r" });
      expect(after).not.toBeNull();
      expect(rows[0]!.status).not.toBe("done");
    }
  });

  it("`resolved` leaves the row in progress with the lease cleared — the rescan owns it now", async () => {
    await claim();
    await reportAttempt({ org: "acme", id: "rec-1", actor: "agent:ci", verdict: "resolved", reason: "Added the workflow", branch: "ascent/fix" });
    expect(rows[0]).toMatchObject({ status: "in_progress", leaseUntil: null, needsHuman: false });
    expect(events.at(-1)).toMatchObject({ kind: "attempt", toValue: "resolved" });
    expect(events.at(-1)!.note).toContain("branch ascent/fix");
  });

  it("`skipped` returns the row to the queue, unclaimed", async () => {
    await claim();
    await reportAttempt({ org: "acme", id: "rec-1", actor: "agent:ci", verdict: "skipped", reason: "Already covered" });
    expect(rows[0]).toMatchObject({ status: "open", claimActor: null, claimExecutor: null, leaseUntil: null });
  });

  it("`needs_human` escalates without closing: still in progress, flagged, unleased", async () => {
    await claim();
    await reportAttempt({ org: "acme", id: "rec-1", actor: "agent:ci", verdict: "needs_human", reason: "Needs a product call" });
    expect(rows[0]).toMatchObject({ status: "in_progress", needsHuman: true, leaseUntil: null });
  });

  it("refuses a row this actor does not hold", async () => {
    await claim();
    expect(await reportAttempt({ org: "acme", id: "rec-1", actor: "agent:other", verdict: "resolved", reason: "r" })).toBeNull();
  });

  it("audits every accepted attempt", async () => {
    await claim();
    audits = [];
    await reportAttempt({ org: "acme", id: "rec-1", actor: "agent:ci", verdict: "resolved", reason: "r", tokenId: "tok_9" });
    expect(audits[0]).toMatchObject({ action: "followup.attempt" });
    expect(audits[0]!.meta).toMatchObject({ verdict: "resolved", tokenId: "tok_9" });
  });
});

describe("releaseFollowups / heldFollowups", () => {
  it("releases only what this actor still holds", async () => {
    rows = [
      row({ id: "mine", status: "in_progress", claimActor: "autopilot" }),
      row({ id: "theirs", status: "in_progress", claimActor: "agent:ci" }),
    ];
    expect(await releaseFollowups(["mine", "theirs"], "cycle failed", "autopilot")).toBe(1);
    expect(rows.find((r) => r.id === "mine")!.status).toBe("open");
    expect(rows.find((r) => r.id === "theirs")!.status).toBe("in_progress");
  });

  it("returns only the rows this actor holds, so a lost row is visible by its absence", async () => {
    rows = [
      row({ id: "mine", status: "in_progress", claimActor: "agent:ci" }),
      row({ id: "theirs", status: "in_progress", claimActor: "agent:other" }),
    ];
    const held = await heldFollowups("acme", ["mine", "theirs"], "agent:ci");
    expect(held.map((h) => h.id)).toEqual(["mine"]);
  });
});

// TWO TOKENS, ONE NAME — the reason the holder identity is the token ID (Direction 1).
//
// `createOrgApiToken` enforces no uniqueness on a token's name, so an org can hold two live tokens
// both called `ci`. Under the old `agent:<name>` holder they were literally the same worker: token B
// could read token A's brief and file token A's report, and neither the ledger nor the audit trail
// could tell them apart. Keyed on the id they cannot, and these are the two calls that would have let
// it happen.
describe("holder identity is the token id, not the token name", () => {
  const A = "agent:tok_a";
  const B = "agent:tok_b";

  beforeEach(() => {
    rows = [row({ id: "rec-1", status: "in_progress", claimActor: A, leaseUntil: new Date(Date.now() + 600_000) })];
  });

  it("token B cannot read a brief for a row token A holds, though both tokens are named `ci`", async () => {
    // The legacy arm is passed on BOTH calls: it is the transitional form, and it must not become a
    // back door to another token's rows just because the two share a name.
    expect((await heldFollowups("acme", ["rec-1"], B, "agent:ci")).map((h) => h.id)).toEqual([]);
    expect((await heldFollowups("acme", ["rec-1"], A, "agent:ci")).map((h) => h.id)).toEqual(["rec-1"]);
  });

  it("token B cannot report an attempt on a row token A holds", async () => {
    expect(
      await reportAttempt({ org: "acme", id: "rec-1", actor: B, legacyActor: "agent:ci", verdict: "resolved", reason: "not mine" }),
    ).toBeNull();
    expect(rows[0]!.claimActor).toBe(A);
    expect(
      await reportAttempt({ org: "acme", id: "rec-1", actor: A, legacyActor: "agent:ci", verdict: "skipped", reason: "mine" }),
    ).not.toBeNull();
    expect(rows[0]!.status).toBe("open");
  });

  it("accepts the TRANSITIONAL name form for a row claimed before the change", async () => {
    rows = [row({ id: "rec-1", status: "in_progress", claimActor: "agent:ci", leaseUntil: new Date(Date.now() + 600_000) })];
    expect((await heldFollowups("acme", ["rec-1"], A, "agent:ci")).map((h) => h.id)).toEqual(["rec-1"]);
    // …and only for a caller that actually carries that name: a token named `deploy` sees nothing.
    expect((await heldFollowups("acme", ["rec-1"], B, "agent:deploy")).map((h) => h.id)).toEqual([]);
  });
});
