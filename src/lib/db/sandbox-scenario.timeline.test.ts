// backlog develop-2026-09-17 row 34: the sandbox's projected-vs-actual lands on the recommendation
// TIMELINE, where the team tracks the work. Before this the reconciliation reached only the saved-plan
// bar and the intervention ledger; each committed rec's trail still ended at "Committed from sandbox
// simulation", so the tracker could not answer whether the plan came true.
//
// Pinned here:
//   1. K of K still-tracked recs in the scenario get exactly ONE reconciliation note once a newer scan
//      lands; open / dismissed / unselected recs get none.
//   2. A re-read writes nothing new (idempotent on rec, before scan, after scan).
//   3. Across a rubric change (sameRuler false) the note and the wire record say NOT COMPARABLE rather
//      than reporting a miss or a win.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { recommendationDecisionKey } from "@/lib/report/rec-identity";

const { mockIsDbConfigured, mockGetPrisma } = vi.hoisted(() => ({
  mockIsDbConfigured: vi.fn(),
  mockGetPrisma: vi.fn(),
}));

vi.mock("@/lib/db/client", () => ({
  isDbConfigured: mockIsDbConfigured,
  getPrisma: mockGetPrisma,
  dbReadSafe: async <T>(fn: () => Promise<T>, fallback: T) => {
    try {
      return await fn();
    } catch {
      return fallback;
    }
  },
}));
vi.mock("@/lib/db/scans-shared", async (orig) => ({
  ...(await orig<typeof import("@/lib/db/scans-shared")>()),
  resolveOrgId: vi.fn(async () => "org_1"),
}));
// The ledger mirror has its own suite; keep it out of this one's prisma fake.
vi.mock("@/lib/db/outcomes", () => ({
  recordOutcomeForScanPair: vi.fn(async () => true),
  scenarioBookends: vi.fn(async () => null),
  scenarioIdentityKey: vi.fn(() => "scenario:x"),
}));

import { getSandboxScenario } from "./sandbox-scenario";

const REPO = "acme/web";
const MODELED_AT = new Date("2026-06-01T00:00:00Z");
const key = (dim: string, title: string) => recommendationDecisionKey(REPO, dim, title);

type Rec = { id: string; scanId: string; dimId: string; title: string; status: string };
type Ev = { id: string; recommendationId: string; kind: string; fromValue: string | null; toValue: string | null; note: string | null; actor: string | null };

const RECS: Rec[] = [
  { id: "r1", scanId: "scan_after", dimId: "D2", title: "Add CI gate", status: "in_progress" },
  { id: "r2", scanId: "scan_after", dimId: "D3", title: "Write an AGENTS.md", status: "in_progress" },
  { id: "r3", scanId: "scan_after", dimId: "D5", title: "Pin the toolchain", status: "done" },
  // Selected, but nobody tracks it any more: no note.
  { id: "r4", scanId: "scan_after", dimId: "D6", title: "Add a threat model", status: "dismissed" },
  { id: "r5", scanId: "scan_after", dimId: "D7", title: "Document the release", status: "open" },
  // Tracked but never part of the scenario: no note.
  { id: "r6", scanId: "scan_after", dimId: "D8", title: "Unrelated work", status: "in_progress" },
  // The same gap on the MODELED scan: the note belongs on the row the tracker shows now.
  { id: "r0", scanId: "scan_before", dimId: "D2", title: "Add CI gate", status: "in_progress" },
];

const ITEM_KEYS = [
  key("D2", "Add CI gate"),
  key("D3", "Write an AGENTS.md"),
  key("D5", "Pin the toolchain"),
  key("D6", "Add a threat model"),
  key("D7", "Document the release"),
];

