// The ledger chronicle's page of the loop status route. `beforeSeq`/`limit` ask for a LEAN `{ runs }`
// page; with neither, the response is byte-for-byte the shape every existing caller has always read.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));
vi.mock("@/lib/api/self-host", () => ({ selfHostGuard: () => null }));
vi.mock("@/lib/api/orgPlan", () => ({ dbGuard: () => null }));
vi.mock("@/lib/github/app", () => ({ isAppConfigured: () => true }));
vi.mock("@/lib/local/agent", () => ({ autopilotEnabled: () => true, agentTimeoutMs: () => 1_200_000 }));
vi.mock("@/lib/authz", () => ({ requireOrgAccess: vi.fn(async () => null), requireOrgRole: vi.fn(async () => null) }));
vi.mock("@/lib/access", () => ({ getViewer: vi.fn(async () => ({ login: "alice" })) }));
vi.mock("@/lib/db/loop-tenancy", () => ({ orgIdForSlug: vi.fn(async () => "org-acme") }));
vi.mock("@/lib/db/loop-runs", () => ({
  LOOP_CONCURRENCY_CAP: 4,
  LOOP_MAX_CYCLES_CAP: 5,
  getActiveLoopRun: vi.fn(async () => null),
  listLoopRuns: vi.fn(async () => [{ id: "run-9", seq: 9 }]),
  markStaleRunsStopped: vi.fn(async () => 0),
  getOrgPriceList: vi.fn(async () => null),
  getLoopRun: vi.fn(async () => null),
  getLane: vi.fn(async () => null),
  reviewDeliverable: vi.fn(async () => []),
}));
vi.mock("@/lib/local/loop-engine", () => ({
  startLoopRun: vi.fn(),
  startRemoteRun: vi.fn(),
  stopLoopRun: vi.fn(),
  retryLane: vi.fn(),
  isLoopRunLive: vi.fn(() => false),
  loopRunStopRequested: vi.fn(() => false),
}));

import { GET } from "./route";
import { listLoopRuns, markStaleRunsStopped } from "@/lib/db/loop-runs";

const get = (qs: string) => GET(new Request(`http://localhost/api/org/loop?${qs}`));

beforeEach(() => vi.clearAllMocks());

describe("GET /api/org/loop — the chronicle page", () => {
  it("keeps the full status response, and the 20-run default, when no paging parameter is sent", async () => {
    const body = (await (await get("org=acme")).json()) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(["active", "enabled", "prAvailable", "prices", "runs", "stopHorizonMs", "stopping"]);
    expect(listLoopRuns).toHaveBeenCalledWith("acme", 20);
  });

  it("answers { runs } alone for beforeSeq + limit, reading below that number", async () => {
    const res = await get("org=acme&beforeSeq=21&limit=20");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ runs: [{ id: "run-9", seq: 9 }] });
    expect(listLoopRuns).toHaveBeenCalledWith("acme", 20, { beforeSeq: 21 });
    // A page of history reconciles nothing and prices nothing.
    expect(markStaleRunsStopped).not.toHaveBeenCalled();
  });

  it("defaults the page size to 20 and accepts a limit with no cursor", async () => {
    await get("org=acme&beforeSeq=5");
    expect(listLoopRuns).toHaveBeenLastCalledWith("acme", 20, { beforeSeq: 5 });
    await get("org=acme&limit=7");
    expect(listLoopRuns).toHaveBeenLastCalledWith("acme", 7, { beforeSeq: null });
  });

  it("400s a malformed cursor or page size instead of silently serving a different page", async () => {
    for (const qs of ["beforeSeq=abc", "beforeSeq=0", "beforeSeq=2.5", "limit=0", "limit=101", "limit=x"]) {
      expect((await get(`org=acme&${qs}`)).status).toBe(400);
    }
    expect(listLoopRuns).not.toHaveBeenCalled();
  });
});
