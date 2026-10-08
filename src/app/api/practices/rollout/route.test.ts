// POST /api/practices/rollout — the re-convergence fan-out. Pinned here: a foreign coordinate fails
// the WHOLE call before any installation lookup (a partial apply would already have written into
// repositories), and the happy path mints once, for the gated org, through the pr-route composer.
// Council r2 robustness-4 added the refusal ladder (503, 401, 400, admin 403, the door's refusal) and
// the dedupe + cap; the failure paths are in route.degraded.test.ts, the GET in route.get.test.ts.

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
  isAppConfigured: vi.fn(() => true),
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
import { isAppConfigured } from "@/lib/github/app";
import { resolveViewerLogin } from "@/lib/access";
import { requireOrgRole } from "@/lib/authz";
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isAppConfigured).mockReturnValue(true);
  vi.mocked(resolveViewerLogin).mockResolvedValue("alice");
  vi.mocked(requireOrgRole).mockResolvedValue(null);
  vi.mocked(getInstallationIdForOwner).mockImplementation(async (owner: string) => `inst-${owner}`);
});

const ok = { org: "acme", practiceId: "ci-gates", mode: "behind", repos: ["acme/a"] };

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

describe("POST /api/practices/rollout — rejected entries", () => {
  // Council r3 robustness-7: an unparseable entry used to vanish from the answer.
  it("answers an unparseable entry as a rejected row, after the worker rows, and still opens the valid ones", async () => {
    const junk = "::::" + "x".repeat(300);
    const res = await run({ org: "acme", practiceId: "ci-gates", mode: "behind", repos: ["acme/a", junk, "acme/b"] });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.attempted).toBe(2);
    expect(json.results.map((r: { repo: string }) => r.repo)).toEqual(["acme/a", "acme/b", junk.slice(0, 200)]);
    expect(json.results[2]).toEqual({
      repo: junk.slice(0, 200),
      ok: false,
      error: "Not a GitHub repository (use owner/name or a github.com URL).",
    });
    expect(applyPracticeToRepo).toHaveBeenCalledTimes(2);
  });
});

describe("POST /api/practices/rollout — refusals, each before any write", () => {
  it("503 when the GitHub App is not configured", async () => {
    vi.mocked(isAppConfigured).mockReturnValue(false);
    expect((await run(ok)).status).toBe(503);
    expect(applyPracticeToRepo).not.toHaveBeenCalled();
  });

  it("401 for a signed-out caller", async () => {
    vi.mocked(resolveViewerLogin).mockResolvedValue(null);
    expect((await run(ok)).status).toBe(401);
    expect(requireOrgRole).not.toHaveBeenCalled();
  });

  it("400 for a bad body: no org, no practiceId, an unknown mode, no repos", async () => {
    for (const body of [
      { ...ok, org: "" },
      { ...ok, practiceId: undefined },
      { ...ok, mode: "everything" },
      { ...ok, repos: [] },
      { ...ok, repos: "acme/a" },
    ]) {
      expect((await run(body)).status).toBe(400);
    }
    expect(requireOrgRole).not.toHaveBeenCalled();
  });

  it("passes the admin gate's 403 through", async () => {
    vi.mocked(requireOrgRole).mockResolvedValue(Response.json({ error: "admins only" }, { status: 403 }) as never);
    const res = await run(ok);
    expect(res.status).toBe(403);
    expect(requireOrgRole).toHaveBeenCalledWith("acme", "admin");
    expect(getInstallationIdForOwner).not.toHaveBeenCalled();
  });

  it("400 when no repo in the batch parses", async () => {
    const res = await run({ ...ok, repos: ["not-a-repo", ""] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("No valid 'owner/name' repos in the batch.");
  });

  it("passes the door's refusal through: no installation is the 403, nothing written", async () => {
    vi.mocked(getInstallationIdForOwner).mockResolvedValue(null);
    const res = await run(ok);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toMatch(/isn't installed on acme/);
    expect(applyPracticeToRepo).not.toHaveBeenCalled();
  });
});

describe("POST /api/practices/rollout — dedupe, then the 25-repo cap", () => {
  it("writes each repo once, at most 25, and reports the excess as skipped", async () => {
    const repos = ["acme/r0", "ACME/r0", ...Array.from({ length: 29 }, (_, i) => `acme/r${i}`)];
    const res = await run({ ...ok, repos });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.attempted).toBe(25);
    expect(json.skipped).toBe(4);
    expect(applyPracticeToRepo).toHaveBeenCalledTimes(25);
    const written = vi.mocked(applyPracticeToRepo).mock.calls.map((c) => `${c[1].owner}/${c[1].repo}`.toLowerCase());
    expect(new Set(written).size).toBe(25);
  });
});
