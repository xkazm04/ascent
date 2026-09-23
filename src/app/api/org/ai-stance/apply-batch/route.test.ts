// POST /api/org/ai-stance/apply-batch: admin-gated fleet write of AI_POLICY.md. Load-bearing:
//   (a) admin floor — a member is refused and NOT ONE PR is attempted;
//   (b) tenancy — every repo must belong to body.org; mixed-owner fails before any write;
//   (c) cap — 25 per run, deduped first, over-cap reported as skipped;
//   (d) isolation — one repo's failure never aborts the rest;
//   (e) 3-repo happy path — N results, one token mint, N openArtifactDraftPr calls.
// GitHub / DB / write boundaries are mocked: this asserts the gate, never the network.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return Response.json(body, init);
    }
  },
}));

const h = vi.hoisted(() => ({
  requireOrgRole: vi.fn(),
  getInstallationIdForOwner: vi.fn(),
  getInstallationToken: vi.fn(),
  openArtifactDraftPr: vi.fn(),
  getActiveOrgStance: vi.fn(),
  getOrgId: vi.fn(),
  resolveViewerLogin: vi.fn(),
  fetchRepoContext: vi.fn(),
}));

vi.mock("@/lib/github/source", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/github/source")>();
  return { ...actual, fetchRepoContext: h.fetchRepoContext };
});
vi.mock("@/lib/practices/apply", () => ({ openArtifactDraftPr: h.openArtifactDraftPr }));
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
  isAppConfigured: () => true,
  getInstallationToken: h.getInstallationToken,
}));
vi.mock("@/lib/db", () => ({
  isDbConfigured: () => true,
  getActiveOrgStance: h.getActiveOrgStance,
  getOrgId: h.getOrgId,
  getInstallationIdForOwner: h.getInstallationIdForOwner,
}));
vi.mock("@/lib/auth", () => ({ isAuthConfigured: () => true }));
vi.mock("@/lib/access", () => ({
  authGateEnabled: () => true,
  resolveViewerLogin: h.resolveViewerLogin,
}));
vi.mock("@/lib/authz", () => ({ requireOrgRole: h.requireOrgRole }));
// The REAL pr-route composer runs, so the installation lookup is asserted by the org it was asked for.

import { POST } from "./route";
import { GitHubError } from "@/lib/github/source";

const stance = {
  permittedTools: ["Claude Code"],
  permittedModels: [],
  noAiZones: [],
  reviewTiers: [],
  provenance: { requireTrailer: true, requireHumanApproval: false },
};
const storedRow = {
  id: "row",
  version: 2,
  status: "published" as const,
  stance,
  publishedBy: "alice",
  publishedAt: new Date("2026-08-12T00:00:00.000Z"),
  createdAt: new Date("2026-08-12T00:00:00.000Z"),
};

