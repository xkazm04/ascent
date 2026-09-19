// G7-24. This route fans DRAFT-PR WRITES across up to MAX_BATCH real customer repos with one org
// installation token, so the load-bearing properties are the bounds, not the happy path:
//   (a) the ADMIN floor — a plain member is refused and NOT ONE PR is attempted (the practices batch
//       was tightened to admin today; the two must never drift);
//   (b) tenancy — a repo outside the playbook's org fails the whole batch before any write;
//   (c) the CAP — 25 per run, deduped case-insensitively first, over-cap reported as `skipped`;
//   (d) isolation — one repo's failure never aborts the rest.
//   (e) dry-run — `dryRun: true` returns `{ repos, starter, skipped }` and never calls
//       applyPlaybookToRepo (no token mint, no PRs). Admin / tenancy / cap still run.
// The GitHub App / DB / write boundaries are mocked: this asserts the gate, never the network.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return Response.json(body, init);
    }
  },
}));

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
  fetchRepoContext: vi.fn(async (ref: { owner: string; repo: string }) => ({ fullName: `${ref.owner}/${ref.repo}` })),
}));

vi.mock("@/lib/github/write", () => ({
  openDraftPr: vi.fn(async () => ({ url: "https://github.com/pr/1", number: 1, reused: false })),
}));

vi.mock("@/lib/org/playbook-apply", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/org/playbook-apply")>();
  return {
    ...actual,
    applyPlaybookToRepo: vi.fn(actual.applyPlaybookToRepo),
  };
});

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
  applyPlaybook: vi.fn(async () => true),
  getPlaybook: vi.fn(async () => ({
    id: "pb_1",
    title: "Tighten CI",
    dimId: "D2",
    summary: "s",
    steps: ["lint"],
    createdBy: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    version: 1,
    updatedAt: "2026-01-01T00:00:00.000Z",
  })),
  getPlaybookOrgSlug: vi.fn(async () => "acme"),
  getInstallationIdForOwner: vi.fn(async () => "inst-1"),
  isDbConfigured: () => true,
  recordOrgAudit: vi.fn(async () => true),
}));

vi.mock("@/lib/auth", () => ({ getSession: vi.fn(async () => ({ login: "alice" })), isAuthConfigured: () => true }));
vi.mock("@/lib/authz", () => ({ requireOrgAccess: vi.fn(async () => null), requireOrgRole: vi.fn(async () => null) }));

import { POST } from "./route";
import { openDraftPr } from "@/lib/github/write";
import { GitHubError } from "@/lib/github/source";
import { getInstallationToken } from "@/lib/github/app";
import { applyPlaybook, getInstallationIdForOwner } from "@/lib/db";
import { requireOrgRole } from "@/lib/authz";
import { applyPlaybookToRepo } from "@/lib/org/playbook-apply";
import { playbookStarterFile } from "@/lib/org/playbook-brief";
import { dimShort } from "@/lib/ui";

const mockOpenPr = vi.mocked(openDraftPr);
const mockToken = vi.mocked(getInstallationToken);
const mockRole = vi.mocked(requireOrgRole);
const mockApply = vi.mocked(applyPlaybookToRepo);

const PLAYBOOK_BRIEF = {
  title: "Tighten CI",
  dimId: "D2",
  summary: "s",
  steps: ["lint"],
  version: 1,
};

