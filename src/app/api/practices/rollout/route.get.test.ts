// GET /api/practices/rollout: the read half of re-convergence. Council r2 robustness-4 found no test
// imported it, and a rejected status read escaped the handler with no answer of the route's own.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { respondError } = vi.hoisted(() => ({
  respondError: vi.fn((status: number, message: string) => Response.json({ error: message }, { status })),
}));
vi.mock("@/lib/api/respond", () => ({ respondError, reportHandledError: vi.fn() }));
vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return Response.json(body, init);
    }
  },
}));
vi.mock("@/lib/github/app", () => ({ AppApiError: class AppApiError extends Error {}, isAppConfigured: () => true }));
vi.mock("@/lib/github/pr-route", () => ({ classifyPrWriteError: vi.fn(), MINT_FAILED: "m", requirePrWriteTarget: vi.fn() }));
vi.mock("@/lib/db", () => ({ getOrgId: vi.fn(), recordAudit: vi.fn() }));
vi.mock("@/lib/db/practice-adoption", () => ({ listBehindRepos: vi.fn(), listDriftedRepos: vi.fn() }));
vi.mock("@/lib/practices/apply", () => ({ applyPracticeToRepo: vi.fn() }));
vi.mock("@/lib/auth", () => ({ isAuthConfigured: () => true }));
vi.mock("@/lib/access", () => ({ authGateEnabled: () => true, resolveViewerLogin: vi.fn(async () => "alice") }));
vi.mock("@/lib/authz", () => ({ requireOrgAccess: vi.fn(async () => null), requireOrgRole: vi.fn(async () => null) }));

import { GET } from "./route";
import { requireOrgAccess } from "@/lib/authz";
import { listBehindRepos, listDriftedRepos } from "@/lib/db/practice-adoption";

const get = (query: string) => GET(new Request(`http://localhost/api/practices/rollout${query}`));

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(requireOrgAccess).mockResolvedValue(null);
  vi.mocked(listBehindRepos).mockResolvedValue({ latestVersion: 3, fromVersion: 2, repos: ["acme/a"] } as never);
  vi.mocked(listDriftedRepos).mockResolvedValue({ drifted: ["acme/b"], removed: ["acme/c"] } as never);
});

describe("GET /api/practices/rollout", () => {
  it("400s without org or without practiceId, before the gate", async () => {
    expect((await get("?practiceId=ci-gates")).status).toBe(400);
    expect((await get("?org=acme")).status).toBe(400);
    expect(requireOrgAccess).not.toHaveBeenCalled();
  });

  it("passes the member gate's denial through and reads nothing", async () => {
    vi.mocked(requireOrgAccess).mockResolvedValue(Response.json({ error: "no" }, { status: 403 }) as never);
    const res = await get("?org=acme&practiceId=ci-gates");
    expect(res.status).toBe(403);
    expect(listBehindRepos).not.toHaveBeenCalled();
  });

  it("answers the status for the gated (lower-cased) org", async () => {
    const res = await get("?org=Acme&practiceId=ci-gates");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ latestVersion: 3, behind: ["acme/a"], drifted: ["acme/b"], removed: ["acme/c"] });
    expect(requireOrgAccess).toHaveBeenCalledWith("acme");
    expect(listBehindRepos).toHaveBeenCalledWith("acme", "ci-gates");
  });

  it("keeps latestVersion null (no mined pattern), never 0", async () => {
    vi.mocked(listBehindRepos).mockResolvedValue({ latestVersion: null, fromVersion: null, repos: [] } as never);
    expect((await (await get("?org=acme&practiceId=ci-gates")).json()).latestVersion).toBeNull();
  });

  it("a rejected status read answers a reported 500 with its cause", async () => {
    const boom = new Error("db down");
    vi.mocked(listDriftedRepos).mockRejectedValue(boom);
    const res = await get("?org=acme&practiceId=ci-gates");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Could not load the rollout status." });
    expect(respondError).toHaveBeenCalledWith(500, "Could not load the rollout status.", { cause: boom });
    expect(console.error).toHaveBeenCalledWith("[practices/rollout] status read failed", boom);
  });
});
