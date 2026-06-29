// Pins the tenancy gate + the AppApiError→HTTP mapping of the playbook apply route
// (test-mastery 06-18 playbooks #1). This route mints an org installation token and writes a DRAFT
// PR into a customer repo, so the two safety gates it relies on — requireOrgAccess(org) and the
// parsed.owner === org match — and the error mapping must be regression-netted. The DB / GitHub /
// authz / write boundaries are mocked.
//
// 409 mapping (code-refactor 06-29 playbooks #1): this route now routes its catch through the shared
// `mapPrWriteError` (src/lib/github/pr-route.ts), which closed the prior drift — a base-file collision
// from openDraftPr's overwrite guard now surfaces as a 409 "won't overwrite" refusal, matching the
// sibling practices/apply + passport/pr routes (it previously dropped 409 to a 502 "write rejected").
// The 409 test below asserts that unified 409 behavior.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));

vi.mock("@/lib/db", () => ({
  applyPlaybook: vi.fn(async () => {}),
  getPlaybook: vi.fn(async () => ({ id: "pb_1", title: "Tighten CI", dimId: "d5", summary: "s", steps: ["lint"] })),
  getPlaybookOrgSlug: vi.fn(async () => "acme"),
  getInstallationIdForOwner: vi.fn(async () => "inst1"),
  isDbConfigured: () => true,
  // The route audits via the consolidated recordOrgAudit (resolve-orgId-then-record).
  recordOrgAudit: vi.fn(async () => true),
}));
vi.mock("@/lib/github/source", async () => {
  const actual = await vi.importActual<typeof import("@/lib/github/source")>("@/lib/github/source");
  return {
    ...actual, // real parseRepoUrl + GitHubError
    fetchRepoContext: vi.fn(async () => ({ fullName: "acme/repo" })),
  };
});
vi.mock("@/lib/github/write", () => ({ openDraftPr: vi.fn() }));
vi.mock("@/lib/github/app", async () => {
  const actual = await vi.importActual<typeof import("@/lib/github/app")>("@/lib/github/app");
  return {
    AppApiError: actual.AppApiError, // real class so `instanceof AppApiError` matches
    getInstallationToken: vi.fn(async () => "tok"),
    isAppConfigured: () => true,
  };
});
vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(async () => ({ login: "alice" })),
  isAuthConfigured: () => true,
}));
vi.mock("@/lib/authz", () => ({ requireOrgAccess: vi.fn(async () => null) }));
// playbook-brief is pure (no IO) — let the real implementation run.

import { POST } from "./route";
import { applyPlaybook, getPlaybookOrgSlug, recordOrgAudit } from "@/lib/db";
import { getInstallationToken, AppApiError } from "@/lib/github/app";
import { openDraftPr } from "@/lib/github/write";
import { requireOrgAccess } from "@/lib/authz";

const mockApply = vi.mocked(applyPlaybook);
const mockOrgSlug = vi.mocked(getPlaybookOrgSlug);
const mockAudit = vi.mocked(recordOrgAudit);
const mockToken = vi.mocked(getInstallationToken);
const mockDraftPr = vi.mocked(openDraftPr);
const mockRequireOrgAccess = vi.mocked(requireOrgAccess);

const ctx = { params: Promise.resolve({ id: "pb_1" }) };

function apply(repo: string) {
  return POST(
    new Request("http://localhost/api/org/playbooks/pb_1/apply", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ repo }),
    }),
    ctx,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockOrgSlug.mockResolvedValue("acme");
  mockRequireOrgAccess.mockResolvedValue(null);
  mockDraftPr.mockResolvedValue({ url: "https://github.com/acme/repo/pull/7", number: 7, branch: "b", reused: false });
});

describe("POST /api/org/playbooks/[id]/apply — tenancy gate", () => {
  it("DENIES a caller without org access and mints NO token / writes NO PR (cross-tenant write IDOR closed)", async () => {
    // The playbook belongs to org "acme"; requireOrgAccess refuses this caller.
    const denial = new Response(JSON.stringify({ error: "You don't have access to this organization." }), { status: 403 });
    mockRequireOrgAccess.mockResolvedValue(denial as unknown as Awaited<ReturnType<typeof requireOrgAccess>>);

    const res = await apply("acme/secret");

    expect(res.status).toBe(403);
    // The route must gate on the PLAYBOOK's org, not the caller-supplied repo.
    expect(mockRequireOrgAccess).toHaveBeenCalledWith("acme");
    // No token minted, no draft PR written, no adoption recorded.
    expect(mockToken).not.toHaveBeenCalled();
    expect(mockDraftPr).not.toHaveBeenCalled();
    expect(mockApply).not.toHaveBeenCalled();
  });

  it("rejects a repo whose owner is not the playbook's org with 400 and writes NO PR", async () => {
    const res = await apply("victimOrg/secret"); // owner !== "acme"
    expect(res.status).toBe(400);
    expect(mockToken).not.toHaveBeenCalled();
    expect(mockDraftPr).not.toHaveBeenCalled();
    expect(mockApply).not.toHaveBeenCalled();
  });
});

describe("POST /api/org/playbooks/[id]/apply — authorized happy path", () => {
  it("writes the draft PR for the in-org repo and records the adoption + audit", async () => {
    const res = await apply("acme/repo");

    expect(res.status).not.toBe(403);
    expect(mockToken).toHaveBeenCalledTimes(1);
    expect(mockDraftPr).toHaveBeenCalledTimes(1);
    // Writes into the caller-supplied in-org repo at the playbook docs path.
    const prArg = mockDraftPr.mock.calls[0][0];
    expect(prArg.owner).toBe("acme");
    expect(prArg.repo).toBe("repo");
    expect(prArg.path).toMatch(/^docs\/playbooks\/.+\.md$/);
    // Adoption mark + audit fire exactly once on success.
    expect(mockApply).toHaveBeenCalledTimes(1);
    expect(mockAudit).toHaveBeenCalledTimes(1);
    expect(mockAudit.mock.calls[0][0]).toBe("playbook.pr_opened");

    const json = (await res.json()) as { number: number };
    expect(json.number).toBe(7);
  });
});

describe("POST /api/org/playbooks/[id]/apply — 409 won't-overwrite mapping", () => {
  it("surfaces openDraftPr's 409 base-file collision as a 409 'won't overwrite' (unified with practices/apply via mapPrWriteError)", async () => {
    mockDraftPr.mockRejectedValue(
      new AppApiError(409, "docs/playbooks/tighten-ci.md", '"docs/playbooks/tighten-ci.md" already exists on main — refusing to overwrite it with a starter artifact.'),
    );

    const res = await apply("acme/repo");

    // Drift fixed (code-refactor 06-29): the 409 refusal now maps to 409 (was a 502 "write rejected"),
    // matching the sibling routes' shared mapper rather than the old per-route omission.
    expect(res.status).toBe(409);
    const json = (await res.json()) as { error: string };
    expect(json.error).toMatch(/overwrite|already exists/i);

    // The token WAS minted and the write WAS attempted (the collision is detected inside the write).
    expect(mockToken).toHaveBeenCalledTimes(1);
    expect(mockDraftPr).toHaveBeenCalledTimes(1);
    // But no adoption is recorded when the write failed.
    expect(mockApply).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("maps a 403 AppApiError (missing write scope) to 403 with the permissions hint", async () => {
    mockDraftPr.mockRejectedValue(new AppApiError(403, "/repos/acme/repo/pulls", "forbidden"));
    const res = await apply("acme/repo");
    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: string };
    expect(json.error).toMatch(/lacks contents\/PR write access/);
  });
});
