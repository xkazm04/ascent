// TWO THINGS A RESCAN USED TO ERASE, against a fake Prisma.
//
//   1. A DEFERRAL KEYED ON A ROW ID. Every rescan re-derives a repository's recommendations as new
//      rows with new ids, so a park recorded against an id expired minutes later. The measurement:
//      D9's "pin actions to a commit SHA" was dispatched and skipped for "no network" in 8 of 8
//      campaign-5 runs, and 529 `in_progress` rows for it accumulated
//      (docs/harness/reflection-2026-09-01.md, finding 5). A deferral now keys on the item's stable
//      identity — `dimId` + normalized title — and survives the rescan that replaces the row.
//
//   2. A CRAFT RUNG THAT COULD NEVER REACH `done`. Craft closes on its trailer and nothing else, but
//      `decideInProgress` is only asked once a scan stops restating the row — and a craft entry is
//      re-derived from an unbounded question every scan, so it is restated nearly every time. 2757
//      `in_progress` craft rows over 186 titles, one title re-raised 61 times. The close now happens
//      at lane end, on the trailer of a VERIFIED lane, which is where both facts exist at once.

import { beforeEach, describe, expect, it, vi } from "vitest";

type Rec = { id: string; dimId: string; title: string; status: string; kind: string; scanId: string };

const recs: Rec[] = [];
const outcomes: { recommendationId: string; repoFullName: string; orgId: string; verdict: string; deferUntil: Date | null }[] = [];
const events: Record<string, unknown>[] = [];
let laneVerdict: string | null = "verified";

vi.mock("@/lib/db/org-shared", () => ({ getOrgBySlug: vi.fn(async (slug: string) => (slug === "kiro" ? { id: "org-kiro" } : null)) }));
vi.mock("@/lib/db/client", () => ({
  isDbConfigured: () => true,
  dbReadSafe: async <T,>(fn: () => Promise<T>, fallback: T) => fn().catch(() => fallback),
  getPrisma: () => ({
    laneItemOutcome: {
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        outcomes.filter(
          (o) =>
            (where.orgId === undefined || o.orgId === where.orgId) &&
            (where.repoFullName === undefined || o.repoFullName === where.repoFullName) &&
            (where.verdict === undefined || o.verdict === where.verdict) &&
            (where.deferUntil === undefined || (o.deferUntil !== null && o.deferUntil > (where.deferUntil as { gt: Date }).gt)),
        ),
      upsert: async ({ create }: { create: Record<string, unknown> }) => ({ ...create, id: "o1", createdAt: new Date("2026-09-01T00:00:00Z") }),
    },
    recommendation: {
      findMany: async ({ where }: { where: Record<string, unknown> }) =>
        recs.filter((r) => {
          const idIn = (where.id as { in: string[] } | undefined)?.in;
          const statusIn = (where.status as { in?: string[]; not?: string } | undefined) ?? undefined;
          if (idIn && !idIn.includes(r.id)) return false;
          if (where.scanId !== undefined && r.scanId !== where.scanId) return false;
          if (where.kind !== undefined && r.kind !== where.kind) return false;
          if (statusIn?.in && !statusIn.in.includes(r.status)) return false;
          if (statusIn?.not && r.status === statusIn.not) return false;
          return true;
        }),
      update: async ({ where, data }: { where: { id: string }; data: { status: string } }) => {
        const row = recs.find((r) => r.id === where.id);
        if (!row) throw new Error("no row");
        row.status = data.status;
        return row;
      },
    },
    repository: { findUnique: async () => ({ id: "repo-1" }) },
    scan: { findFirst: async () => ({ id: "scan-2" }) },
    loopRunLane: { findUnique: async () => ({ verifyVerdict: laneVerdict }) },
    recommendationEvent: { create: async ({ data }: { data: Record<string, unknown> }) => events.push(data) },
  }),
}));

import { getActiveDeferrals, claimedTrailerIds, recordLaneOutcomes } from "./lane-outcomes";

const NOW = new Date("2026-09-01T12:00:00Z");
const LATER = new Date("2026-09-03T12:00:00Z");

beforeEach(() => {
  recs.length = 0;
  outcomes.length = 0;
  events.length = 0;
  laneVerdict = "verified";
});

