// Integration test for the onboarding-skill export route (GET /api/report/skill?repo=owner/name[@sha]).
// This route emits the personalized SKILL.md for a persisted maturity report — and a private report's
// skill is "as sensitive as the report" (it bakes in the repo's dimension scores, gaps and headline).
// So the load-bearing invariant is gate-before-read: when requireOrgRead returns a denial Response, the
// handler returns EXACTLY that Response and NEVER builds the skill or reads the report. A regression
// that drops/reorders requireOrgRead leaks a private repo's baked-in scan facts cross-tenant.
//
// Also pinned: 503 when the DB is off (before anything else), 404 (not a leak) when there is no saved
// scan, the org-scoping of the read, the success path's text/markdown + Content-Disposition, the
// safe() filename sanitizer (a caller-supplied @sha must not inject a header), and the fire-and-forget
// recordSkillGeneration contract (a rejected write must not reject the download).
//
// Boundaries are mocked so we can assert exactly when (and whether) the skill build / report read fire.
// next/server's NextResponse is mocked as a Response subclass because the success branch uses the
// `new NextResponse(body, { headers })` constructor (not just the static .json helper).

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ScanReport } from "@/lib/types";
import type { GeneratedSkill } from "@/lib/onboarding";

vi.mock("next/server", () => ({
  // Extends Response so BOTH `NextResponse.json(...)` and `new NextResponse(body, { headers })` work.
  NextResponse: class extends Response {
    static json(body: unknown, init?: ResponseInit) {
      const headers = new Headers(init?.headers);
      if (!headers.has("content-type")) headers.set("content-type", "application/json");
      return new Response(JSON.stringify(body), { ...init, headers });
    }
  },
}));
vi.mock("@/lib/auth", () => ({ readableOrgForOwner: vi.fn() }));
vi.mock("@/lib/authz", () => ({ requireOrgRead: vi.fn() }));
vi.mock("@/lib/onboarding", () => ({ buildOnboardingSkill: vi.fn() }));
vi.mock("@/lib/db", () => ({
  isDbConfigured: vi.fn(),
  getScanReportByCommit: vi.fn(),
  recordSkillGeneration: vi.fn(),
}));

import { GET } from "./route";
import { readableOrgForOwner } from "@/lib/auth";
import { requireOrgRead } from "@/lib/authz";
import { buildOnboardingSkill } from "@/lib/onboarding";
import { isDbConfigured, getScanReportByCommit, recordSkillGeneration } from "@/lib/db";

const mockReadableOrg = vi.mocked(readableOrgForOwner);
const mockRequireOrgRead = vi.mocked(requireOrgRead);
const mockBuildSkill = vi.mocked(buildOnboardingSkill);
const mockIsDbConfigured = vi.mocked(isDbConfigured);
const mockGetReport = vi.mocked(getScanReportByCommit);
const mockRecord = vi.mocked(recordSkillGeneration);

// A persisted report stand-in — the route only forwards it to buildOnboardingSkill (mocked), so the
// fields don't matter to this test; the secret it represents must never escape behind a closed gate.
const REPORT = { repo: "acme/api", headline: "SECRET_HEADLINE" } as unknown as ScanReport;
const SKILL: GeneratedSkill = {
  name: "ascent-onboard",
  path: ".claude/skills/ascent-onboard/SKILL.md",
  body: "---\nname: ascent-onboard\n---\n# Onboard acme/api",
  trackIds: ["D4", "D9"],
};

const deny = (status: number) =>
  new Response(JSON.stringify({ error: "denied" }), { status });

function get(repo?: string) {
  const url =
    repo == null
      ? "http://localhost/api/report/skill"
      : `http://localhost/api/report/skill?repo=${encodeURIComponent(repo)}`;
  return GET(new Request(url));
}

beforeEach(() => {
  vi.clearAllMocks();
  // Happy-path defaults; individual tests override the branch they exercise.
  mockIsDbConfigured.mockReturnValue(true);
  mockReadableOrg.mockResolvedValue("acme");
  mockRequireOrgRead.mockResolvedValue(null); // read allowed
  mockGetReport.mockResolvedValue(REPORT as never);
  mockBuildSkill.mockReturnValue(SKILL);
  mockRecord.mockResolvedValue(undefined);
});

describe("GET /api/report/skill — tenant gate (cross-tenant skill leak guard)", () => {
  it("denies an unauthorized caller, returns the gate Response verbatim, and NEVER reads/builds", async () => {
    const denial = deny(403);
    mockRequireOrgRead.mockResolvedValue(denial);

    const res = await get("victim/api");

    expect(res.status).toBe(403);
    expect(res).toBe(denial); // the handler returns the gate's own Response unchanged
    expect(mockRequireOrgRead).toHaveBeenCalledWith("acme"); // gated on the resolved owning org
    // The non-negotiable invariant: behind a closed gate, no report is read and no skill is built.
    expect(mockGetReport).not.toHaveBeenCalled();
    expect(mockBuildSkill).not.toHaveBeenCalled();
    expect(mockRecord).not.toHaveBeenCalled();
    // And nothing about the report leaks in the denial body.
    expect(await res.text()).not.toContain("SECRET_HEADLINE");
  });

  it("returns the gate's denial status unchanged (401 vs 403 verdict is not rewritten)", async () => {
    mockRequireOrgRead.mockResolvedValue(deny(401));
    expect((await get("victim/api")).status).toBe(401);
    expect(mockGetReport).not.toHaveBeenCalled();
  });

  it("gates BEFORE the report read for an ALLOWED caller too (requireOrgRead resolves first)", async () => {
    const order: string[] = [];
    mockRequireOrgRead.mockImplementation(async () => {
      order.push("gate");
      return null;
    });
    mockGetReport.mockImplementation(async () => {
      order.push("read");
      return REPORT as never;
    });

    await get("acme/api");

    expect(order).toEqual(["gate", "read"]);
  });
});

