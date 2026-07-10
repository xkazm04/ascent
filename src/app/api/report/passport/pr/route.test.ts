// Route test for /api/report/passport/pr (P4b). Pins the gate chain + the openDraftPr call: org-owned +
// app-installed + same-origin + signed-in; public funnel refused; 404 without a stored passport; 403
// without an installation; happy path commits `.ai/passport.json` (schema pointer + the passport); a
// 409 clobber from openDraftPr surfaces as 409. AppApiError/GitHubError are real classes for instanceof.

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class extends Response {
    static json(body: unknown, init?: { status?: number }) {
      return new Response(JSON.stringify(body), { status: init?.status ?? 200, headers: { "content-type": "application/json" } });
    }
  },
}));

const h = vi.hoisted(() => ({
  isDbConfigured: vi.fn(),
  isAppConfigured: vi.fn(),
  isSameOrigin: vi.fn(),
  isAuthConfigured: vi.fn(),
  getSession: vi.fn(),
  readableOrgForOwner: vi.fn(),
  requireOrgAccess: vi.fn(),
  getRepoPassport: vi.fn(),
  getInstallationIdForOwner: vi.fn(),
  getInstallationToken: vi.fn(),
  recordOrgAudit: vi.fn(),
  openDraftPr: vi.fn(),
}));

vi.mock("@/lib/github/source", () => ({ GitHubError: class extends Error {} }));
vi.mock("@/lib/github/write", () => ({ openDraftPr: h.openDraftPr }));
vi.mock("@/lib/github/app", () => ({
  AppApiError: class extends Error {
    status: number;
    path: string;
    constructor(status: number, path: string, msg: string) { super(msg); this.status = status; this.path = path; }
  },
  getInstallationToken: h.getInstallationToken,
  isAppConfigured: h.isAppConfigured,
}));
vi.mock("@/lib/db", () => ({
  isDbConfigured: h.isDbConfigured, getRepoPassport: h.getRepoPassport, getInstallationIdForOwner: h.getInstallationIdForOwner, recordOrgAudit: h.recordOrgAudit,
}));
vi.mock("@/lib/auth", () => ({ PUBLIC_ORG: "public", readableOrgForOwner: h.readableOrgForOwner, isSameOrigin: h.isSameOrigin, isAuthConfigured: h.isAuthConfigured, getSession: h.getSession }));
vi.mock("@/lib/authz", () => ({ requireOrgAccess: h.requireOrgAccess }));

import { POST } from "./route";
import { AppApiError } from "@/lib/github/app"; // the mocked class — for constructing the 409 case

const post = (body: unknown) => new Request("http://t/api/report/passport/pr", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
const passport = { passport: "app-passport", automationReadiness: { level: "L4" }, productionReadiness: { band: "beta" } };

beforeEach(() => {
  vi.clearAllMocks();
  h.isDbConfigured.mockReturnValue(true);
  h.isAppConfigured.mockReturnValue(true);
  h.isSameOrigin.mockReturnValue(true);
  h.isAuthConfigured.mockReturnValue(true);
  h.getSession.mockResolvedValue({ login: "alice" });
  h.readableOrgForOwner.mockResolvedValue("acme");
  h.requireOrgAccess.mockResolvedValue(null);
  h.getRepoPassport.mockResolvedValue(passport);
  h.getInstallationIdForOwner.mockResolvedValue("inst1");
  h.getInstallationToken.mockResolvedValue("tok");
  h.recordOrgAudit.mockResolvedValue(undefined);
  h.openDraftPr.mockResolvedValue({ url: "https://github.com/acme/web/pull/7", number: 7, reused: false });
});

describe("POST /api/report/passport/pr — gates", () => {
  it("503 db off / app off · 403 cross-origin · 401 signed-out", async () => {
    h.isDbConfigured.mockReturnValue(false);
    expect((await POST(post({ repo: "acme/web" }))).status).toBe(503);
    h.isDbConfigured.mockReturnValue(true);
    h.isAppConfigured.mockReturnValue(false);
    expect((await POST(post({ repo: "acme/web" }))).status).toBe(503);
    h.isAppConfigured.mockReturnValue(true);
    h.isSameOrigin.mockReturnValue(false);
    expect((await POST(post({ repo: "acme/web" }))).status).toBe(403);
    h.isSameOrigin.mockReturnValue(true);
    h.getSession.mockResolvedValue(null);
    expect((await POST(post({ repo: "acme/web" }))).status).toBe(401);
  });

  it("refuses the public funnel; denies a non-member; 404 without a passport; 403 without an install", async () => {
    h.readableOrgForOwner.mockResolvedValue("public");
    expect((await POST(post({ repo: "x/web" }))).status).toBe(403);
    h.readableOrgForOwner.mockResolvedValue("acme");

    h.requireOrgAccess.mockResolvedValue(Response.json({ error: "no" }, { status: 403 }));
    expect((await POST(post({ repo: "acme/web" }))).status).toBe(403);
    h.requireOrgAccess.mockResolvedValue(null);

    h.getRepoPassport.mockResolvedValue(null);
    expect((await POST(post({ repo: "acme/web" }))).status).toBe(404);
    h.getRepoPassport.mockResolvedValue(passport);

    h.getInstallationIdForOwner.mockResolvedValue(null);
    expect((await POST(post({ repo: "acme/web" }))).status).toBe(403);
  });
});

describe("POST /api/report/passport/pr — commit", () => {
  it("opens a draft PR committing .ai/passport.json with the schema pointer + the passport", async () => {
    const res = await POST(post({ repo: "acme/web" }));
    expect(res.status).toBe(200);
    expect((await res.json()).number).toBe(7);
    const arg = h.openDraftPr.mock.calls[0][0];
    expect(arg).toMatchObject({ owner: "acme", repo: "web", path: ".ai/passport.json" });
    expect(arg.content).toContain("app-passport-0.1.json"); // $schema pointer
    expect(arg.content).toContain('"app-passport"');
    expect(h.recordOrgAudit.mock.calls[0][0]).toBe("passport.pr_opened");
  });

  it("surfaces a 409 clobber from openDraftPr (won't overwrite an existing .ai/passport.json)", async () => {
    h.openDraftPr.mockRejectedValue(new AppApiError(409, ".ai/passport.json", "already exists on main"));
    const res = await POST(post({ repo: "acme/web" }));
    expect(res.status).toBe(409);
  });
});
