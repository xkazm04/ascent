// Pins the single-repo PR-write tenant gate (practices-governance #2). /api/practices/apply opens a
// DRAFT PR (a WRITE) into a customer repo using the org installation token, so the load-bearing
// safety properties are: (a) a caller without org access is DENIED (the cross-tenant write IDOR
// guard) and NO PR-write / token mint happens; (b) an unauthenticated session is 401'd before any
// write; (c) a missing installation is 403'd; (d) the authorized happy path opens exactly one PR and
// audit-logs it; (e) the 409 "file already exists on base" AppApiError surfaces as 409 (the
// won't-overwrite-real-content guard). The GitHub-App / DB / write boundaries are mocked — no real PR.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return Response.json(body, init);
    }
  },
}));

// Real GitHubError class + real parseRepoUrl; fetchRepoContext stubbed. Class is defined INSIDE the
// factory because vi.mock is hoisted above top-level declarations.
vi.mock("@/lib/github/source", () => ({
  GitHubError: class GitHubError extends Error {
    constructor(
      public readonly code: string,
      message: string,
      readonly status?: number,
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

// Real AppApiError class (route catch does `instanceof AppApiError`), defined inside the factory.
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
import { fetchRepoContext } from "@/lib/github/source";
import { AppApiError, getInstallationToken } from "@/lib/github/app";
import { getInstallationIdForOwner, recordAudit } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { requireOrgAccess } from "@/lib/authz";

const mockOpenPr = vi.mocked(openDraftPr);
const mockFetchCtx = vi.mocked(fetchRepoContext);
const mockToken = vi.mocked(getInstallationToken);
const mockInstallId = vi.mocked(getInstallationIdForOwner);
const mockRecordAudit = vi.mocked(recordAudit);
const mockSession = vi.mocked(getSession);
const mockRequireOrgAccess = vi.mocked(requireOrgAccess);

function run(body: Record<string, unknown>) {
  return POST(
    new Request("http://localhost/api/practices/apply", {
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
  mockSession.mockResolvedValue({ login: "alice" } as never);
  mockOpenPr.mockResolvedValue({ url: "https://github.com/pr/1", number: 1, reused: false } as never);
});

describe("POST /api/practices/apply — tenant gate", () => {
  it("DENIES a caller without org access (403) and opens NO PR (no token mint / fetch / write)", async () => {
    mockRequireOrgAccess.mockResolvedValue(
      Response.json({ error: "You don't have access to this organization." }, { status: 403 }) as never,
    );

    const res = await run({ repo: "victim/secret", practiceId: "ci-gates" });

    expect(res.status).toBe(403);
    expect(mockToken).not.toHaveBeenCalled();
    expect(mockFetchCtx).not.toHaveBeenCalled();
    expect(mockOpenPr).not.toHaveBeenCalled();
    expect(mockRecordAudit).not.toHaveBeenCalled();
    expect(mockRequireOrgAccess).toHaveBeenCalledWith("victim");
  });

  it("denies an unauthenticated session (401) before any write", async () => {
    mockSession.mockResolvedValue(null as never);

    const res = await run({ repo: "acme/app", practiceId: "ci-gates" });

    expect(res.status).toBe(401);
    expect(mockOpenPr).not.toHaveBeenCalled();
  });

  it("returns 403 with no writes when the org has no installation", async () => {
    mockInstallId.mockResolvedValue(null);

    const res = await run({ repo: "acme/app", practiceId: "ci-gates" });

    expect(res.status).toBe(403);
    expect(mockToken).not.toHaveBeenCalled();
    expect(mockOpenPr).not.toHaveBeenCalled();
  });

  it("returns 400 with no writes for a malformed repo coordinate", async () => {
    const res = await run({ repo: "not-a-repo", practiceId: "ci-gates" });
    expect(res.status).toBe(400);
    expect(mockRequireOrgAccess).not.toHaveBeenCalled();
    expect(mockOpenPr).not.toHaveBeenCalled();
  });
});

describe("POST /api/practices/apply — authorized path + overwrite guard", () => {
  it("opens exactly one PR and audit-logs it on the authorized in-org happy path", async () => {
    const res = await run({ repo: "acme/app", practiceId: "ci-gates" });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.number).toBe(1);
    expect(mockToken).toHaveBeenCalledTimes(1);
    expect(mockOpenPr).toHaveBeenCalledTimes(1);
    expect(mockRecordAudit).toHaveBeenCalledTimes(1);
  });

  it("surfaces a 409 (file already exists on base) — the won't-overwrite-real-content guard", async () => {
    mockOpenPr.mockRejectedValue(new AppApiError(409, "/contents", "exists"));

    const res = await run({ repo: "acme/app", practiceId: "ci-gates" });

    expect(res.status).toBe(409);
    const json = await res.json();
    expect(String(json.error)).toMatch(/overwrite|already exists/i);
  });
});
