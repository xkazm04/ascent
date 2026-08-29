// Pins the fleet foundation-install gate + batch invariants (moonshot #35). This route fans a
// customer-repo WRITE across up to MAX_BATCH repos with ONE org installation token, so the
// load-bearing properties are: an admin floor with NO write attempted below it; a batch spanning two
// owners refused; duplicates deduped BEFORE the cap; and — the reason a fleet rollout is usable at all
// — one repo failing (or never having been scanned) leaving every other repo installed.
//
// Everything past the gate is mocked: no PR is opened and no network is touched.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return Response.json(body, init);
    }
  },
}));

vi.mock("@/lib/github/source", () => ({
  parseRepoUrl: (input: string) => {
    const parts = String(input || "").split("/").filter(Boolean);
    if (parts.length < 2) return null;
    const [owner, repo] = parts;
    if (!/^[A-Za-z0-9_.-]+$/.test(owner!) || !/^[A-Za-z0-9_.-]+$/.test(repo!)) return null;
    return { owner, repo };
  },
}));

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
}));

vi.mock("@/lib/github/pr-route", () => ({
  requirePrWriteContext: vi.fn(async () => ({ token: "installation-token" })),
}));

vi.mock("@/lib/db", () => ({
  isDbConfigured: () => true,
  getScanReportByCommit: vi.fn(async () => ({ repo: "acme/app" })),
  recordOrgAudit: vi.fn(async () => true),
}));

vi.mock("@/lib/auth", () => ({
  PUBLIC_ORG: "public",
  isAuthConfigured: () => true,
  requireSameOrigin: vi.fn(() => null),
  readableOrgForOwner: vi.fn(async (owner: string) => owner.toLowerCase()),
}));

vi.mock("@/lib/access", () => ({
  authGateEnabled: () => true,
  resolveViewerLogin: vi.fn(async () => "alice"),
}));

vi.mock("@/lib/authz", () => ({ requireOrgRole: vi.fn(async () => null) }));

vi.mock("@/lib/standard", () => ({ buildFoundation: vi.fn(() => [{ path: ".ai/manifest.yaml", body: "x" }]) }));

vi.mock("@/lib/standard/pr", () => ({
  openFoundationPrBatch: vi.fn(async (input: { owner: string; repos: Array<{ name: string }> }) =>
    input.repos.map((r) => ({ repo: `${input.owner}/${r.name}`, ok: true, url: "https://gh/pr/1", number: 1 })),
  ),
}));

import { POST } from "./route";
import { requireOrgRole } from "@/lib/authz";
import { readableOrgForOwner, requireSameOrigin } from "@/lib/auth";
import { getScanReportByCommit, recordOrgAudit } from "@/lib/db";
import { requirePrWriteContext } from "@/lib/github/pr-route";
import { openFoundationPrBatch } from "@/lib/standard/pr";

const mockRole = vi.mocked(requireOrgRole);
const mockOrgForOwner = vi.mocked(readableOrgForOwner);
const mockSameOrigin = vi.mocked(requireSameOrigin);
const mockReport = vi.mocked(getScanReportByCommit);
const mockAudit = vi.mocked(recordOrgAudit);
const mockCtx = vi.mocked(requirePrWriteContext);
const mockBatch = vi.mocked(openFoundationPrBatch);

