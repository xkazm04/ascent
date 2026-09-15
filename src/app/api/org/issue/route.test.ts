// Pins the issue-write tenant gate. /api/org/issue files a GitHub issue (a WRITE) into a customer
// repo using the org installation token, so the load-bearing safety properties mirror
// practices/apply: (a) a caller without org access is DENIED and NO token mint / write happens (the
// cross-tenant write IDOR guard) at the ADMIN bar this customer-repo write requires — the same bar
// /api/report/passport/pr holds; (b) an unauthenticated session is 401'd before any write; (c) a
// missing installation is 403'd; (d) the authorized happy path files exactly one issue, stamps the
// requesting user into the body, and audit-logs it; (e) a 410 (issues disabled) AppApiError surfaces
// as 410 with a human hint. GitHub-App / DB boundaries are mocked — no real issue.

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

vi.mock("@/lib/github/issues", () => ({
  createRepoIssue: vi.fn(async () => ({ number: 7, url: "https://github.com/acme/app/issues/7", reused: false })),
  passportBlockerMarker: (id: string) => `<!-- ascent:passport-blocker:${id} -->`,
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
  recordAudit: vi.fn(async () => true),
}));

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(async () => ({ login: "alice" })),
  isAuthConfigured: () => true,
}));

vi.mock("@/lib/authz", () => ({ requireOrgRole: vi.fn(async () => null) }));

import { POST } from "./route";
import { createRepoIssue } from "@/lib/github/issues";
import { AppApiError, getInstallationToken } from "@/lib/github/app";
import { getInstallationIdForOwner, recordAudit } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { requireOrgRole } from "@/lib/authz";

const mockCreate = vi.mocked(createRepoIssue);
const mockToken = vi.mocked(getInstallationToken);
const mockInstallId = vi.mocked(getInstallationIdForOwner);
const mockRecordAudit = vi.mocked(recordAudit);
const mockSession = vi.mocked(getSession);
const mockRequireOrgRole = vi.mocked(requireOrgRole);

