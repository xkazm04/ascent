// Integration test for the `.ai/` conformance ingest route (POST /api/report/conformance).
//
// This endpoint takes SELF-ATTESTED numbers from a repo's own doctor and writes them onto the
// Repository row that every org-dashboard aggregate reads. It had no direct test, and it carries three
// separately load-bearing behaviors:
//
//  1. AUTH — an ORG-SCOPED API token (askl_…, telemetry:write), an interactive org owner, or the
//     legacy deployment-wide CI token. The org token must be bound to the org being written: a token
//     for org A may not post org B's score (the G2-02 finding). The legacy shared token stays
//     accepted for back-compat unless CONFORMANCE_INGEST_STRICT is set, and it must still be an EXACT
//     match against a CONFIGURED token: if the deployment sets no token, no bearer may authenticate,
//     and the org gate must still run. A denied caller must never reach the write — this is a
//     cross-tenant write, not just a read.
//  2. CLAMPING — the post-security-finding bound on the self-attested values. Without it a buggy or
//     hostile reporter persists score=999999 (or a negative) and poisons every aggregate downstream.
//     It must hold on BOTH auth paths, the CI-token one included.
//  3. recorded:false — the repo isn't watched under this org yet. That is a 200 with recorded:false,
//     NOT an error, and the distinction is what tells a maintainer to watch the repo first.
//
// Boundaries are mocked so we can assert exactly when (and with what) the write fires.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class extends Response {
    static json(body: unknown, init?: ResponseInit) {
      const headers = new Headers(init?.headers);
      if (!headers.has("content-type")) headers.set("content-type", "application/json");
      return new Response(JSON.stringify(body), { ...init, headers });
    }
  },
}));
// authz + the db seam are mocked; `@/lib/api-token-auth` is REAL, so the org-binding rule under test
// is the shipped one (it resolves the bearer via verifyOrgApiToken and compares to the repo's owner).
vi.mock("@/lib/authz", () => ({ requireOrgAccess: vi.fn(), requireOrgRead: vi.fn() }));
vi.mock("@/lib/access", () => ({ resolveViewerLogin: vi.fn() }));
vi.mock("@/lib/db", () => ({
  isDbConfigured: vi.fn(),
  recordConformance: vi.fn(),
  verifyOrgApiToken: vi.fn(),
  getAuditLog: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ PUBLIC_ORG: "public", readableOrgForOwner: vi.fn() }));

import { GET, POST } from "./route";
import { requireOrgAccess, requireOrgRead } from "@/lib/authz";
import { isDbConfigured, recordConformance, verifyOrgApiToken, getAuditLog } from "@/lib/db";
import { readableOrgForOwner } from "@/lib/auth";

const mockRequireOrgAccess = vi.mocked(requireOrgAccess);
const mockRequireOrgRead = vi.mocked(requireOrgRead);
const mockIsDbConfigured = vi.mocked(isDbConfigured);
const mockRecord = vi.mocked(recordConformance);
const mockVerifyToken = vi.mocked(verifyOrgApiToken);
const mockGetAuditLog = vi.mocked(getAuditLog);
const mockReadableOrgForOwner = vi.mocked(readableOrgForOwner);

/** A verified org token principal, as verifyOrgApiToken would return it. */
const orgToken = (orgSlug: string, scopes: string[] = ["telemetry:write"]) => ({
  tokenId: "tok_1",
  orgSlug,
  name: "ci",
  scopes: scopes as never,
});

const deny = (status: number) => new Response(JSON.stringify({ error: "denied" }), { status });