function run(body: Record<string, unknown>) {
  return POST(
    new Request("http://localhost/api/report/foundation/pr-batch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRole.mockResolvedValue(null);
  mockSameOrigin.mockReturnValue(null);
  mockOrgForOwner.mockImplementation(async (owner: string) => owner.toLowerCase());
  mockCtx.mockResolvedValue({ token: "installation-token" } as never);
  mockReport.mockResolvedValue({ repo: "acme/app" } as never);
  mockBatch.mockImplementation(async (input) =>
    input.repos.map((r) => ({ repo: `${input.owner}/${r.name}`, ok: true, url: "https://gh/pr/1", number: 1 })),
  );
});

describe("tenant gate", () => {
  it("DENIES below the admin floor and attempts NO write", async () => {
    mockRole.mockResolvedValue(
      Response.json({ error: "This action requires the admin role." }, { status: 403 }) as never,
    );
    const res = await run({ org: "victim", repos: ["victim/secret", "victim/other"] });
    expect(res.status).toBe(403);
    expect(mockRole).toHaveBeenCalledWith("victim", "admin");
    expect(mockCtx).not.toHaveBeenCalled();
    expect(mockBatch).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("refuses a batch spanning two owners, before any gate or write", async () => {
    const res = await run({ repos: ["acme/app", "other/api"] });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("same org") });
    expect(mockRole).not.toHaveBeenCalled();
    expect(mockBatch).not.toHaveBeenCalled();
  });

  it("refuses a caller-supplied org that disagrees with the repos' real owner", async () => {
    // The gate is derived from the REPO OWNER; a body `org` may only agree with it, never widen it.
    const res = await run({ org: "attacker", repos: ["victim/secret"] });
    expect(res.status).toBe(403);
    expect(mockRole).not.toHaveBeenCalled();
    expect(mockBatch).not.toHaveBeenCalled();
  });

  it("refuses a public (non-org-owned) repo", async () => {
    mockOrgForOwner.mockResolvedValue("public");
    const res = await run({ repos: ["someone/oss"] });
    expect(res.status).toBe(403);
    expect(mockBatch).not.toHaveBeenCalled();
  });

  it("refuses a cross-origin POST before anything else", async () => {
    mockSameOrigin.mockReturnValue(Response.json({ error: "cross-origin" }, { status: 403 }) as never);
    const res = await run({ repos: ["acme/app"] });
    expect(res.status).toBe(403);
    expect(mockRole).not.toHaveBeenCalled();
  });

  it("rejects an empty/absent repo list", async () => {
    expect((await run({ org: "acme" })).status).toBe(400);
    expect((await run({ org: "acme", repos: [] })).status).toBe(400);
  });
});

describe("batch semantics", () => {
  it("dedupes repeated repos BEFORE the cap", async () => {
    const res = await run({ repos: ["acme/app", "acme/app", "ACME/App", "acme/api"] });
    expect(res.status).toBe(200);
    expect(mockBatch.mock.calls[0]![0]!.repos.map((r) => r.name)).toEqual(["app", "api"]);
    expect(await res.json()).toMatchObject({ attempted: 2, skipped: 0 });
  });

  it("caps the batch at 25 and reports the remainder as skipped", async () => {
    const repos = Array.from({ length: 30 }, (_, i) => `acme/r${i}`);
    const body = await (await run({ repos })).json();
    expect(body.attempted).toBe(25);
    expect(body.skipped).toBe(5);
  });

  it("a repo with no saved scan is ok:false and does NOT abort the others", async () => {
    mockReport.mockImplementation(async (_owner: string, repo: string) =>
      repo === "api" ? null : ({ repo } as never),
    );
    const body = await (await run({ repos: ["acme/app", "acme/api", "acme/web"] })).json();
    const byRepo = Object.fromEntries(body.results.map((r: { repo: string; ok: boolean }) => [r.repo, r.ok]));
    expect(byRepo).toEqual({ "acme/app": true, "acme/api": false, "acme/web": true });
    expect(body.results.find((r: { repo: string }) => r.repo === "acme/api").error).toMatch(/No saved scan/);
    // The unscanned repo was never handed to the fan-out at all.
    expect(mockBatch.mock.calls[0]![0]!.repos.map((r) => r.name)).toEqual(["app", "web"]);
  });

  it("one repo failing in the fan-out leaves the others ok:true", async () => {
    mockBatch.mockImplementation(async (input) =>
      input.repos.map((r) => ({ repo: `${input.owner}/${r.name}`, ok: r.name !== "api", error: r.name === "api" ? "boom" : undefined })),
    );
    const res = await run({ repos: ["acme/app", "acme/api"] });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results.map((r: { ok: boolean }) => r.ok)).toEqual([true, false]);
  });
});

describe("audit", () => {
  it("writes one foundation.pr_opened per opened repo PLUS one foundation.batch_opened", async () => {
    mockReport.mockImplementation(async (_owner: string, repo: string) =>
      repo === "api" ? null : ({ repo } as never),
    );
    await run({ repos: ["acme/app", "acme/api", "acme/web"] });
    const actions = mockAudit.mock.calls.map((c) => c[0]);
    expect(actions).toEqual(["foundation.pr_opened", "foundation.pr_opened", "foundation.batch_opened"]);
    // The batch row's counts are honest: 3 attempted, 2 opened, 1 failed (the unscanned repo).
    expect(mockAudit.mock.calls[2]![2]).toMatchObject({ repos: 3, opened: 2, failed: 1, skipped: 0 });
    // Every row is org-scoped to the RESOLVED org, never to a caller-supplied one.
    expect(mockAudit.mock.calls.every((c) => c[1] === "acme")).toBe(true);
  });
});