function run(body: Record<string, unknown>) {
  return POST(
    new Request("http://localhost/api/org/issue", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireOrgRole.mockResolvedValue(null);
  mockInstallId.mockResolvedValue("inst-1");
  mockToken.mockResolvedValue("installation-token");
  mockSession.mockResolvedValue({ login: "alice" } as never);
  mockCreate.mockResolvedValue({ number: 7, url: "https://github.com/acme/app/issues/7", reused: false });
});

describe("POST /api/org/issue — tenant gate", () => {
  it("DENIES a caller without org access (403) and files NOTHING (no token mint / write / audit)", async () => {
    mockRequireOrgRole.mockResolvedValue(
      Response.json({ error: "You don't have access to this organization." }, { status: 403 }) as never,
    );

    const res = await run({ repo: "victim/secret", title: "x", body: "y" });

    expect(res.status).toBe(403);
    expect(mockToken).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockRecordAudit).not.toHaveBeenCalled();
    expect(mockRequireOrgRole).toHaveBeenCalledWith("victim", "admin");
  });

  it("denies an unauthenticated session (401) before any write", async () => {
    mockSession.mockResolvedValue(null as never);

    const res = await run({ repo: "acme/app", title: "x", body: "y" });

    expect(res.status).toBe(401);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns 403 with no writes when the org has no installation", async () => {
    mockInstallId.mockResolvedValue(null);

    const res = await run({ repo: "acme/app", title: "x", body: "y" });

    expect(res.status).toBe(403);
    expect(mockToken).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns 400 with no writes for a malformed repo coordinate or missing title", async () => {
    expect((await run({ repo: "not-a-repo", title: "x" })).status).toBe(400);
    expect((await run({ repo: "acme/app", title: "   " })).status).toBe(400);
    expect(mockRequireOrgRole).not.toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe("POST /api/org/issue — authorized path", () => {
  it("files exactly one issue, stamps the requester into the body, and audit-logs it", async () => {
    const res = await run({ repo: "acme/app", title: "Zero observability", body: "Details." });

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.number).toBe(7);
    expect(json.url).toContain("/issues/7");
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const [, owner, repo, issue] = mockCreate.mock.calls[0]!;
    expect(`${owner}/${repo}`).toBe("acme/app");
    expect(issue.body).toContain("Details.");
    expect(issue.body).toContain("@alice");
    expect(mockRecordAudit).toHaveBeenCalledTimes(1);
    expect(mockRecordAudit).toHaveBeenCalledWith(
      "issue.create",
      expect.objectContaining({ repo: "acme/app", number: 7 }),
      expect.objectContaining({ actorId: "alice" }),
    );
  });

  it("surfaces 410 with a human hint when issues are disabled on the repo", async () => {
    mockCreate.mockRejectedValue(new AppApiError(410, "/repos/acme/app/issues", "gone"));

    const res = await run({ repo: "acme/app", title: "x", body: "y" });

    expect(res.status).toBe(410);
    const json = await res.json();
    expect(String(json.error)).toMatch(/disabled/i);
  });
});

// Direction 7 — the ADMIN bar. Writing into a customer repo on the org's installation token is the
// same class of act as the passport PR writer, which requires admin; this route used to gate at
// MEMBER (requireOrgAccess) while its own header comment claimed ownership. The gate is simulated
// here by a role-aware fake of requireOrgRole, so the test pins the ROLE the route asks for rather
// than merely that it calls something.
const ROLE_RANK: Record<string, number> = { viewer: 1, member: 2, admin: 3, owner: 4 };
function gateAs(role: string) {
  mockRequireOrgRole.mockImplementation(async (_org: string, min) =>
    ROLE_RANK[role]! >= ROLE_RANK[min]!
      ? null
      : (Response.json({ error: `This action requires the ${min} role.` }, { status: 403 }) as never),
  );
}

describe("POST /api/org/issue — role bar", () => {
  it("403s a MEMBER and writes nothing", async () => {
    gateAs("member");

    const res = await run({ repo: "acme/app", title: "x", body: "y" });

    expect(res.status).toBe(403);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockToken).not.toHaveBeenCalled();
  });

  it("lets an ADMIN through (200)", async () => {
    gateAs("admin");

    const res = await run({ repo: "acme/app", title: "x", body: "y" });

    expect(res.status).toBe(200);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/org/issue — idempotency", () => {
  it("passes a marker minted from findingId, not caller text, into the writer", async () => {
    await run({ repo: "acme/app", title: "x", body: "y", findingId: "auto.self-verify-gaps" });

    const [, , , issue] = mockCreate.mock.calls[0]!;
    expect(issue.marker).toBe("<!-- ascent:passport-blocker:auto.self-verify-gaps -->");
  });

  it("REFUSES a findingId that could break out of the HTML comment (no marker, still files)", async () => {
    await run({ repo: "acme/app", title: "x", body: "y", findingId: "evil --><script>x</script>" });

    const [, , , issue] = mockCreate.mock.calls[0]!;
    expect(issue.marker).toBeUndefined();
  });

  it("returns { reused: true } and records NO issue.create audit when the issue already exists", async () => {
    mockCreate.mockResolvedValue({ number: 7, url: "https://github.com/acme/app/issues/7", reused: true });

    const res = await run({ repo: "acme/app", title: "x", body: "y", findingId: "auto.self-verify-gaps" });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ reused: true, number: 7 });
    expect(mockRecordAudit).not.toHaveBeenCalled();
  });

  it("files (and audits) with no findingId — the un-deduped caller keeps working", async () => {
    const res = await run({ repo: "acme/app", title: "x", body: "y" });

    expect(res.status).toBe(200);
    expect((await res.json()).reused).toBe(false);
    expect(mockRecordAudit).toHaveBeenCalledTimes(1);
  });
});
