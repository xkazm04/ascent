// Pins the fleet PR-write tenant gate + batch invariants (practices-governance #2). This route fans
// destructive PR-writes across up to MAX_BATCH repos with ONE org installation token, so the
// load-bearing safety properties are: (a) a caller without org access is DENIED and NO PR-write is
// attempted for any repo; (b) a batch spanning two owners is refused (the same-org cross-tenant
// guard) with no writes; (c) the batch is capped at MAX_BATCH (over-cap → attempted=25, skipped=N-25)
// and the in-org happy path proceeds. The GitHub-App / DB / write boundaries are mocked so no real PR
// is opened — the test asserts the *gate*, never the network.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return Response.json(body, init);
    }
  },
}));

// Real GitHubError class (the route does `instanceof GitHubError`) + a real parseRepoUrl so the
// same-org check and owner extraction run against actual coordinates; fetchRepoContext is a stub.
// The class is defined INSIDE the factory because vi.mock is hoisted above top-level declarations.
vi.mock("@/lib/github/source", () => ({
  GitHubError: class GitHubError extends Error {
    constructor(
      public readonly code: string,
      message: string,
    ) {
      super(message);
      this.name = "GitHubError";
    }
  },
  parseRepoUrl: (input: string) => {
    const parts = String(input || "").split("/").filter(Boolean);
    if (parts.length < 2) return null;
    const [owner, repo] = parts;
    if (!/^[A-Za-z0-9_.-]+$/.test(owner!) || !/^[A-Za-z0-9_.-]+$/.test(repo!)) return null;
    return { owner, repo };
  },
  fetchRepoContext: vi.fn(async (ref: { owner: string; repo: string }) => ({
    fullName: `${ref.owner}/${ref.repo}`,
    primaryLanguage: "TypeScript",
  })),
}));

vi.mock("@/lib/practice-artifact", () => ({
  buildArtifact: vi.fn(() => ({
    branch: "ascent/seed-practice",
    path: "AGENTS.md",
    body: "# starter",
    commitMessage: "seed",
    prTitle: "Seed practice",
    prBody: "body",
  })),
}));

vi.mock("@/lib/github/write", () => ({
  openDraftPr: vi.fn(async () => ({ url: "https://github.com/pr/1", number: 1, reused: false })),
}));

// Real AppApiError class — the route's catch does `instanceof AppApiError` (defined inside the
// factory for the same hoisting reason as GitHubError above).
vi.mock("@/lib/github/app", () => ({
  AppApiError: class AppApiError extends Error {
    constructor(
      readonly status: number,
      readonly path: string,
      readonly body: string,
    ) {
      super(`GitHub App API ${status}`);
      this.name = "AppApiError";
    }
  },
  getInstallationToken: vi.fn(async () => "installation-token"),
  isAppConfigured: () => true,
}));

vi.mock("@/lib/db", () => ({
  getInstallationIdForOwner: vi.fn(async () => "inst-1"),
  getOrgId: vi.fn(async () => "org-1"),
  isDbConfigured: () => true,
  recordAudit: vi.fn(async () => {}),
}));

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(async () => ({ login: "alice" })),
  isAuthConfigured: () => true,
}));

vi.mock("@/lib/authz", () => ({ requireOrgAccess: vi.fn(async () => null) }));

import { POST } from "./route";
import { openDraftPr } from "@/lib/github/write";
import { fetchRepoContext, GitHubError } from "@/lib/github/source";
import { getInstallationToken } from "@/lib/github/app";
import { getInstallationIdForOwner, recordAudit } from "@/lib/db";
import { requireOrgAccess } from "@/lib/authz";

const mockOpenPr = vi.mocked(openDraftPr);
const mockFetchCtx = vi.mocked(fetchRepoContext);
const mockToken = vi.mocked(getInstallationToken);
const mockInstallId = vi.mocked(getInstallationIdForOwner);
const mockRecordAudit = vi.mocked(recordAudit);
const mockRequireOrgAccess = vi.mocked(requireOrgAccess);

