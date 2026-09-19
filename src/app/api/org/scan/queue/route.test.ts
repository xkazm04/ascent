// GET /api/org/scan/queue — the "N queued" poll (moonshot #10).
//
// The guard that matters is authorization shape. This is not an `[id]` route (the run id is a query
// parameter), but it carries the same hazard: a caller supplying BOTH an org and a run id must not be
// able to read another org's run by pairing their own org with someone else's id. The route uses
// GATE-THEN-CONSTRAIN — gate the org, then pass the resolved org id into the query beside the runId —
// so a mismatched run is simply not found rather than authorized by the caller's own pairing.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));
vi.mock("@/lib/db", () => ({ isDbConfigured: vi.fn(() => true) }));
vi.mock("@/lib/db/scan-jobs", () => ({ listJobsForRun: vi.fn(async () => []) }));
vi.mock("@/lib/authz", () => ({ requireOrgAccess: vi.fn(async () => null) }));

import { GET } from "./route";
import { listJobsForRun } from "@/lib/db/scan-jobs";
import { requireOrgAccess } from "@/lib/authz";

const mockJobs = vi.mocked(listJobsForRun);
const mockGate = vi.mocked(requireOrgAccess);

const job = (state: string, repo: string) => ({ state, repoFullName: repo }) as unknown as Awaited<ReturnType<typeof listJobsForRun>>[number];

const get = (qs: string) => GET(new Request(`http://localhost/api/org/scan/queue${qs}`));

beforeEach(() => {
  vi.clearAllMocks();
  mockGate.mockResolvedValue(null);
  mockJobs.mockResolvedValue([]);
});

describe("authorization", () => {
  it("refuses a caller the org gate rejects, and reads nothing", async () => {
    mockGate.mockResolvedValue(new Response("nope", { status: 403 }));
    const res = await get("?org=acme&runId=run_1");
    expect(res.status).toBe(403);
    expect(mockJobs).not.toHaveBeenCalled();
  });

  it("constrains the read to the GATED org, so a foreign runId is simply not found", async () => {
    await get("?org=acme&runId=run_from_another_org");
    // The org travels into the query beside the run id — the route never trusts the pair alone.
    expect(mockJobs).toHaveBeenCalledWith("acme", "run_from_another_org");
  });

  it("400s without both parameters rather than listing something broader", async () => {
    expect((await get("?org=acme")).status).toBe(400);
    expect((await get("?runId=run_1")).status).toBe(400);
    expect(mockJobs).not.toHaveBeenCalled();
  });
});

describe("the poll's answer", () => {
  it("counts each state separately and reports pending as queued + running", async () => {
    mockJobs.mockResolvedValue([
      job("done", "acme/a"),
      job("queued", "acme/b"),
      job("claimed", "acme/c"),
      job("failed", "acme/d"),
      job("skipped", "acme/e"),
    ]);

    const out = (await (await get("?org=acme&runId=run_1")).json()) as Record<string, number>;

    expect(out).toMatchObject({ total: 5, done: 1, queued: 1, running: 1, failed: 1, skipped: 1, pending: 2 });
  });

  it("returns zeros — not an error — for a run with no jobs, so the poll can end cleanly", async () => {
    const out = (await (await get("?org=acme&runId=gone")).json()) as Record<string, number>;
    expect(out).toMatchObject({ total: 0, pending: 0 });
  });
});