describe("GET /api/report/skill — pre-gate / 503 / 404 short-circuits", () => {
  it("returns 503 when the database is not configured (before parsing/gating/reading)", async () => {
    mockIsDbConfigured.mockReturnValue(false);

    const res = await get("acme/api");

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "Skill export requires a database." });
    expect(mockReadableOrg).not.toHaveBeenCalled();
    expect(mockRequireOrgRead).not.toHaveBeenCalled();
    expect(mockGetReport).not.toHaveBeenCalled();
    expect(mockBuildSkill).not.toHaveBeenCalled();
  });

  it("returns 400 when ?repo is missing (no gate, no read)", async () => {
    const res = await get(undefined);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Missing ?repo=owner/name." });
    expect(mockRequireOrgRead).not.toHaveBeenCalled();
    expect(mockGetReport).not.toHaveBeenCalled();
  });

  it("returns 400 for an invalid repo (owner/ or /name) without gating or reading", async () => {
    for (const bad of ["acme/", "/api", "acme"]) {
      vi.clearAllMocks();
      mockIsDbConfigured.mockReturnValue(true);
      const res = await get(bad);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Invalid repo. Use owner/name." });
      expect(mockRequireOrgRead).not.toHaveBeenCalled();
      expect(mockGetReport).not.toHaveBeenCalled();
    }
  });

  it("returns 404 (NOT a leak / not 500) when there is no saved scan, and never builds the skill", async () => {
    mockGetReport.mockResolvedValue(null as never);

    const res = await get("acme/api");

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "No saved scan for this repository yet. Scan it first, then export.",
    });
    expect(mockBuildSkill).not.toHaveBeenCalled();
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("returns 404 (not 500) when the report read REJECTS — the route swallows the read error", async () => {
    mockGetReport.mockRejectedValue(new Error("scans-read db exploded"));

    const res = await get("acme/api");

    expect(res.status).toBe(404);
    expect(mockBuildSkill).not.toHaveBeenCalled();
  });
});

describe("GET /api/report/skill — authorized happy path + filename sanitization", () => {
  it("returns the skill artifact with text/markdown + sanitized Content-Disposition, org-scoping the read", async () => {
    const res = await get("acme/api@abcdef1234567890");

    expect(res.status).toBe(200);
    // The read is scoped to the resolved org and the requested commit.
    expect(mockGetReport).toHaveBeenCalledWith("acme", "api", {
      headSha: "abcdef1234567890",
      orgSlug: "acme",
    });
    expect(mockBuildSkill).toHaveBeenCalledWith(REPORT);

    expect(res.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(res.headers.get("cache-control")).toBe("private, max-age=300");
    // sha is truncated to 7 chars in the filename.
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="ascent-onboard-acme-api-abcdef1.SKILL.md"',
    );
    expect(await res.text()).toBe(SKILL.body);
  });

  it("omits the sha segment when no @sha is supplied", async () => {
    const res = await get("acme/api");
    expect(res.status).toBe(200);
    expect(mockGetReport).toHaveBeenCalledWith("acme", "api", { headSha: undefined, orgSlug: "acme" });
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="ascent-onboard-acme-api.SKILL.md"',
    );
  });

  it("strips CR/LF, quotes and slashes from a crafted @sha in the filename (no header injection)", async () => {
    // A sha crafted to break out of the quoted Content-Disposition filename / inject a header.
    const res = await get('acme/api@../../etc"\r\nX: y');

    expect(res.status).toBe(200);
    const disposition = res.headers.get("content-disposition") ?? "";
    const filename = /filename="([^"]*)"/.exec(disposition)?.[1] ?? "";
    // The sanitizer keeps only [A-Za-z0-9._-]; none of these injection chars survive in the filename.
    for (const c of ['"', "\r", "\n", "/", " ", ":"]) expect(filename).not.toContain(c);
    expect(filename).toMatch(/^ascent-onboard-acme-api-[A-Za-z0-9._-]+\.SKILL\.md$/);
  });

  it("does NOT reject the download when the fire-and-forget recordSkillGeneration rejects", async () => {
    mockRecord.mockRejectedValue(new Error("skill-history write failed"));

    const res = await get("acme/api");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(await res.text()).toBe(SKILL.body);
    // The history write was attempted (fire-and-forget) but its failure is swallowed.
    expect(mockRecord).toHaveBeenCalledWith("acme/api", null, SKILL.trackIds);
  });
});