function run(body: Record<string, unknown>) {
  return POST(
    new Request("http://t/api/org/ai-stance/apply-batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.requireOrgRole.mockResolvedValue(null);
  h.getInstallationIdForOwner.mockImplementation(async (owner: string) => `inst-${owner}`);
  h.getInstallationToken.mockResolvedValue("installation-token");
  h.openArtifactDraftPr.mockImplementation(async (_t: string, ref: { owner: string; repo: string }) => ({
    url: `https://github.com/${ref.owner}/${ref.repo}/pull/1`,
    number: 1,
    reused: false,
  }));
  h.getActiveOrgStance.mockResolvedValue(storedRow);
  h.getOrgId.mockResolvedValue("org-1");
  h.resolveViewerLogin.mockResolvedValue("alice");
  h.fetchRepoContext.mockImplementation(async (ref: { owner: string; repo: string }) => ({
    fullName: `${ref.owner}/${ref.repo}`,
    name: ref.repo,
  }));
});

describe("POST /api/org/ai-stance/apply-batch — admin + tenancy", () => {
  it("DENIES a member (403) and opens NO PR", async () => {
    h.requireOrgRole.mockResolvedValue(
      Response.json({ error: "This action requires the admin role in this organization." }, { status: 403 }),
    );
    const res = await run({ org: "acme", repos: ["acme/a", "acme/b"] });
    expect(res.status).toBe(403);
    expect(h.requireOrgRole).toHaveBeenCalledWith("acme", "admin");
    expect(h.openArtifactDraftPr).not.toHaveBeenCalled();
    expect(h.getInstallationToken).not.toHaveBeenCalled();
  });

  it("401s an unsigned caller before any write", async () => {
    h.resolveViewerLogin.mockResolvedValue(null);
    const res = await run({ org: "acme", repos: ["acme/a"] });
    expect(res.status).toBe(401);
    expect(h.requireOrgRole).not.toHaveBeenCalled();
    expect(h.openArtifactDraftPr).not.toHaveBeenCalled();
  });

  it("guard: rejects (400) a mixed-owner batch before the admin gate", async () => {
    const res = await run({ org: "acme", repos: ["acme/a", "victim/secret"] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("All repos in a batch must belong to acme.");
    expect(h.requireOrgRole).not.toHaveBeenCalled();
    expect(h.openArtifactDraftPr).not.toHaveBeenCalled();
  });
});

describe("POST /api/org/ai-stance/apply-batch — 3 repos + cap + isolation", () => {
  it("opens exactly 3 PRs and returns 3 results", async () => {
    const res = await run({ org: "acme", repos: ["acme/a", "acme/b", "acme/c"] });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.attempted).toBe(3);
    expect(json.skipped).toBe(0);
    expect(json.results).toHaveLength(3);
    expect(json.results.every((r: { ok: boolean }) => r.ok)).toBe(true);
    expect(json.results.map((r: { repo: string }) => r.repo).sort()).toEqual(["acme/a", "acme/b", "acme/c"]);
    expect(h.requireOrgRole).toHaveBeenCalledWith("acme", "admin");
    expect(h.getInstallationIdForOwner.mock.calls).toEqual([["acme"]]);
    expect(h.getInstallationToken).toHaveBeenCalledTimes(1);
    expect(h.openArtifactDraftPr).toHaveBeenCalledTimes(3);
  });

  it("caps a 30-repo batch at 25: attempted=25, skipped=5", async () => {
    const repos = Array.from({ length: 30 }, (_, i) => `acme/repo${i}`);
    const res = await run({ org: "acme", repos });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.attempted).toBe(25);
    expect(json.skipped).toBe(5);
    expect(json.results).toHaveLength(25);
    expect(h.openArtifactDraftPr).toHaveBeenCalledTimes(25);
  });

  it("one repo failing yields {ok:false} for it while the rest still open", async () => {
    h.openArtifactDraftPr.mockImplementation(async (_t: string, ref: { owner: string; repo: string }) => {
      if (ref.repo === "b") throw new GitHubError("UPSTREAM", "boom");
      return { url: `https://github.com/${ref.owner}/${ref.repo}/pull/1`, number: 1, reused: false };
    });

    const res = await run({ org: "acme", repos: ["acme/a", "acme/b", "acme/c"] });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.results.filter((r: { ok: boolean }) => r.ok)).toHaveLength(2);
    const bad = json.results.filter((r: { ok: boolean }) => !r.ok);
    expect(bad).toHaveLength(1);
    expect(bad[0].repo).toBe("acme/b");
    expect(bad[0].error).toBe("boom");
  });

  it("dedupes case-insensitively before the cap", async () => {
    const res = await run({ org: "acme", repos: ["acme/api", "acme/api", "ACME/API", "acme/app"] });
    const json = await res.json();
    expect(json.attempted).toBe(2);
    expect(json.skipped).toBe(0);
    expect(h.openArtifactDraftPr).toHaveBeenCalledTimes(2);
  });

  it("409s when nothing is published — no writes", async () => {
    h.getActiveOrgStance.mockResolvedValue(null);
    const res = await run({ org: "acme", repos: ["acme/a", "acme/b", "acme/c"] });
    expect(res.status).toBe(409);
    expect(h.openArtifactDraftPr).not.toHaveBeenCalled();
  });
});
