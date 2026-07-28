// Route test for /api/report/foundation/pr — the one-click install of the generated `.ai/` foundation.
//
// Two things are pinned here:
//  1. the GATE CHAIN is byte-for-byte the passport PR route's (db/App configured, same-origin, signed-in,
//     org-owned, org access, installation present) — this is the same customer-repo WRITE surface.
//  2. the PR FILE MANIFEST: the PR seeds EXACTLY `buildFoundation(report)` — every generated path, each
//     with its exact non-empty body, and NOTHING else. `openFoundationPr` runs for real here (only the
//     low-level `openDraftPr` is mocked), so the layering on the shared PR machinery is exercised too.

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
  authGateEnabled: vi.fn(),
  resolveViewerLogin: vi.fn(),
  readableOrgForOwner: vi.fn(),
  requireOrgAccess: vi.fn(),
  getScanReportByCommit: vi.fn(),
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
  isDbConfigured: h.isDbConfigured,
  getScanReportByCommit: h.getScanReportByCommit,
  getInstallationIdForOwner: h.getInstallationIdForOwner,
  recordOrgAudit: h.recordOrgAudit,
}));
vi.mock("@/lib/auth", () => ({
  PUBLIC_ORG: "public",
  readableOrgForOwner: h.readableOrgForOwner,
  isSameOrigin: h.isSameOrigin,
  requireSameOrigin: (req: Request) =>
    h.isSameOrigin(req) ? null : Response.json({ error: "Cross-origin request rejected." }, { status: 403 }),
  isAuthConfigured: h.isAuthConfigured,
}));
vi.mock("@/lib/access", () => ({ authGateEnabled: h.authGateEnabled, resolveViewerLogin: h.resolveViewerLogin }));
vi.mock("@/lib/authz", () => ({ requireOrgAccess: h.requireOrgAccess }));

import { POST } from "./route";
import { AppApiError } from "@/lib/github/app"; // the mocked class — for constructing the 409 cases
import { buildFoundation } from "@/lib/standard";
import { FOUNDATION_BRANCH } from "@/lib/standard/pr";
import { levelForScore } from "@/lib/maturity/model";
import type { ScanReport } from "@/lib/types";

function makeReport(): ScanReport {
  return {
    repo: {
      owner: "acme", name: "web", url: "https://github.com/acme/web", description: "Billing API",
      stars: 12, forks: 1, primaryLanguage: "TypeScript", defaultBranch: "main", headSha: "abc1234",
    },
    overallScore: 58, level: levelForScore(58), archetype: "team",
    adoptionScore: 55, rigorScore: 60,
    posture: { id: "ai-native", label: "AI-Native", blurb: "x" },
    aiUsage: { detected: true, commitFraction: 0.3, signals: [] },
    contributors: [], dimensions: [],
    headline: "h", strengths: [], risks: [], roadmap: [], discrepancies: [],
    confidence: 0.8, scannedAt: "2026-06-10T00:00:00.000Z",
    engine: { provider: "mock", model: "deterministic" },
  };
}

