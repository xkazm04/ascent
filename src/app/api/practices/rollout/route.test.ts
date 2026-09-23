// POST /api/practices/rollout — the re-convergence fan-out. Pinned here: a foreign coordinate fails
// the WHOLE call before any installation lookup (a partial apply would already have written into
// repositories), and the happy path mints once, for the gated org, through the pr-route composer.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return Response.json(body, init);
    }
  },
}));
vi.mock("@/lib/github/app", () => ({
  AppApiError: class AppApiError extends Error {},
  getInstallationToken: vi.fn(async () => "installation-token"),
  isAppConfigured: () => true,
}));
vi.mock("@/lib/db", () => ({
  getInstallationIdForOwner: vi.fn(async (owner: string) => `inst-${owner}`),
  getOrgId: vi.fn(async () => "org-1"),
  isDbConfigured: () => true,
  recordAudit: vi.fn(async () => {}),
}));
vi.mock("@/lib/db/practice-adoption", () => ({
  listBehindRepos: vi.fn(async () => ({ latestVersion: 3, fromVersion: 2, repos: [] })),
  listDriftedRepos: vi.fn(async () => ({ drifted: [], removed: [] })),
}));
vi.mock("@/lib/practices/apply", () => ({
  applyPracticeToRepo: vi.fn(async (_t: string, ref: { owner: string; repo: string }) => ({
    kind: "opened",
    ctx: { fullName: `${ref.owner}/${ref.repo}` },
    pr: { url: `https://github.com/${ref.owner}/${ref.repo}/pull/1`, reused: false },
  })),
}));
vi.mock("@/lib/auth", () => ({ isAuthConfigured: () => true }));
vi.mock("@/lib/access", () => ({ authGateEnabled: () => true, resolveViewerLogin: vi.fn(async () => "alice") }));
vi.mock("@/lib/authz", () => ({ requireOrgAccess: vi.fn(async () => null), requireOrgRole: vi.fn(async () => null) }));

import { POST } from "./route";
import { getInstallationIdForOwner } from "@/lib/db";
import { applyPracticeToRepo } from "@/lib/practices/apply";

function run(body: Record<string, unknown>) {
  return POST(
    new Request("http://localhost/api/practices/rollout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => vi.clearAllMocks());

describe("POST /api/practices/rollout — tenancy", () => {
  it("guard: a foreign coordinate refuses the whole call (403) before any lookup or write", async () => {
    const res = await run({ org: "acme", practiceId: "ci-gates", mode: "behind", repos: ["acme/a", "victim/b"] });
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("Not repositories of acme: victim/b.");
    expect(getInstallationIdForOwner).not.toHaveBeenCalled();
    expect(applyPracticeToRepo).not.toHaveBeenCalled();
  });

  it("mints once, for the gated org, and writes every in-org repo", async () => {
    const res = await run({ org: "Acme", practiceId: "ci-gates", mode: "behind", repos: ["acme/a", "ACME/b"] });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.results.map((r: { repo: string }) => r.repo)).toEqual(["acme/a", "acme/b"]);
    expect(vi.mocked(getInstallationIdForOwner).mock.calls).toEqual([["acme"]]);
    expect(applyPracticeToRepo).toHaveBeenCalledTimes(2);
  });
});
