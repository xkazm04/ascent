// Failure paths of the preview route: a failed token mint is a reported 502 (never a silent
// token-less fetch that reads a private repo as "not found"), GitHub errors keep their mapped
// status, and anything else is a reported 500.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { respondError } = vi.hoisted(() => ({
  respondError: vi.fn((status: number, message: string, opts: { code?: string; headers?: Record<string, string> } = {}) =>
    Response.json(opts.code ? { error: message, code: opts.code } : { error: message }, { status, headers: opts.headers })),
}));
vi.mock("@/lib/api/respond", () => ({ respondError }));
vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return Response.json(body, init);
    }
  },
}));
vi.mock("@/lib/github/source", () => ({
  GitHubError: class GitHubError extends Error {
    constructor(public readonly code: string, message: string, readonly status?: number, readonly retryAfterSec?: number) {
      super(message);
    }
  },
  parseRepoUrl: (input: string) => {
    const [owner, repo] = String(input).split("/");
    return owner && repo ? { owner, repo } : null;
  },
  fetchRepoContext: vi.fn(),
}));
vi.mock("@/lib/api/github-status", () => ({
  githubErrorStatus: (e: { code: string }) => (e.code === "RATE_LIMITED" ? 429 : 502),
  githubErrorHeaders: (e: { code: string }) => (e.code === "RATE_LIMITED" ? { "retry-after": "30" } : undefined),
}));
vi.mock("@/lib/practices/artifact", () => ({ buildPracticeArtifact: vi.fn() }));
vi.mock("@/lib/practices/build-system", () => ({ withBuildSystem: vi.fn(async (_p: unknown, ctx: unknown) => ctx) }));
vi.mock("@/lib/db", () => ({ getInstallationIdForOwner: vi.fn() }));
vi.mock("@/lib/db/org-admission", () => ({ orgTracksRepo: vi.fn(async () => false) }));
vi.mock("@/lib/github/app", () => ({ getInstallationToken: vi.fn(), isAppConfigured: vi.fn(() => true) }));
vi.mock("@/lib/authz", () => ({ canMintInstallationToken: vi.fn(async () => true) }));

import { POST } from "./route";
import { fetchRepoContext, GitHubError } from "@/lib/github/source";
import { getInstallationIdForOwner } from "@/lib/db";
import { getInstallationToken } from "@/lib/github/app";
import { buildPracticeArtifact } from "@/lib/practices/artifact";

const MINT = "Failed to mint an installation token for this org.";
const run = () =>
  POST(
    new Request("http://localhost/api/practices/generate", {
      method: "POST",
      body: JSON.stringify({ org: "acme", repo: "acme/repo", practiceId: "agents-md" }),
    }),
  );

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(getInstallationIdForOwner).mockResolvedValue("inst-1");
  vi.mocked(getInstallationToken).mockResolvedValue("tok");
  vi.mocked(fetchRepoContext).mockResolvedValue({ fullName: "acme/repo" } as never);
  vi.mocked(buildPracticeArtifact).mockResolvedValue({ artifact: { path: "A", body: "b" }, house: null } as never);
});

describe("POST /api/practices/generate: failures", () => {
  it("answers a reported 502 when the installation lookup throws, and never fetches the repo", async () => {
    const boom = new Error("db down");
    vi.mocked(getInstallationIdForOwner).mockRejectedValue(boom);
    const res = await run();
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: MINT });
    expect(respondError).toHaveBeenCalledWith(502, MINT, { cause: boom });
    expect(fetchRepoContext).not.toHaveBeenCalled();
  });

  it("answers a reported 502 when the token mint throws, and never fetches the repo", async () => {
    const boom = new Error("github 500");
    vi.mocked(getInstallationToken).mockRejectedValue(boom);
    const res = await run();
    expect(res.status).toBe(502);
    expect(respondError).toHaveBeenCalledWith(502, MINT, { cause: boom });
    expect(fetchRepoContext).not.toHaveBeenCalled();
  });

  it("maps a throttle GitHubError to its status with retry-after", async () => {
    vi.mocked(fetchRepoContext).mockRejectedValue(new GitHubError("RATE_LIMITED", "slow down", 403));
    const res = await run();
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("30");
  });

  it("maps an UPSTREAM GitHubError to 502", async () => {
    vi.mocked(fetchRepoContext).mockRejectedValue(new GitHubError("UPSTREAM", "bad gateway"));
    const res = await run();
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ code: "UPSTREAM" });
  });

  it("answers an unexpected error with a reported 500", async () => {
    const boom = new Error("kaboom");
    vi.mocked(buildPracticeArtifact).mockRejectedValue(boom);
    const res = await run();
    expect(res.status).toBe(500);
    expect(respondError).toHaveBeenCalledWith(500, "Failed to generate the starter artifact.", { cause: boom });
  });
});