function post(body: unknown, headers: Record<string, string> = {}) {
  return POST(
    new Request("http://localhost/api/report/conformance", {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
}

const OK = { repo: "acme/api", score: 82, fails: 1, warns: 3 };

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  mockIsDbConfigured.mockReturnValue(true);
  mockRequireOrgAccess.mockResolvedValue(null); // allowed
  mockRequireOrgRead.mockResolvedValue(null); // allowed
  mockRecord.mockResolvedValue({ recorded: true, stale: false });
  mockVerifyToken.mockResolvedValue(null);
  mockReadableOrgForOwner.mockResolvedValue("acme");
  mockGetAuditLog.mockResolvedValue({ entries: [], nextCursor: null });
});

afterEach(() => vi.unstubAllEnvs());

describe("POST /api/report/conformance — org-scoped API token (G2-02: a token may only write its own org)", () => {
  it("accepts an askl_ token whose org owns the repo, and skips the session gate", async () => {
    mockVerifyToken.mockResolvedValue(orgToken("acme"));

    const res = await post(OK, { authorization: "Bearer askl_acme" });

    expect(res.status).toBe(200);
    expect(mockRequireOrgAccess).not.toHaveBeenCalled();
    expect(mockRecord).toHaveBeenCalledWith("acme", "acme/api", { score: 82, fails: 1, warns: 3, headSha: null });
  });

  it("REFUSES to write another org's score with a valid token bound elsewhere", async () => {
    mockVerifyToken.mockResolvedValue(orgToken("acme")); // token belongs to acme…

    // …but the body names victim
    const res = await post({ ...OK, repo: "victim/api", score: 0 }, { authorization: "Bearer askl_acme" });

    expect(res.status).toBe(403);
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("refuses a token that lacks the telemetry:write scope", async () => {
    mockVerifyToken.mockResolvedValue(orgToken("acme", ["skills:read"]));

    const res = await post(OK, { authorization: "Bearer askl_acme" });

    expect(res.status).toBe(403);
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("refuses an invalid/revoked askl_ token instead of falling back to the session", async () => {
    mockVerifyToken.mockResolvedValue(null);

    const res = await post(OK, { authorization: "Bearer askl_revoked" });

    expect(res.status).toBe(401);
    expect(mockRequireOrgAccess).not.toHaveBeenCalled();
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("does not let an askl_ token bypass the org bind even if it equals the legacy shared token", async () => {
    vi.stubEnv("CONFORMANCE_INGEST_TOKEN", "askl_shared");
    mockVerifyToken.mockResolvedValue(orgToken("acme"));

    const res = await post({ ...OK, repo: "victim/api" }, { authorization: "Bearer askl_shared" });

    expect(res.status).toBe(403);
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("clamps on the org-token path too", async () => {
    mockVerifyToken.mockResolvedValue(orgToken("acme"));
    await post({ ...OK, score: 999 }, { authorization: "Bearer askl_acme" });
    expect(mockRecord).toHaveBeenCalledWith("acme", "acme/api", { score: 100, fails: 1, warns: 3, headSha: null });
  });
});

describe("POST /api/report/conformance — CONFORMANCE_INGEST_STRICT retires the shared token", () => {
  it("rejects the legacy shared token with 403 when strict mode is on", async () => {
    vi.stubEnv("CONFORMANCE_INGEST_TOKEN", "s3cret");
    vi.stubEnv("CONFORMANCE_INGEST_STRICT", "1");

    const res = await post({ ...OK, repo: "victim/api" }, { authorization: "Bearer s3cret" });

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("CONFORMANCE_INGEST_STRICT") });
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("still accepts a properly bound org token in strict mode", async () => {
    vi.stubEnv("CONFORMANCE_INGEST_TOKEN", "s3cret");
    vi.stubEnv("CONFORMANCE_INGEST_STRICT", "1");
    mockVerifyToken.mockResolvedValue(orgToken("acme"));

    expect((await post(OK, { authorization: "Bearer askl_acme" })).status).toBe(200);
  });
});

describe("POST /api/report/conformance — auth (CI token vs org access)", () => {
  it("accepts an exact CI-token bearer and SKIPS the interactive org gate", async () => {
    vi.stubEnv("CONFORMANCE_INGEST_TOKEN", "s3cret");

    const res = await post(OK, { authorization: "Bearer s3cret" });

    expect(res.status).toBe(200);
    expect(mockRequireOrgAccess).not.toHaveBeenCalled(); // the unattended path is not org-gated
    expect(mockRecord).toHaveBeenCalledWith("acme", "acme/api", { score: 82, fails: 1, warns: 3, headSha: null });
  });

  it("matches the Bearer prefix case-insensitively (curl/doctor header casing varies)", async () => {
    vi.stubEnv("CONFORMANCE_INGEST_TOKEN", "s3cret");
    expect((await post(OK, { authorization: "bearer s3cret" })).status).toBe(200);
    expect(mockRequireOrgAccess).not.toHaveBeenCalled();
  });

  it("falls back to the ORG gate when the bearer does not match the configured token", async () => {
    vi.stubEnv("CONFORMANCE_INGEST_TOKEN", "s3cret");

    await post(OK, { authorization: "Bearer wrong" });

    expect(mockRequireOrgAccess).toHaveBeenCalledWith("acme"); // gated on the repo's owner
  });

  it("does NOT let any bearer authenticate when the deployment configures no token", async () => {
    // The dangerous shape: `!!undefined && bearer === undefined` must be false, not "both empty ⇒ match".
    for (const auth of ["Bearer ", "Bearer undefined", "Bearer null"]) {
      vi.clearAllMocks();
      mockIsDbConfigured.mockReturnValue(true);
      mockRequireOrgAccess.mockResolvedValue(null);
      mockRecord.mockResolvedValue({ recorded: true, stale: false });

      await post(OK, { authorization: auth });

      expect(mockRequireOrgAccess).toHaveBeenCalledWith("acme");
    }
  });

  it("runs the org gate when there is no authorization header at all", async () => {
    await post(OK);
    expect(mockRequireOrgAccess).toHaveBeenCalledWith("acme");
  });

  it("returns the gate's denial Response VERBATIM and never writes", async () => {
    const denial = deny(403);
    mockRequireOrgAccess.mockResolvedValue(denial);

    const res = await post({ ...OK, repo: "victim/api" });

    expect(res).toBe(denial);
    expect(res.status).toBe(403);
    expect(mockRecord).not.toHaveBeenCalled(); // a cross-tenant WRITE must not happen behind a closed gate
  });

  it("preserves a 401 verdict (not rewritten to 403)", async () => {
    mockRequireOrgAccess.mockResolvedValue(deny(401));
    expect((await post(OK)).status).toBe(401);
    expect(mockRecord).not.toHaveBeenCalled();
  });
});

describe("POST /api/report/conformance — clamping the self-attested values", () => {
  it("clamps an absurd score to 0..100 instead of persisting it", async () => {
    await post({ ...OK, score: 999999 });
    expect(mockRecord).toHaveBeenCalledWith("acme", "acme/api", { score: 100, fails: 1, warns: 3, headSha: null });
  });

  it("clamps a negative score to 0", async () => {
    await post({ ...OK, score: -50 });
    expect(mockRecord).toHaveBeenCalledWith("acme", "acme/api", { score: 0, fails: 1, warns: 3, headSha: null });
  });

  it("clamps fails/warns to a non-negative, sanely-capped count", async () => {
    await post({ ...OK, fails: -7, warns: 5_000_000 });
    expect(mockRecord).toHaveBeenCalledWith("acme", "acme/api", { score: 82, fails: 0, warns: 100_000, headSha: null });
  });

  it("truncates fractional values rather than persisting a float", async () => {
    await post({ ...OK, score: 82.9, fails: 1.7, warns: 3.2 });
    expect(mockRecord).toHaveBeenCalledWith("acme", "acme/api", { score: 82, fails: 1, warns: 3, headSha: null });
  });

  it("clamps on the CI-TOKEN path too — the unattended reporter is not more trusted", async () => {
    vi.stubEnv("CONFORMANCE_INGEST_TOKEN", "s3cret");
    await post({ ...OK, score: 12345, fails: -1, warns: -1 }, { authorization: "Bearer s3cret" });
    expect(mockRecord).toHaveBeenCalledWith("acme", "acme/api", { score: 100, fails: 0, warns: 0, headSha: null });
  });

  it("accepts numeric STRINGS (a shell-built JSON payload) and still bounds them", async () => {
    await post({ ...OK, score: "150", fails: "2", warns: "0" });
    expect(mockRecord).toHaveBeenCalledWith("acme", "acme/api", { score: 100, fails: 2, warns: 0, headSha: null });
  });
});

// G3-12: `Number(v)` before the finiteness check let null/""/false/[] all coerce to a "valid" 0 (and
// true to 1), passing the "not null" gate and persisting a FABRICATED score:0/fails:0/warns:0 for a
// buggy client that sent no real number at all — instead of the 400 it should get.
describe("POST /api/report/conformance — rejects values that coerce to a number instead of BEING one (G3-12)", () => {
  it.each([
    ["null score", { ...OK, score: null }],
    ["empty-string score", { ...OK, score: "" }],
    ["boolean score", { ...OK, score: false }],
    ["array score", { ...OK, score: [] }],
    ["whitespace-only score", { ...OK, score: "   " }],
  ])("returns 400 for %s instead of silently persisting a fabricated 0", async (_label, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Provide numeric score, fails, warns." });
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("still coerces `true` to null (rejected), not a fabricated 1", async () => {
    const res = await post({ ...OK, fails: true });
    expect(res.status).toBe(400);
    expect(mockRecord).not.toHaveBeenCalled();
  });
});

describe("POST /api/report/conformance — validation and the recorded:false path", () => {
  it("returns 503 when the DB is off, before parsing or authing", async () => {
    mockIsDbConfigured.mockReturnValue(false);

    const res = await post(OK);

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Conformance reporting requires a database." });
    expect(mockRequireOrgAccess).not.toHaveBeenCalled();
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it.each([undefined, "", "not a repo", "https://gitlab.com/a/b"])(
    "returns 400 for an unusable repo (%s) without authing or writing",
    async (repo) => {
      const res = await post({ ...OK, repo });
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Provide { repo: 'owner/name' }." });
      expect(mockRequireOrgAccess).not.toHaveBeenCalled();
      expect(mockRecord).not.toHaveBeenCalled();
    },
  );

  it.each([
    ["missing score", { repo: "acme/api", fails: 0, warns: 0 }],
    ["non-numeric score", { repo: "acme/api", score: "high", fails: 0, warns: 0 }],
    ["missing fails", { repo: "acme/api", score: 80, warns: 0 }],
    ["NaN warns", { repo: "acme/api", score: 80, fails: 0, warns: "x" }],
  ])("returns 400 for %s and never writes", async (_label, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Provide numeric score, fails, warns." });
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("treats a malformed JSON body as an empty object → 400, not a 500", async () => {
    const res = await post("{not json");
    expect(res.status).toBe(400);
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("returns 200 with recorded:false when the repo isn't watched under the org (not an error)", async () => {
    mockRecord.mockResolvedValue({ recorded: false, stale: false });

    const res = await post(OK);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, recorded: false, stale: false, repo: "acme/api" });
  });

  it("echoes the NORMALIZED owner/name, so a full GitHub URL round-trips to the canonical form", async () => {
    const res = await post({ ...OK, repo: "https://github.com/acme/api.git" });
    expect(await res.json()).toEqual({ ok: true, recorded: true, stale: false, repo: "acme/api" });
    expect(mockRecord).toHaveBeenCalledWith("acme", "acme/api", expect.anything());
  });
});

// GET /api/report/conformance — the trend read (G7-23). The Repository row only ever holds the
// LATEST reported score, but every accepted POST above also appends a `conformance.reported` row to
// the org's audit ledger — so history already exists with no schema change, and this walks it back
// via the shared getAuditLog reader (the same one /api/audit uses), action-filtered and then
// repo-filtered client-side (getAuditLog has no per-repo filter of its own).
import type { AuditLogEntry } from "@/lib/db";

function get(url: string) {
  return GET(new Request(`http://localhost${url}`));
}

/** A `conformance.reported` audit row, as getAuditLog would return it (newest reports first). */
function conformanceRow(over: { at: string; repo: string; score: number; fails?: number; warns?: number; sha?: string | null }): AuditLogEntry {
  return {
    id: `row_${over.at}`,
    action: "conformance.reported",
    actorId: null,
    orgId: "org_1",
    at: over.at,
    meta: { repo: over.repo, sha: over.sha ?? null, score: over.score, fails: over.fails ?? 0, warns: over.warns ?? 0 },
    scan: null,
    integrity: "ok",
  };
}

describe("GET /api/report/conformance — trend history", () => {
  it("returns 503 when the DB is off, before resolving the org", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    const res = await get("/api/report/conformance?repo=acme/api");
    expect(res.status).toBe(503);
    expect(mockReadableOrgForOwner).not.toHaveBeenCalled();
  });

  it("returns 400 for a missing/unusable repo query param", async () => {
    const res = await get("/api/report/conformance?repo=not-a-repo");
    expect(res.status).toBe(400);
    expect(mockGetAuditLog).not.toHaveBeenCalled();
  });

  it("refuses public-org (unowned) repos — history is an org-only surface", async () => {
    mockReadableOrgForOwner.mockResolvedValue("public");
    const res = await get("/api/report/conformance?repo=acme/api");
    expect(res.status).toBe(403);
    expect(mockGetAuditLog).not.toHaveBeenCalled();
  });

  it("returns the read-gate's denial verbatim and never queries the ledger", async () => {
    const denial = deny(401);
    mockRequireOrgRead.mockResolvedValue(denial);
    const res = await get("/api/report/conformance?repo=acme/api");
    expect(res).toBe(denial);
    expect(mockGetAuditLog).not.toHaveBeenCalled();
  });

  it("filters the org-wide ledger down to just this repo's reports, newest-first", async () => {
    mockGetAuditLog.mockResolvedValue({
      entries: [
        conformanceRow({ at: "2026-07-20T00:00:00.000Z", repo: "acme/other", score: 10 }), // different repo
        conformanceRow({ at: "2026-07-19T00:00:00.000Z", repo: "acme/api", score: 90, sha: "abc1234" }),
        conformanceRow({ at: "2026-07-12T00:00:00.000Z", repo: "acme/api", score: 82 }),
      ],
      nextCursor: null,
    });

    const res = await get("/api/report/conformance?repo=acme/api");
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.repo).toBe("acme/api");
    expect(body.points).toEqual([
      { at: "2026-07-19T00:00:00.000Z", score: 90, fails: 0, warns: 0, sha: "abc1234" },
      { at: "2026-07-12T00:00:00.000Z", score: 82, fails: 0, warns: 0, sha: null },
    ]);
    expect(mockGetAuditLog).toHaveBeenCalledWith("acme", { action: "conformance.reported", cursor: null, limit: 100 });
  });

  it("paginates the ledger via cursor when the first page has no matching rows for this repo", async () => {
    mockGetAuditLog
      .mockResolvedValueOnce({ entries: [conformanceRow({ at: "t2", repo: "acme/other", score: 1 })], nextCursor: "c1" })
      .mockResolvedValueOnce({ entries: [conformanceRow({ at: "t1", repo: "acme/api", score: 77 })], nextCursor: null });

    const res = await get("/api/report/conformance?repo=acme/api");
    const body = await res.json();

    expect(body.points).toEqual([{ at: "t1", score: 77, fails: 0, warns: 0, sha: null }]);
    expect(mockGetAuditLog).toHaveBeenNthCalledWith(2, "acme", { action: "conformance.reported", cursor: "c1", limit: 100 });
  });

  it("flags a regression when the newest report scored lower than the one before it", async () => {
    mockGetAuditLog.mockResolvedValue({
      entries: [
        conformanceRow({ at: "t2", repo: "acme/api", score: 60 }),
        conformanceRow({ at: "t1", repo: "acme/api", score: 90 }),
      ],
      nextCursor: null,
    });
    const body = await (await get("/api/report/conformance?repo=acme/api")).json();
    expect(body.regressed).toBe(true);
  });

  it("does not flag a regression on an improvement, a flat score, or a single-point history", async () => {
    mockGetAuditLog.mockResolvedValue({
      entries: [
        conformanceRow({ at: "t2", repo: "acme/api", score: 95 }),
        conformanceRow({ at: "t1", repo: "acme/api", score: 90 }),
      ],
      nextCursor: null,
    });
    expect((await (await get("/api/report/conformance?repo=acme/api")).json()).regressed).toBe(false);

    mockGetAuditLog.mockResolvedValue({ entries: [conformanceRow({ at: "t1", repo: "acme/api", score: 90 })], nextCursor: null });
    expect((await (await get("/api/report/conformance?repo=acme/api")).json()).regressed).toBe(false);
  });

  it("returns an empty trend (not an error) when the repo has never reported", async () => {
    const res = await get("/api/report/conformance?repo=acme/api");
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body).toEqual({ repo: "acme/api", points: [], regressed: false });
  });
});