function run(body: Record<string, unknown>) {
  return POST(
    new Request("http://localhost/api/practices/apply-batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireOrgAccess.mockResolvedValue(null);
  mockInstallId.mockResolvedValue("inst-1");
  mockToken.mockResolvedValue("installation-token");
  mockOpenPr.mockResolvedValue({ url: "https://github.com/pr/1", number: 1, reused: false } as never);
});

describe("POST /api/practices/apply-batch — tenant gate", () => {
  it("DENIES a caller without org access (403) and opens NO PR for any repo", async () => {
    // requireOrgAccess returns a denying Response — the cross-tenant write IDOR guard.
    mockRequireOrgAccess.mockResolvedValue(
      Response.json({ error: "You don't have access to this organization." }, { status: 403 }) as never,
    );

    const res = await run({ repos: ["victim/secret", "victim/other"], practiceId: "ci-gates" });

    expect(res.status).toBe(403);
    // No write side effect on the auth failure — not even a token mint or repo fetch.
    expect(mockToken).not.toHaveBeenCalled();
    expect(mockFetchCtx).not.toHaveBeenCalled();
    expect(mockOpenPr).not.toHaveBeenCalled();
    expect(mockRecordAudit).not.toHaveBeenCalled();
    // The gate was checked for the batch's single owner.
    expect(mockRequireOrgAccess).toHaveBeenCalledWith("victim");
  });

  it("denies an unauthenticated session (401) before any write", async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValueOnce(null as never);

    const res = await run({ repos: ["acme/app"], practiceId: "ci-gates" });

    expect(res.status).toBe(401);
    expect(mockOpenPr).not.toHaveBeenCalled();
  });

  it("returns 403 with no writes when the org has no installation", async () => {
    mockInstallId.mockResolvedValue(null);

    const res = await run({ repos: ["acme/app"], practiceId: "ci-gates" });

    expect(res.status).toBe(403);
    expect(mockToken).not.toHaveBeenCalled();
    expect(mockOpenPr).not.toHaveBeenCalled();
  });
});

describe("POST /api/practices/apply-batch — same-org (cross-tenant) guard", () => {
  it("rejects (400) a batch spanning two different owners — cross-tenant write refused", async () => {
    const res = await run({ repos: ["orgA/app", "orgB/app"], practiceId: "ci-gates" });

    expect(res.status).toBe(400);
    const json = await res.json();
    expect(String(json.error)).toMatch(/same org/i);
    // Refused before the gate / any write: a mixed-owner batch must never reach a token mint.
    expect(mockRequireOrgAccess).not.toHaveBeenCalled();
    expect(mockOpenPr).not.toHaveBeenCalled();
  });

  it("rejects (400) when no valid 'owner/name' coordinates are present", async () => {
    const res = await run({ repos: ["not-a-repo", "::::"], practiceId: "ci-gates" });
    expect(res.status).toBe(400);
    expect(mockOpenPr).not.toHaveBeenCalled();
  });
});

describe("POST /api/practices/apply-batch — MAX_BATCH cap + happy path", () => {
  it("caps a 30-repo batch at MAX_BATCH: attempted=25, skipped=5, exactly 25 PR-writes", async () => {
    const repos = Array.from({ length: 30 }, (_, i) => `acme/repo${i}`);

    const res = await run({ repos, practiceId: "ci-gates" });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.attempted).toBe(25);
    expect(json.skipped).toBe(5);
    expect(json.results).toHaveLength(25);
    expect(mockOpenPr).toHaveBeenCalledTimes(25);
  });

  it("authorized in-org happy path proceeds: all results ok, attempted=N, skipped=0", async () => {
    const res = await run({ repos: ["acme/app", "acme/api"], practiceId: "ci-gates" });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.attempted).toBe(2);
    expect(json.skipped).toBe(0);
    expect(json.results.every((r: { ok: boolean }) => r.ok)).toBe(true);
    expect(mockToken).toHaveBeenCalledTimes(1); // one token mint for the whole gated batch
    expect(mockOpenPr).toHaveBeenCalledTimes(2);
  });

  it("one repo throwing inside the pool yields {ok:false} for it while the others still succeed", async () => {
    mockOpenPr
      .mockResolvedValueOnce({ url: "u1", number: 1, reused: false } as never)
      .mockRejectedValueOnce(new GitHubError("UPSTREAM", "boom"))
      .mockResolvedValueOnce({ url: "u3", number: 3, reused: false } as never);

    const res = await run({ repos: ["acme/a", "acme/b", "acme/c"], practiceId: "ci-gates" });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.attempted).toBe(3);
    const ok = json.results.filter((r: { ok: boolean }) => r.ok);
    const bad = json.results.filter((r: { ok: boolean }) => !r.ok);
    expect(ok).toHaveLength(2); // one bad repo never aborts the batch
    expect(bad).toHaveLength(1);
    expect(bad[0].error).toBe("boom"); // GitHubError message surfaced per-repo
  });
});
