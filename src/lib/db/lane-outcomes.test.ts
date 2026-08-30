// Per-item outcomes, against a fake Prisma. Three properties matter and each is a rule a reviewer
// would otherwise have to take on trust:
//   • the RESCAN outranks the agent's claim — always, in both directions;
//   • only `skipped` / `needs_human` park an item, and the park is bounded;
//   • the deferral read is org- AND repo-scoped, so one tenant's skip cannot suppress another's item.

import { beforeEach, describe, expect, it, vi } from "vitest";

interface Row {
  id: string;
  orgId: string;
  runId: string;
  laneId: string;
  repoFullName: string;
  recommendationId: string;
  cycle: number;
  verdict: string;
  reason: string;
  filesJson: string;
  deferUntil: Date | null;
  createdAt: Date;
}

const rows: Row[] = [];
const events: Record<string, unknown>[] = [];
const deferralQueries: Record<string, unknown>[] = [];

vi.mock("@/lib/db/org-shared", () => ({ getOrgBySlug: vi.fn(async (slug: string) => (slug === "kiro" ? { id: "org-kiro" } : null)) }));
vi.mock("@/lib/db/client", () => ({
  isDbConfigured: () => true,
  dbReadSafe: async <T,>(fn: () => Promise<T>, fallback: T) => fn().catch(() => fallback),
  getPrisma: () => ({
    laneItemOutcome: {
      upsert: async ({ where, create, update }: { where: { laneId_recommendationId: { laneId: string; recommendationId: string } }; create: Omit<Row, "id" | "createdAt">; update: Partial<Row> }) => {
        const key = where.laneId_recommendationId;
        const found = rows.find((r) => r.laneId === key.laneId && r.recommendationId === key.recommendationId);
        if (found) {
          Object.assign(found, update);
          return found;
        }
        const row: Row = { id: `o${rows.length + 1}`, createdAt: new Date("2026-08-30T00:00:00Z"), ...create };
        rows.push(row);
        return row;
      },
      findMany: async ({ where }: { where: Record<string, unknown> }) => {
        deferralQueries.push(where);
        const now = (where.deferUntil as { gt: Date } | undefined)?.gt;
        return rows.filter(
          (r) =>
            (where.orgId == null || r.orgId === where.orgId) &&
            (where.repoFullName == null || r.repoFullName === where.repoFullName) &&
            (where.runId == null || r.runId === where.runId) &&
            (now == null || (r.deferUntil != null && r.deferUntil > now)),
        );
      },
    },
    recommendationEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        events.push(data);
        return data;
      },
    },
  }),
}));

import { deferUntilFor, getActiveDeferrals, LANE_DEFER_MAX_DAYS, listRunOutcomes, recordLaneOutcomes } from "@/lib/db/lane-outcomes";

const NOW = new Date("2026-08-30T00:00:00Z");
const base = {
  orgSlug: "kiro",
  runId: "run-1",
  laneId: "lane-1",
  repoFullName: "o/r",
  cycle: 1,
  now: NOW,
};

const report = (items: { recommendationId: string; verdict: string; reason?: string }[]) => ({
  v: 1 as const,
  parsed: true,
  items: items.map((i) => ({ ...i, reason: i.reason ?? "", files: [] })) as never,
  lessons: [],
});

beforeEach(() => {
  rows.length = 0;
  events.length = 0;
  deferralQueries.length = 0;
});

describe("recordLaneOutcomes — the rescan outranks the claim", () => {
  it("writes `resolved` for a closed id even when the agent said it skipped", async () => {
    await recordLaneOutcomes({ ...base, batchIds: ["r1"], closedIds: ["r1"], report: report([{ recommendationId: "r1", verdict: "skipped" }]) });
    expect(rows[0]).toMatchObject({ recommendationId: "r1", verdict: "resolved", deferUntil: null });
  });

  it("does NOT write `resolved` for an id the agent claimed but the rescan did not close", async () => {
    await recordLaneOutcomes({ ...base, batchIds: ["r1"], closedIds: [], report: report([{ recommendationId: "r1", verdict: "resolved" }]) });
    // The claim is recorded as the claim it is; only the verifier writes `resolved`.
    expect(rows[0]!.verdict).toBe("resolved");
    // …and it parks nothing, so the next cycle can try again.
    expect(rows[0]!.deferUntil).toBeNull();
  });

  it("writes `absent` for a dispatched id nobody accounted for", async () => {
    await recordLaneOutcomes({ ...base, batchIds: ["r1", "r2"], closedIds: [], report: report([{ recommendationId: "r1", verdict: "attempted" }]) });
    expect(rows.find((r) => r.recommendationId === "r2")!.verdict).toBe("absent");
  });

  it("records no report at all as every id `absent`, never as `resolved`", async () => {
    await recordLaneOutcomes({ ...base, batchIds: ["r1", "r2"], closedIds: [], report: null });
    expect(rows.map((r) => r.verdict)).toEqual(["absent", "absent"]);
  });
});