const post = (body: unknown) =>
  new Request("http://t/api/report/foundation/pr", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

beforeEach(() => {
  vi.clearAllMocks();
  h.isDbConfigured.mockReturnValue(true);
  h.isAppConfigured.mockReturnValue(true);
  h.isSameOrigin.mockReturnValue(true);
  h.isAuthConfigured.mockReturnValue(true);
  h.authGateEnabled.mockReturnValue(true);
  h.resolveViewerLogin.mockResolvedValue("alice");
  h.readableOrgForOwner.mockResolvedValue("acme");
  h.requireOrgAccess.mockResolvedValue(null);
  h.getScanReportByCommit.mockResolvedValue(makeReport());
  h.getInstallationIdForOwner.mockResolvedValue("inst1");
  h.getInstallationToken.mockResolvedValue("tok");
  h.recordOrgAudit.mockResolvedValue(undefined);
  h.openDraftPr.mockImplementation(async () => ({ url: "https://github.com/acme/web/pull/9", number: 9, branch: FOUNDATION_BRANCH, reused: false }));
});

describe("POST /api/report/foundation/pr — gates (identical chain to passport/pr)", () => {
  it("503 db off / app off · 403 cross-origin · 401 signed-out · 400 bad repo", async () => {
    h.isDbConfigured.mockReturnValue(false);
    expect((await POST(post({ repo: "acme/web" }))).status).toBe(503);
    h.isDbConfigured.mockReturnValue(true);
    h.isAppConfigured.mockReturnValue(false);
    expect((await POST(post({ repo: "acme/web" }))).status).toBe(503);
    h.isAppConfigured.mockReturnValue(true);
    h.isSameOrigin.mockReturnValue(false);
    expect((await POST(post({ repo: "acme/web" }))).status).toBe(403);
    h.isSameOrigin.mockReturnValue(true);
    h.resolveViewerLogin.mockResolvedValue(null);
    expect((await POST(post({ repo: "acme/web" }))).status).toBe(401);
    h.resolveViewerLogin.mockResolvedValue("alice");
    expect((await POST(post({ repo: "acme/web/extra" }))).status).toBe(400);
    expect(h.openDraftPr).not.toHaveBeenCalled();
  });

  it("refuses the public funnel; denies a non-member; 404 without a scan; 403 without an install", async () => {
    h.readableOrgForOwner.mockResolvedValue("public");
    expect((await POST(post({ repo: "x/web" }))).status).toBe(403);
    h.readableOrgForOwner.mockResolvedValue("acme");

    h.requireOrgAccess.mockResolvedValue(Response.json({ error: "no" }, { status: 403 }));
    expect((await POST(post({ repo: "acme/web" }))).status).toBe(403);
    h.requireOrgAccess.mockResolvedValue(null);

    h.getScanReportByCommit.mockResolvedValue(null);
    expect((await POST(post({ repo: "acme/web" }))).status).toBe(404);
    h.getScanReportByCommit.mockResolvedValue(makeReport());

    h.getInstallationIdForOwner.mockResolvedValue(null);
    expect((await POST(post({ repo: "acme/web" }))).status).toBe(403);
    expect(h.openDraftPr).not.toHaveBeenCalled();
  });
});

describe("POST /api/report/foundation/pr — the PR file manifest", () => {
  it("seeds EXACTLY buildFoundation(report): every path, exact non-empty bodies, no extras", async () => {
    const res = await POST(post({ repo: "acme/web" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.number).toBe(9);

    const expected = buildFoundation(makeReport());
    expect(expected.length).toBeGreaterThan(0);
    const calls = h.openDraftPr.mock.calls.map((c) => c[0] as { path: string; content: string; branch: string; owner: string; repo: string });

    // One openDraftPr call per generated file — no more, no fewer, in scaffold order.
    expect(calls.map((c) => c.path)).toEqual(expected.map((f) => f.path));
    for (const [i, f] of expected.entries()) {
      expect(calls[i].content).toBe(f.body);
      expect(calls[i].content.length).toBeGreaterThan(0);
      expect(calls[i].branch).toBe(FOUNDATION_BRANCH); // one branch -> one PR
      expect(calls[i].owner).toBe("acme");
      expect(calls[i].repo).toBe("web");
    }
    // The spine leads (so a collision there means "already installed"), followed by the spec it points at.
    expect(calls[0].path).toBe(".ai/manifest.yaml");
    expect(calls[1].path).toBe(".ai/SPEC.md");
    expect(calls.map((c) => c.path)).toContain(".ai/doctor.mjs");

    // The response reports what landed; the audit row names the foundation action.
    expect(json.committed).toEqual(expected.map((f) => f.path));
    expect(json.skipped).toEqual([]);
    expect(h.recordOrgAudit.mock.calls[0][0]).toBe("foundation.pr_opened");
  });

  it("a collision on the SPINE surfaces as 409 (the standard is already installed) and writes nothing else", async () => {
    h.openDraftPr.mockRejectedValueOnce(new AppApiError(409, ".ai/manifest.yaml", '".ai/manifest.yaml" already exists on main'));
    const res = await POST(post({ repo: "acme/web" }));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain(".ai/manifest.yaml");
    expect(h.openDraftPr).toHaveBeenCalledTimes(1); // aborted at the spine
  });

  it("a collision on a LATER file skips that path (never overwrites) and still lands the rest", async () => {
    const expected = buildFoundation(makeReport());
    const collide = "CONTEXT.md"; // a repo may legitimately already have one at the root
    expect(expected.some((f) => f.path === collide)).toBe(true);
    h.openDraftPr.mockImplementation(async (input: { path: string }) => {
      if (input.path === collide) throw new AppApiError(409, collide, "already exists on main");
      return { url: "https://github.com/acme/web/pull/9", number: 9, branch: FOUNDATION_BRANCH, reused: false };
    });

    const res = await POST(post({ repo: "acme/web" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.skipped).toEqual([collide]);
    expect(json.committed).toEqual(expected.filter((f) => f.path !== collide).map((f) => f.path));
  });
});
