// The kiosk wall's run summary is COUNTS ONLY (backlog develop-2026-09-17 row 43, operator decision
// 2026-09-24): the token page is readable by anyone holding a link, so it may say how many runs, how many
// verified closes and how many points sit in review, and nothing that names a repo, a branch, a commit,
// a follow-up or a person. These cases pin the count, the null discipline, and that the shape itself
// refuses a name.

import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  runs: [] as Array<Record<string, unknown>>,
  ledger: null as Record<string, unknown> | null,
  ledgerCalls: 0,
  ledgerThrows: false,
}));
vi.mock("@/lib/db/loop-runs", () => ({ listLoopRuns: async () => db.runs }));
vi.mock("@/lib/db/org-impact", () => ({
  getOrgImpactLedger: async () => {
    db.ledgerCalls += 1;
    if (db.ledgerThrows) throw new Error("db down");
    return db.ledger;
  },
}));

const { countKioskRuns, loadKioskRunSummary, KIOSK_RUN_WINDOW } = await import("./live-share-summary");
import type { KioskRunSummary } from "./live-share-summary";

// A chronicle entry carries plenty of prose. Every string here must stay OFF the summary.
const run = (id: string, verifiedCloses: number) => ({
  id,
  phase: "done",
  repos: ["acme/secret-vault", "acme/billing-core"],
  cycle: 2,
  maxCycles: 3,
  startedAt: "2026-09-20T10:00:00.000Z",
  endedAt: "2026-09-20T11:00:00.000Z",
  lift: 4,
  model: "sonnet",
  effort: null,
  costMicros: 1_000,
  seq: 7,
  driveId: null,
  planMode: null,
  lanes: 2,
  verifiedCloses,
  landedAt: [],
  error: "push to ascent/loop-123-secret-vault failed for rotate-leaked-key",
});

beforeEach(() => {
  db.runs = [];
  db.ledger = null;
  db.ledgerCalls = 0;
  db.ledgerThrows = false;
});

describe("countKioskRuns", () => {
  it("is null when there are no runs, so the page renders no strip at all", () => {
    expect(countKioskRuns([], { inReviewPoints: 5 })).toBeNull();
  });

  it("counts the runs and sums their adjudicated closes", () => {
    const s = countKioskRuns([run("a", 3), run("b", 0), run("c", 2)], { inReviewPoints: 7 });
    expect(s).toEqual({ runs: 3, runWindow: KIOSK_RUN_WINDOW, verifiedCloses: 5, pointsInReview: 7 });
  });

  it("keeps an unmeasured in-review figure NULL, never 0", () => {
    expect(countKioskRuns([run("a", 1)], { inReviewPoints: null })?.pointsInReview).toBeNull();
    expect(countKioskRuns([run("a", 1)], null)?.pointsInReview).toBeNull();
  });

  it("returns numbers only: no key and no value of the input's prose survives", () => {
    const s = countKioskRuns([run("a", 1)], { inReviewPoints: 2 }) as KioskRunSummary;
    expect(Object.keys(s).sort()).toEqual(["pointsInReview", "runWindow", "runs", "verifiedCloses"]);
    for (const v of Object.values(s)) expect(v === null || typeof v === "number").toBe(true);
    const wire = JSON.stringify(s);
    for (const leak of ["secret-vault", "billing-core", "ascent/loop", "rotate-leaked-key", "sonnet"]) {
      expect(wire).not.toContain(leak);
    }
  });
  // The shape refusing a name is a COMPILE-time guard: see `live-share-summary.typecheck.ts`.
});

describe("loadKioskRunSummary", () => {
  it("reads nothing more when the org has no runs", async () => {
    expect(await loadKioskRunSummary("acme")).toBeNull();
    expect(db.ledgerCalls).toBe(0);
  });

  it("folds the org's runs and the ledger's in-review points into counts", async () => {
    db.runs = [run("a", 2), run("b", 1)];
    db.ledger = { inReviewPoints: 9, rows: [{ repoFullName: "acme/secret-vault", practiceLabel: "Rotate key" }] };
    expect(await loadKioskRunSummary("acme")).toEqual({
      runs: 2,
      runWindow: KIOSK_RUN_WINDOW,
      verifiedCloses: 3,
      pointsInReview: 9,
    });
  });

  it("a ledger that fails to load reads as unmeasured, not as a failed page", async () => {
    db.runs = [run("a", 1)];
    db.ledgerThrows = true;
    expect((await loadKioskRunSummary("acme"))?.pointsInReview).toBeNull();
  });
});
