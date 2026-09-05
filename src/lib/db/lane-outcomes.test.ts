// Per-item outcomes, against a fake Prisma. Three properties matter and each is a rule a reviewer
// would otherwise have to take on trust:
//   • the RESCAN outranks the agent's claim — always, in both directions;
//   • only `skipped` / `needs_human` park an item, and the park is bounded;
//   • the deferral read is org- AND repo-scoped, so one tenant's skip cannot suppress another's item;
//   • an UNVERIFIED `resolved` whose own reason admits the session could not do the thing is
//     downgraded to `needs_human` and parked — both directions pinned, on the real sentence;
//   • `verified` separates the rescan's verdict from the agent's claim, in both directions — and it
//     is read from the row's OWN `verifiedAt` stamp, so a row nothing adjudicated can never borrow
//     verification from a lane's trailer set (UAT `RC-N4`).

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
  verifiedAt: Date | null;
  createdAt: Date;
}

const rows: Row[] = [];
const events: Record<string, unknown>[] = [];
const deferralQueries: Record<string, unknown>[] = [];
/** Lanes exist in the fixture only to prove `listRunOutcomes` no longer READS them: verification is
 *  the row's own `verifiedAt` stamp now, and a lane's `closedIdsJson` — the raw trailer set on every
 *  pre-split lane — must not be able to verify anything. `findMany` throws if the read comes back. */
const lanes: { id: string; runId: string; closedIdsJson: string }[] = [];
let laneReads = 0;

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
    loopRunLane: {
      findMany: async ({ where }: { where: { runId?: string } }) => {
        laneReads += 1;
        return lanes.filter((l) => where.runId == null || l.runId === where.runId).map((l) => ({ id: l.id, closedIdsJson: l.closedIdsJson }));
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

import { admitsIncapacity, deferUntilFor, getActiveDeferrals, LANE_DEFER_MAX_DAYS, listRunOutcomes, recordLaneOutcomes } from "@/lib/db/lane-outcomes";

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
  lanes.length = 0;
  laneReads = 0;
});

