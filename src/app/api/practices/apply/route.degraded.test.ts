// Failure paths of the single-repo apply: each is answered with its cause reported, and a failed org
// lookup refuses the write rather than opening an untracked PR.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { respondError, reportHandledError, requirePrWriteTarget } = vi.hoisted(() => ({
  respondError: vi.fn((status: number, message: string) => Response.json({ error: message }, { status })),
  reportHandledError: vi.fn(),
  requirePrWriteTarget: vi.fn(),
}));
vi.mock("@/lib/api/respond", () => ({ respondError, reportHandledError }));
vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return Response.json(body, init);
    }
  },
}));
vi.mock("@/lib/github/source", () => ({
  GitHubError: class GitHubError extends Error {},
  parseRepoUrl: (input: string) => {
    const [owner, repo] = String(input).split("/");
    return owner && repo ? { owner, repo } : null;
  },
}));
vi.mock("@/lib/github/app", () => ({
  AppApiError: class AppApiError extends Error {},
  isAppConfigured: vi.fn(() => true),
}));
vi.mock("@/lib/github/pr-route", async (orig) => ({
  ...(await orig<typeof import("@/lib/github/pr-route")>()),
  requirePrWriteTarget,
}));
vi.mock("@/lib/db", () => ({ getOrgId: vi.fn(), recordAudit: vi.fn() }));
vi.mock("@/lib/db/practice-adoption", () => ({
  listBehindRepos: vi.fn(async () => ({ repos: [], latestVersion: null, fromVersion: null })),
  listDriftedRepos: vi.fn(),
}));
vi.mock("@/lib/practices/apply", () => ({ applyPracticeToRepo: vi.fn() }));
vi.mock("@/lib/auth", () => ({ isAuthConfigured: () => false }));
vi.mock("@/lib/access", () => ({ authGateEnabled: () => false, resolveViewerLogin: vi.fn(async () => "alice") }));
vi.mock("@/lib/authz", () => ({ requireOrgAccess: vi.fn(async () => null), requireOrgRole: vi.fn(async () => null) }));
vi.mock("@/lib/db/org-admission", () => ({ orgTracksRepo: vi.fn(async () => false) }));

import { POST } from "./route";
import { AppApiError, isAppConfigured } from "@/lib/github/app";
import { getOrgId } from "@/lib/db";
import { applyPracticeToRepo } from "@/lib/practices/apply";

const MINT = "Failed to mint an installation token for this org.";
const run = () =>
  POST(
    new Request("http://localhost/api/practices/apply", {
      method: "POST",
      body: JSON.stringify({ org: "acme", repo: "acme/web", practiceId: "agents-md" }),
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(isAppConfigured).mockReturnValue(true);
  requirePrWriteTarget.mockResolvedValue({ org: "acme", token: "t", parsed: { owner: "acme", repo: "web" } });
  vi.mocked(getOrgId).mockResolvedValue("org-1");
});

describe("POST /api/practices/apply: failures", () => {
  it("answers 503 when no App is configured", async () => {
    vi.mocked(isAppConfigured).mockReturnValue(false);
    expect((await run()).status).toBe(503);
    expect(applyPracticeToRepo).not.toHaveBeenCalled();
  });

  it("answers a reported 502 with the mint copy when the mint throws an AppApiError", async () => {
    const boom = new AppApiError("mint failed");
    requirePrWriteTarget.mockRejectedValue(boom);
    const res = await run();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: MINT });
    expect(respondError).toHaveBeenCalledWith(502, MINT, { cause: boom });
    expect(applyPracticeToRepo).not.toHaveBeenCalled();
  });

  it("answers a reported 500 and applies nothing when the org lookup throws", async () => {
    const boom = new Error("db down");
    vi.mocked(getOrgId).mockRejectedValue(boom);
    const res = await run();
    expect(res.status).toBe(500);
    expect(respondError).toHaveBeenCalledWith(500, "Failed to open the starter PR.", { cause: boom });
    expect(applyPracticeToRepo).not.toHaveBeenCalled();
  });

  it("answers an unexpected apply error with a reported 500 and the generic copy", async () => {
    const boom = new Error("kaboom");
    vi.mocked(applyPracticeToRepo).mockRejectedValue(boom);
    const res = await run();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Failed to open the starter PR." });
    expect(respondError).toHaveBeenCalledWith(500, "Failed to open the starter PR.", { cause: boom });
  });
});