function fake(opts: { nextScan?: boolean; before?: string | null; after?: string | null; eventsThrow?: boolean } = {}) {
  const store = new Map<string, Ev>();
  const createCalls: { data: Ev[]; skipDuplicates?: boolean }[] = [];
  const recFindMany = vi.fn(async (args: { where: { scanId: string; status: { in: string[] } } }) =>
    RECS.filter((r) => r.scanId === args.where.scanId && args.where.status.in.includes(r.status)),
  );
  const client = {
    sandboxScenario: {
      findUnique: vi.fn(async () => ({
        repoFullName: REPO,
        authorLogin: "alice",
        overridesJson: "{}",
        itemKeysJson: JSON.stringify(ITEM_KEYS),
        baselineScore: 54,
        baselineLevel: "L3",
        baselineScanAt: MODELED_AT,
        projectedScore: 66,
        projectedLevel: "L4",
        projectedDelta: 12,
        updatedAt: new Date("2026-06-02T00:00:00Z"),
      })),
    },
    repository: { findUnique: vi.fn(async () => ({ id: "repo_1" })) },
    scan: {
      findFirst: vi.fn(async (args: { where: { scannedAt: { gt?: Date; lte?: Date } } }) => {
        if (args.where.scannedAt.lte) return { id: "scan_before", rubricVersion: opts.before === undefined ? "r21" : opts.before };
        if (opts.nextScan === false) return null;
        return {
          id: "scan_after",
          overallScore: 61,
          level: "L3",
          scannedAt: new Date("2026-07-01T00:00:00Z"),
          rubricVersion: opts.after === undefined ? "r21" : opts.after,
        };
      }),
    },
    recommendation: { findMany: recFindMany },
    recommendationEvent: {
      createMany: vi.fn(async (args: { data: Ev[]; skipDuplicates?: boolean }) => {
        if (opts.eventsThrow) throw new Error("db blip");
        createCalls.push(args);
        let count = 0;
        for (const e of args.data) {
          if (store.has(e.id)) {
            if (!args.skipDuplicates) throw new Error("P2002 unique violation");
            continue;
          }
          store.set(e.id, e);
          count += 1;
        }
        return { count };
      }),
    },
  };
  return { client, store, createCalls, recFindMany };
}

beforeEach(() => {
  mockIsDbConfigured.mockReset();
  mockGetPrisma.mockReset();
  mockIsDbConfigured.mockReturnValue(true);
});

describe("sandbox reconciliation onto the recommendation timeline", () => {
  it("writes exactly one note on each of the K still-tracked recs the scenario selected", async () => {
    const f = fake();
    mockGetPrisma.mockReturnValue(f.client);
    await getSandboxScenario("acme", "acme", "web", "alice");

    const events = [...f.store.values()];
    expect(events.map((e) => e.recommendationId).sort()).toEqual(["r1", "r2", "r3"]);
    for (const e of events) {
      expect(e.kind).toBe("note");
      expect(e.actor).toBeNull();
      expect(e.fromValue).toBe("scan_before");
      expect(e.toValue).toBe("scan_after");
      expect(e.note).toContain("projected +12");
      expect(e.note).toContain("actual +7");
      expect(e.note).toContain("5 pts short of the model");
    }
    // The notes land on the scan the tracker shows now, never on the modeled scan's rows.
    expect(f.recFindMany.mock.calls[0]![0].where.scanId).toBe("scan_after");
  });

  it("does not duplicate on a re-read", async () => {
    const f = fake();
    mockGetPrisma.mockReturnValue(f.client);
    await getSandboxScenario("acme", "acme", "web", "alice");
    await getSandboxScenario("acme", "acme", "web", "alice");
    await getSandboxScenario("acme", "acme", "web", "alice");

    expect(f.store.size).toBe(3);
    // Idempotency is the database's, not a read-then-write race: every attempt is keyed and skips.
    expect(f.createCalls.every((c) => c.skipDuplicates === true)).toBe(true);
    expect(new Set(f.createCalls.flatMap((c) => c.data.map((e) => e.id))).size).toBe(3);
  });

  it("guard: writes nothing while no newer scan exists", async () => {
    const f = fake({ nextScan: false });
    mockGetPrisma.mockReturnValue(f.client);
    const s = await getSandboxScenario("acme", "acme", "web", "alice");
    expect(s!.actual).toBeNull();
    expect(f.recFindMany).not.toHaveBeenCalled();
    expect(f.store.size).toBe(0);
  });

  it("labels a projection across a rubric change not comparable, on the wire and on the timeline", async () => {
    const f = fake({ before: "r19", after: "r21" });
    mockGetPrisma.mockReturnValue(f.client);
    const s = (await getSandboxScenario("acme", "acme", "web", "alice"))!;

    expect(s.actual!.ruler).toEqual({ before: "r19", after: "r21", same: false });
    const notes = [...f.store.values()].map((e) => e.note ?? "");
    expect(notes).toHaveLength(3);
    for (const n of notes) {
      expect(n).toContain("not comparable");
      expect(n).toContain("r19 to r21");
      expect(n).not.toMatch(/short|ahead|exactly as modeled|actual \+7/);
    }
  });

  it("guard: a failed timeline write never costs the reader the scenario", async () => {
    const f = fake({ eventsThrow: true });
    mockGetPrisma.mockReturnValue(f.client);
    const s = await getSandboxScenario("acme", "acme", "web", "alice");
    expect(s!.projected.delta).toBe(12);
    expect(s!.actual!.delta).toBe(7);
  });
});