describe("recordLaneOutcomes — the rescan outranks the claim", () => {
  it("writes `resolved` for a closed id even when the agent said it skipped", async () => {
    await recordLaneOutcomes({ ...base, batchIds: ["r1"], closedIds: ["r1"], report: report([{ recommendationId: "r1", verdict: "skipped" }]) });
    expect(rows[0]).toMatchObject({ recommendationId: "r1", verdict: "resolved", deferUntil: null });
  });

  // THE TITLE USED TO SAY "does NOT write `resolved`" over an assertion that it DOES, with a comment
  // claiming "only the verifier writes `resolved`" (UAT PRIYA-L1-702 cited it verbatim). The verdict
  // column really does hold `resolved` for both — the agent's account is recorded in its own words —
  // so the title is fixed to what the code does, and the DISCRIMINATOR is what the test now pins.
  it("records an agent-claimed `resolved` the rescan did not close as UNVERIFIED", async () => {
    const written = await recordLaneOutcomes({ ...base, batchIds: ["r1"], closedIds: [], report: report([{ recommendationId: "r1", verdict: "resolved" }]) });
    // The claim is recorded as the claim it is — and `verified: false` is what stops the cockpit
    // rendering it as "closed by the rescan".
    expect(rows[0]!.verdict).toBe("resolved");
    expect(written[0]!.verified).toBe(false);
    // …and it parks nothing, so the next cycle can try again.
    expect(rows[0]!.deferUntil).toBeNull();
  });

  it("marks a rescan-closed id VERIFIED, and only that one", async () => {
    const written = await recordLaneOutcomes({
      ...base,
      batchIds: ["r1", "r2"],
      closedIds: ["r1"],
      report: report([
        { recommendationId: "r1", verdict: "resolved" },
        { recommendationId: "r2", verdict: "resolved" },
      ]),
    });
    expect(written.map((w) => [w.recommendationId, w.verdict, w.verified])).toEqual([
      ["r1", "resolved", true],
      ["r2", "resolved", false],
    ]);
  });

  it("never marks a non-`resolved` verdict verified", async () => {
    const written = await recordLaneOutcomes({ ...base, batchIds: ["r1"], closedIds: [], report: report([{ recommendationId: "r1", verdict: "skipped" }]) });
    expect(written[0]!.verified).toBe(false);
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

describe("admitsIncapacity — the heuristic over the agent's own words", () => {
  // The sentence a real lane wrote under verdict `resolved`, verbatim. It is the reason this exists.
  const REAL =
    "The nine floating refs are still tags: resolving a tag to a commit SHA requires asking GitHub " +
    "what it points at right now, this session has neither network nor shell, and inventing a SHA " +
    "breaks the workflow rather than pinning it — so instead the burn-down stopped being a " +
    "maintainer chore with no owner (.github/workflows/pin-actions.yml runs security:actions --resolve weekly…)";

  it("catches the real sentence, and the ordinary phrasings of the same admission", () => {
    expect(admitsIncapacity(REAL)).toBe(true);
    for (const s of [
      "This session has no shell, so I could not run the generator.",
      "Pinning needs a digest and there is no network here.",
      "I cannot run the test suite to produce the baseline.",
      "Would need to fetch the advisory database first.",
      "Resolving these requires asking GitHub for the current SHAs.",
    ]) {
      expect(admitsIncapacity(s), s).toBe(true);
    }
  });

  it("leaves a genuine resolve alone — the list is narrow on purpose", () => {
    for (const s of [
      "Added an explicit `permissions: contents: read` block to all three workflows.",
      "",
      "Wired CodeQL on pull_request and push to main; it fails the check on a new high finding.",
      "Documented the review rubric in CLAUDE.md and added the missing AGENTS.md pointer.",
      // Mentions a shell and a network without admitting it lacked either.
      "The new pre-commit hook runs in the developer's shell before every commit.",
      "Added a network timeout to the fetch wrapper so a hung call cannot stall the build.",
    ]) {
      expect(admitsIncapacity(s), JSON.stringify(s)).toBe(false);
    }
  });

  it("matches across a line-wrapped reason", () => {
    expect(admitsIncapacity("resolving the tag requires asking\n  GitHub what it points at")).toBe(true);
  });
});

describe("recordLaneOutcomes — a substituted resolve is downgraded, not trusted", () => {
  const REAL =
    "The nine floating refs are still tags: resolving a tag to a commit SHA requires asking GitHub " +
    "what it points at right now, this session has neither network nor shell, and inventing a SHA " +
    "breaks the workflow rather than pinning it — so instead a weekly workflow now does the burn-down.";

  it("downgrades an unverified `resolved` whose own reason admits the incapacity, and PARKS it", async () => {
    await recordLaneOutcomes({ ...base, batchIds: ["r1"], closedIds: [], report: report([{ recommendationId: "r1", verdict: "resolved", reason: REAL }]) });
    expect(rows[0]!.verdict).toBe("needs_human");
    // It defers through the ordinary path, so the next cycle works something else.
    expect(rows[0]!.deferUntil).not.toBeNull();
    // The row still carries the agent's OWN words; only the timeline says a downgrade happened.
    expect(rows[0]!.reason).toBe(REAL);
    expect(events[0]).toMatchObject({ toValue: "needs_human" });
    expect(events[0]!.note as string).toContain("lacked a capability");
  });

  it("leaves a genuine resolve untouched — same shape, honest reason", async () => {
    await recordLaneOutcomes({
      ...base,
      batchIds: ["r1"],
      closedIds: [],
      report: report([{ recommendationId: "r1", verdict: "resolved", reason: "Added an explicit `permissions: contents: read` block to all three workflows; the CI lint fails without one." }]),
    });
    expect(rows[0]!.verdict).toBe("resolved");
    expect(rows[0]!.deferUntil).toBeNull();
  });

  it("never downgrades an id the RESCAN closed — the verifier outranks the heuristic", async () => {
    await recordLaneOutcomes({ ...base, batchIds: ["r1"], closedIds: ["r1"], report: report([{ recommendationId: "r1", verdict: "resolved", reason: REAL }]) });
    expect(rows[0]!.verdict).toBe("resolved");
    expect(rows[0]!.deferUntil).toBeNull();
  });

  it("does not touch a non-`resolved` claim, whatever its reason says", async () => {
    await recordLaneOutcomes({ ...base, batchIds: ["r1"], closedIds: [], report: report([{ recommendationId: "r1", verdict: "attempted", reason: REAL }]) });
    expect(rows[0]!.verdict).toBe("attempted");
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

  it("stamps `verifiedAt` on the rescan's close and reads `verified` from it, not from the verdict word", async () => {
    await recordLaneOutcomes({
      ...base,
      batchIds: ["r1", "r2"],
      closedIds: ["r1"],
      report: report([
        { recommendationId: "r1", verdict: "resolved" },
        { recommendationId: "r2", verdict: "resolved" },
      ]),
    });
    expect(rows.find((r) => r.recommendationId === "r1")!.verifiedAt).toEqual(NOW);
    expect(rows.find((r) => r.recommendationId === "r2")!.verifiedAt).toBeNull();
    const out = await listRunOutcomes("run-1");
    expect(out.map((o) => [o.recommendationId, o.verified]).sort()).toEqual([
      ["r1", true],
      ["r2", false],
    ]);
    expect(out.find((o) => o.recommendationId === "r1")!.verifiedAt).toBe(NOW.toISOString());
    expect(out.find((o) => o.recommendationId === "r2")!.verifiedAt).toBeNull();
  });

  // THE REGRESSION THIS COLUMN EXISTS FOR (UAT `RC-N4`). `verified` was joined from the lane's
  // `closedIdsJson`, and every pre-split lane stored the agent's raw commit-trailer set there — so
  // 36 of 36 historical rows read `verified: true` and not one rendered "claimed resolved". A lane
  // saying the id closed must now buy the row NOTHING.
  it("does not let a lane's `closedIdsJson` verify a row nothing stamped", async () => {
    lanes.push({ id: "lane-1", runId: "run-1", closedIdsJson: JSON.stringify(["r1"]) });
    await recordLaneOutcomes({ ...base, batchIds: ["r1"], closedIds: [], report: report([{ recommendationId: "r1", verdict: "resolved" }]) });
    const out = await listRunOutcomes("run-1");
    expect(out[0]!.verdict).toBe("resolved");
    expect(out[0]!.verified).toBe(false);
    expect(laneReads).toBe(0);
  });

  // Every row written before the column existed. Prisma returns them with `verifiedAt: null`; a
  // database that has not applied the migration yet returns no field at all. Both are un-adjudicated
  // claims and both must read unverified — no code path may treat the absence as verification.
  it("reads a historical row — null stamp or no column at all — as UNVERIFIED", async () => {
    rows.push({
      id: "legacy-null", orgId: "org-kiro", runId: "run-1", laneId: "lane-1", repoFullName: "o/r",
      recommendationId: "old-1", cycle: 1, verdict: "resolved", reason: "", filesJson: "[]",
      deferUntil: null, verifiedAt: null, createdAt: new Date("2026-08-01T00:00:00Z"),
    });
    rows.push({
      id: "legacy-missing", orgId: "org-kiro", runId: "run-1", laneId: "lane-1", repoFullName: "o/r",
      recommendationId: "old-2", cycle: 1, verdict: "resolved", reason: "", filesJson: "[]",
      deferUntil: null, createdAt: new Date("2026-08-01T00:00:00Z"),
    } as unknown as Row);
    const out = await listRunOutcomes("run-1");
    expect(out.map((o) => [o.recommendationId, o.verified, o.verifiedAt]).sort()).toEqual([
      ["old-1", false, null],
      ["old-2", false, null],
    ]);
  });

  // Two arms of one repo in one cycle arm the SAME batch. Arm A's verified close must not launder
  // arm B's unconfirmed claim — the stamp is per ROW, so the isolation is structural now.
  it("scopes verification to the row, so an A/B sibling's close does not verify this lane's claim", async () => {
    await recordLaneOutcomes({ ...base, laneId: "lane-1", batchIds: ["r1"], closedIds: ["r1"], report: report([{ recommendationId: "r1", verdict: "resolved" }]) });
    await recordLaneOutcomes({ ...base, laneId: "lane-2", batchIds: ["r1"], closedIds: [], report: report([{ recommendationId: "r1", verdict: "resolved" }]) });
    const out = await listRunOutcomes("run-1");
    expect(out.filter((o) => o.laneId === "lane-1").map((o) => o.verified)).toEqual([true]);
    expect(out.filter((o) => o.laneId === "lane-2").map((o) => o.verified)).toEqual([false]);
  });

  // A re-parse of the same report is idempotent; a re-parse where the rescan no longer closes the id
  // moves the verdict AND the stamp together, so the two can never contradict each other.
  it("keeps the stamp and the verdict in step across a re-parse", async () => {
    await recordLaneOutcomes({ ...base, batchIds: ["r1"], closedIds: ["r1"], report: report([{ recommendationId: "r1", verdict: "resolved" }]) });
    expect(rows[0]!.verifiedAt).toEqual(NOW);
    await recordLaneOutcomes({ ...base, batchIds: ["r1"], closedIds: [], report: report([{ recommendationId: "r1", verdict: "skipped" }]) });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.verdict).toBe("skipped");
    expect(rows[0]!.verifiedAt).toBeNull();
  });

  it("never marks a non-`resolved` verdict verified, whatever the stamp says", async () => {
    rows.push({
      id: "odd", orgId: "org-kiro", runId: "run-1", laneId: "lane-1", repoFullName: "o/r",
      recommendationId: "r9", cycle: 1, verdict: "needs_human", reason: "", filesJson: "[]",
      deferUntil: null, verifiedAt: NOW, createdAt: NOW,
    });
    const out = await listRunOutcomes("run-1");
    expect(out[0]!.verified).toBe(false);
  });
});