describe("getActiveDeferrals — the park is on the ITEM, not on the row", () => {
  it("keeps a re-derived row deferred when its dimension and title are the same", async () => {
    // The row a lane parked, on the scan it was parked from…
    recs.push({ id: "old", dimId: "D9", title: "Pin actions to commit SHAs", status: "in_progress", kind: "gap", scanId: "scan-1" });
    // …and what the very next rescan produced: same item, new id, title re-worded only in case/spacing.
    recs.push({ id: "new", dimId: "D9", title: "Pin  Actions to commit SHAs", status: "open", kind: "gap", scanId: "scan-2" });
    recs.push({ id: "other", dimId: "D9", title: "Add a CODEOWNERS file", status: "open", kind: "gap", scanId: "scan-2" });
    outcomes.push({ recommendationId: "old", repoFullName: "kiro/kp", orgId: "org-kiro", verdict: "needs_human", deferUntil: LATER });

    const parked = await getActiveDeferrals("kiro", "kiro/kp", NOW);
    expect(parked.has("old")).toBe(true);
    expect(parked.has("new"), "the rescan's replacement row carries the same identity").toBe(true);
    // A genuinely different item on the same dimension is NOT parked — the widening is by identity,
    // never by dimension.
    expect(parked.has("other")).toBe(false);
  });

  it("is empty when nothing is parked, and never widens past the deferral window", async () => {
    recs.push({ id: "new", dimId: "D9", title: "Pin actions to commit SHAs", status: "open", kind: "gap", scanId: "scan-2" });
    outcomes.push({ recommendationId: "old", repoFullName: "kiro/kp", orgId: "org-kiro", verdict: "skipped", deferUntil: new Date("2026-08-01T00:00:00Z") });
    expect((await getActiveDeferrals("kiro", "kiro/kp", NOW)).size).toBe(0);
  });
});

describe("claimedTrailerIds — the same rule lane-commit writes trailers by", () => {
  const report = (items: { recommendationId: string; verdict: string }[]) => ({ items, lessons: [] }) as never;

  it("takes the named RESOLVED ids, trails the rest of a skip-only session, and claims nothing on silence", () => {
    expect(claimedTrailerIds(["a", "b"], report([{ recommendationId: "a", verdict: "resolved" }]))).toEqual(["a"]);
    expect(claimedTrailerIds(["a", "b"], report([{ recommendationId: "a", verdict: "skipped" }]))).toEqual(["b"]);
    expect(claimedTrailerIds(["a", "b"], null)).toEqual([]);
  });
});

describe("recordLaneOutcomes — a built craft rung finally closes", () => {
  const craftRow = () => recs.push({ id: "craft-1", dimId: "D2", title: "A performance budget that fails CI", status: "in_progress", kind: "craft", scanId: "scan-2" });
  const run = (verdict: string) =>
    recordLaneOutcomes({
      orgSlug: "kiro",
      runId: "run-1",
      laneId: "lane-1",
      repoFullName: "kiro/kp",
      cycle: 2,
      batchIds: ["craft-1"],
      closedIds: [],
      report: { items: [{ recommendationId: "craft-1", verdict, reason: "Built it", files: [] }], lessons: [] } as never,
      now: NOW,
    });

  it("closes a craft row the session claimed on a VERIFIED lane, and says why in the timeline", async () => {
    craftRow();
    await run("resolved");
    expect(recs[0]!.status).toBe("done");
    const note = events.find((e) => e.kind === "status");
    expect(String(note?.note)).toContain("Craft rung BUILT");
    expect(String(note?.note)).toContain("Ascent-Resolves");
  });

  it("closes NOTHING when the lane was not verified — an unverified claim certifies itself", async () => {
    craftRow();
    laneVerdict = "skipped";
    await run("resolved");
    expect(recs[0]!.status).toBe("in_progress");
    laneVerdict = null;
    await run("resolved");
    expect(recs[0]!.status).toBe("in_progress");
  });

  it("closes nothing the session did not claim", async () => {
    craftRow();
    await run("skipped");
    expect(recs[0]!.status).toBe("in_progress");
  });

  it("leaves a GAP row alone — a gap still closes only on the rescan's movement witness", async () => {
    recs.push({ id: "craft-1", dimId: "D9", title: "Pin actions", status: "in_progress", kind: "gap", scanId: "scan-2" });
    await run("resolved");
    expect(recs[0]!.status).toBe("in_progress");
  });
});
