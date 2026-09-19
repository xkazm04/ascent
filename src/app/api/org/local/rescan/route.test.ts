// POST /api/org/local/rescan — the closed count is persist's adjudicated set, never the trailer
// claims. Same split `rescanWorktree` already makes (`closedIds` vs `claimedIds`; UAT `PRIYA-L1-702`).
// The ledger button used to total `report.resolvedFollowUpIds` and print it as "N follow-ups closed".

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));

const gates = { selfHosted: true, db: true, access: null as unknown };

vi.mock("@/lib/auth", () => ({ PUBLIC_ORG: "public" }));
vi.mock("@/lib/api/self-host", () => ({
  selfHostGuard: () =>
    gates.selfHosted ? null : new Response(JSON.stringify({ error: "Not found." }), { status: 404 }),
}));
vi.mock("@/lib/api/orgPlan", () => ({
  dbGuard: () =>
    gates.db ? null : new Response(JSON.stringify({ error: "Local rescans require a database." }), { status: 503 }),
}));
vi.mock("@/lib/authz", () => ({
  requireOrgAccess: vi.fn(async () => gates.access),
}));

const persisted = {
  value: { scanId: "scan-1", deduped: false, closedFollowUpIds: ["gap-1"] } as
    | { scanId: string; deduped: boolean; closedFollowUpIds: string[] }
    | null,
};
const scanned = { resolvedFollowUpIds: ["gap-1", "gap-2", "gap-3"] as string[] | undefined };

vi.mock("@/lib/db", () => ({
  getLatestPlatformSignals: vi.fn(async () => null),
  getRepoLocalPath: vi.fn(async () => "/tmp/repo"),
  persistScanReport: vi.fn(async () => persisted.value),
  recordScanOutcome: vi.fn(async () => {}),
}));
vi.mock("@/lib/local/pairing", () => ({
  verifyLocalPath: vi.fn(async () => ({ ok: true, error: null })),
}));
vi.mock("@/lib/local/source", () => ({
  LocalFsSource: class {},
  isWorkingCopyDirty: vi.fn(async () => false),
}));
vi.mock("@/lib/scan", () => ({
  scanRepository: vi.fn(async () => ({
    level: { id: "L3" },
    overallScore: 72,
    repo: { headSha: "abc" },
    resolvedFollowUpIds: scanned.resolvedFollowUpIds,
  })),
}));

import { POST } from "./route";

const post = (body: unknown) =>
  POST(
    new Request("http://localhost/api/org/local/rescan", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

beforeEach(() => {
  gates.selfHosted = true;
  gates.db = true;
  gates.access = null;
  persisted.value = { scanId: "scan-1", deduped: false, closedFollowUpIds: ["gap-1"] };
  scanned.resolvedFollowUpIds = ["gap-1", "gap-2", "gap-3"];
});

describe("POST /api/org/local/rescan — persist closures, not trailer claims", () => {
  it("returns only what persistScanReport ADJUDICATED as closed", async () => {
    const body = await (await post({ org: "acme", fullName: "acme/api" })).json();
    expect(body.closedFollowUps).toEqual(["gap-1"]);
    expect(body.resolvedFollowUps).toEqual(["gap-1"]);
    expect(body.ok).toBe(true);
  });

  it("returns the trailers as CLAIMS, on their own field", async () => {
    const body = await (await post({ org: "acme", fullName: "acme/api" })).json();
    expect(body.claimedFollowUps).toEqual(["gap-1", "gap-2", "gap-3"]);
    expect(body.closedFollowUps).not.toContain("gap-2");
    expect(body.closedFollowUps).not.toContain("gap-3");
  });

  it("closes NOTHING when the movement witness refused every claim", async () => {
    persisted.value = { scanId: "scan-1", deduped: false, closedFollowUpIds: [] };
    const body = await (await post({ org: "acme", fullName: "acme/api" })).json();
    expect(body.closedFollowUps).toEqual([]);
    expect(body.resolvedFollowUps).toEqual([]);
    expect(body.claimedFollowUps).toHaveLength(3);
  });

  it("closes nothing when persistence is off — an unpersisted scan adjudicated nothing", async () => {
    persisted.value = null;
    const body = await (await post({ org: "acme", fullName: "acme/api" })).json();
    expect(body.closedFollowUps).toEqual([]);
    expect(body.ok).toBe(true);
  });

  it("can close an id no trailer named — the rescan's own not-restated-and-moved rule", async () => {
    scanned.resolvedFollowUpIds = [];
    persisted.value = { scanId: "scan-1", deduped: false, closedFollowUpIds: ["gap-9"] };
    const body = await (await post({ org: "acme", fullName: "acme/api" })).json();
    expect(body.closedFollowUps).toEqual(["gap-9"]);
    expect(body.claimedFollowUps).toEqual([]);
  });
});