function run(body: Record<string, unknown>) {
  return POST(
    new Request("http://localhost/api/org/playbooks/pb_1/apply-batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: "pb_1" }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRole.mockResolvedValue(null as never);
  mockToken.mockResolvedValue("installation-token");
  mockOpenPr.mockResolvedValue({ url: "https://github.com/pr/1", number: 1, reused: false } as never);
});

describe("POST /api/org/playbooks/[id]/apply-batch — the admin gate", () => {
  it("resolves the org FROM the playbook and requires the ADMIN role", async () => {
    await run({ repos: ["acme/app"] });
    expect(mockRole).toHaveBeenCalledWith("acme", "admin");
  });

  it("DENIES a plain member (403) and opens NO PR, mints NO token", async () => {
    mockRole.mockResolvedValue(
      Response.json({ error: "This action requires the admin role in this organization." }, { status: 403 }) as never,
    );

    const res = await run({ repos: ["acme/app", "acme/api"] });

    expect(res.status).toBe(403);
    expect(mockToken).not.toHaveBeenCalled();
    expect(mockOpenPr).not.toHaveBeenCalled();
    expect(vi.mocked(applyPlaybook)).not.toHaveBeenCalled();
  });

  it("denies an unauthenticated caller (401) before any write", async () => {
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValueOnce(null as never);

    const res = await run({ repos: ["acme/app"] });

    expect(res.status).toBe(401);
    expect(mockOpenPr).not.toHaveBeenCalled();
  });
});

describe("POST /api/org/playbooks/[id]/apply-batch — tenancy", () => {
  it("rejects (400) a repo outside the playbook's org, with NO partial rollout", async () => {
    const res = await run({ repos: ["acme/app", "victim/secret"] });

    expect(res.status).toBe(400);
    expect(String((await res.json()).error)).toMatch(/must belong to acme/i);
    expect(mockOpenPr).not.toHaveBeenCalled();
  });

  it("rejects (400) an unparseable coordinate and an empty batch", async () => {
    expect((await run({ repos: ["::::"] })).status).toBe(400);
    expect((await run({ repos: [] })).status).toBe(400);
    expect(mockOpenPr).not.toHaveBeenCalled();
  });
});

describe("POST /api/org/playbooks/[id]/apply-batch — the bound", () => {
  it("caps a 30-repo batch at 25: attempted=25, skipped=5, exactly 25 PR-writes", async () => {
    const repos = Array.from({ length: 30 }, (_, i) => `acme/repo${i}`);

    const res = await run({ repos });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.attempted).toBe(25);
    expect(json.skipped).toBe(5);
    expect(json.results).toHaveLength(25);
    expect(mockOpenPr).toHaveBeenCalledTimes(25);
  });

  it("dedupes case-insensitively BEFORE the cap — one repo, one worker, no same-branch race", async () => {
    const res = await run({ repos: ["acme/api", "acme/api", "ACME/API", "acme/app"] });

    const json = await res.json();
    expect(json.attempted).toBe(2);
    expect(json.skipped).toBe(0);
    expect(mockOpenPr).toHaveBeenCalledTimes(2);
  });

  it("mints ONE token for the whole gated batch and records adoption per repo", async () => {
    const res = await run({ repos: ["acme/app", "acme/api"] });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.results.every((r: { ok: boolean }) => r.ok)).toBe(true);
    expect(mockToken).toHaveBeenCalledTimes(1);
    expect(vi.mocked(applyPlaybook)).toHaveBeenCalledTimes(2);
  });

  it("one repo failing yields {ok:false} for it while the rest still open", async () => {
    mockOpenPr
      .mockResolvedValueOnce({ url: "u1", number: 1, reused: false } as never)
      .mockRejectedValueOnce(new GitHubError("UPSTREAM", "boom"))
      .mockResolvedValueOnce({ url: "u3", number: 3, reused: false } as never);

    const res = await run({ repos: ["acme/a", "acme/b", "acme/c"] });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.results.filter((r: { ok: boolean }) => r.ok)).toHaveLength(2);
    const bad = json.results.filter((r: { ok: boolean }) => !r.ok);
    expect(bad).toHaveLength(1);
    expect(bad[0].error).toBe("boom");
    // Only real PRs record an adoption mark.
    expect(vi.mocked(applyPlaybook)).toHaveBeenCalledTimes(2);
  });
});

describe("POST /api/org/playbooks/[id]/apply-batch — dry-run", () => {
  it("returns starter + repos + skipped and never calls applyPlaybookToRepo", async () => {
    const res = await run({ repos: ["acme/app", "acme/api"], dryRun: true });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.repos).toEqual(["acme/app", "acme/api"]);
    expect(json.skipped).toBe(0);
    expect(json.starter).toBe(playbookStarterFile(PLAYBOOK_BRIEF, dimShort("D2")));
    expect(json.starter).toContain("**D2 · Testing** v1,");
    expect(json.results).toBeUndefined();
    expect(mockApply).not.toHaveBeenCalled();
    expect(mockToken).not.toHaveBeenCalled();
    expect(mockOpenPr).not.toHaveBeenCalled();
    expect(vi.mocked(applyPlaybook)).not.toHaveBeenCalled();
    expect(vi.mocked(getInstallationIdForOwner)).not.toHaveBeenCalled();
  });

  it("still caps at 25: 30 unique repos → repos.length 25, skipped 5, zero writes", async () => {
    const repos = Array.from({ length: 30 }, (_, i) => `acme/repo${i}`);

    const res = await run({ repos, dryRun: true });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.repos).toHaveLength(25);
    expect(json.skipped).toBe(5);
    expect(json.starter).toBe(playbookStarterFile(PLAYBOOK_BRIEF, dimShort("D2")));
    expect(mockApply).not.toHaveBeenCalled();
    expect(mockToken).not.toHaveBeenCalled();
    expect(mockOpenPr).not.toHaveBeenCalled();
  });

  it("still requires admin — a member gets 403 and no starter bytes", async () => {
    mockRole.mockResolvedValue(
      Response.json({ error: "This action requires the admin role in this organization." }, { status: 403 }) as never,
    );

    const res = await run({ repos: ["acme/app"], dryRun: true });

    expect(res.status).toBe(403);
    expect((await res.json()).starter).toBeUndefined();
    expect(mockApply).not.toHaveBeenCalled();
    expect(mockToken).not.toHaveBeenCalled();
  });

  it("still refuses a foreign repo before returning starter", async () => {
    const res = await run({ repos: ["acme/app", "victim/secret"], dryRun: true });

    expect(res.status).toBe(400);
    expect(String((await res.json()).error)).toMatch(/must belong to acme/i);
    expect(mockApply).not.toHaveBeenCalled();
  });

  it("dryRun: false keeps the write path (opens PRs)", async () => {
    const res = await run({ repos: ["acme/app"], dryRun: false });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.results).toHaveLength(1);
    expect(json.results[0].ok).toBe(true);
    expect(json.starter).toBeUndefined();
    expect(mockApply).toHaveBeenCalledTimes(1);
    expect(mockOpenPr).toHaveBeenCalledTimes(1);
  });
});