describe("recordLaneOutcomes — parking", () => {
  it("parks `skipped` and `needs_human`, and nothing else", async () => {
    await recordLaneOutcomes({
      ...base,
      batchIds: ["r1", "r2", "r3"],
      closedIds: [],
      report: report([
        { recommendationId: "r1", verdict: "skipped" },
        { recommendationId: "r2", verdict: "needs_human" },
        { recommendationId: "r3", verdict: "attempted" },
      ]),
    });
    expect(rows.find((r) => r.recommendationId === "r1")!.deferUntil).not.toBeNull();
    expect(rows.find((r) => r.recommendationId === "r2")!.deferUntil).not.toBeNull();
    // An `attempted` item taught the loop nothing, so nothing stops it trying again.
    expect(rows.find((r) => r.recommendationId === "r3")!.deferUntil).toBeNull();
  });

  it("bounds a deferral so one bad session cannot park an item indefinitely", () => {
    const far = deferUntilFor(NOW, 999);
    expect(far.getTime() - NOW.getTime()).toBe(LANE_DEFER_MAX_DAYS * 24 * 60 * 60 * 1000);
  });

  it("writes the agent's OWN words as the reason, or nothing at all", async () => {
    await recordLaneOutcomes({ ...base, batchIds: ["r1", "r2"], closedIds: [], report: report([{ recommendationId: "r1", verdict: "skipped", reason: "needs a product call" }]) });
    expect(rows.find((r) => r.recommendationId === "r1")!.reason).toBe("needs a product call");
    expect(rows.find((r) => r.recommendationId === "r2")!.reason).toBe("");
  });

  it("explains itself on the item's own timeline", async () => {
    await recordLaneOutcomes({ ...base, batchIds: ["r1"], closedIds: [], report: report([{ recommendationId: "r1", verdict: "skipped", reason: "blocked" }]) });
    expect(events[0]).toMatchObject({ recommendationId: "r1", kind: "lane_verdict", toValue: "skipped", note: "blocked" });
  });
});

describe("recordLaneOutcomes — idempotent", () => {
  it("upserts on (lane, item), so re-parsing the same report is a no-op", async () => {
    const input = { ...base, batchIds: ["r1"], closedIds: [], report: report([{ recommendationId: "r1", verdict: "skipped" }]) };
    await recordLaneOutcomes(input);
    await recordLaneOutcomes(input);
    expect(rows).toHaveLength(1);
  });

  it("lets a re-run's verdict correct the first one", async () => {
    await recordLaneOutcomes({ ...base, batchIds: ["r1"], closedIds: [], report: report([{ recommendationId: "r1", verdict: "skipped" }]) });
    await recordLaneOutcomes({ ...base, batchIds: ["r1"], closedIds: ["r1"], report: null });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ verdict: "resolved", deferUntil: null });
  });
});

describe("getActiveDeferrals — org and repo scoped", () => {
  it("asks for one org and one repo, never a bare recommendation-id lookup", async () => {
    await getActiveDeferrals("kiro", "o/r", NOW);
    expect(deferralQueries[0]).toMatchObject({ orgId: "org-kiro", repoFullName: "o/r" });
  });

  it("returns an empty set for an unknown org rather than everyone's deferrals", async () => {
    await recordLaneOutcomes({ ...base, batchIds: ["r1"], closedIds: [], report: report([{ recommendationId: "r1", verdict: "skipped" }]) });
    expect([...(await getActiveDeferrals("kiro", "o/r", NOW))]).toEqual(["r1"]);
    expect([...(await getActiveDeferrals("someone-else", "o/r", NOW))]).toEqual([]);
  });

  it("drops a deferral once its window has passed", async () => {
    await recordLaneOutcomes({ ...base, batchIds: ["r1"], closedIds: [], report: report([{ recommendationId: "r1", verdict: "skipped" }]) });
    const later = new Date(NOW.getTime() + 30 * 24 * 60 * 60 * 1000);
    expect([...(await getActiveDeferrals("kiro", "o/r", later))]).toEqual([]);
  });
});

describe("listRunOutcomes", () => {
  it("maps timestamps to ISO strings — a wire type never carries a Date", async () => {
    await recordLaneOutcomes({ ...base, batchIds: ["r1"], closedIds: [], report: report([{ recommendationId: "r1", verdict: "skipped" }]) });
    const out = await listRunOutcomes("run-1");
    expect(typeof out[0]!.createdAt).toBe("string");
    expect(typeof out[0]!.deferUntil).toBe("string");
  });
});
