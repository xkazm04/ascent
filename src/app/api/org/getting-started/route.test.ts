// GET /api/org/getting-started authorization + shape: the member gate (>= viewer) runs BEFORE any
// derivation (the checklist names tenant governance/team state); the viewer's role is resolved and
// threaded into the model for availability honesty; and the payload carries steps + allDone +
// personal + the caller's own onboarding stamp (null when identityless).

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));
vi.mock("@/lib/db", () => ({
  isDbConfigured: vi.fn(),
  getMembershipRole: vi.fn(),
  getOnboardingStamp: vi.fn(),
}));
vi.mock("@/lib/authz", () => ({ requireOrgRole: vi.fn() }));
vi.mock("@/lib/access", () => ({ resolveViewerLogin: vi.fn() }));
vi.mock("@/lib/org/getting-started", () => ({ buildGettingStarted: vi.fn() }));

import { GET } from "./route";
import { getMembershipRole, getOnboardingStamp, isDbConfigured } from "@/lib/db";
import { requireOrgRole } from "@/lib/authz";
import { resolveViewerLogin } from "@/lib/access";
import { buildGettingStarted } from "@/lib/org/getting-started";

const mockIsDbConfigured = vi.mocked(isDbConfigured);
const mockGetRole = vi.mocked(getMembershipRole);
const mockGetStamp = vi.mocked(getOnboardingStamp);
const mockRequireOrgRole = vi.mocked(requireOrgRole);
const mockResolveViewerLogin = vi.mocked(resolveViewerLogin);
const mockBuild = vi.mocked(buildGettingStarted);

const get = (qs: string) => GET(new Request(`http://localhost/api/org/getting-started${qs}`));
const deny = (status: number) => new Response(JSON.stringify({ error: "denied" }), { status });

const model = {
  steps: [
    { id: "first-scan", phase: "baseline", done: true, available: true, tab: "overview", anchor: "results-view" },
  ],
  allDone: false,
  personal: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockIsDbConfigured.mockReturnValue(true);
  mockRequireOrgRole.mockResolvedValue(null);
  mockResolveViewerLogin.mockResolvedValue("dana");
  mockGetRole.mockResolvedValue("member");
  mockGetStamp.mockResolvedValue({ completedAt: null, skippedAt: null, dismissed: false });
  mockBuild.mockResolvedValue(model as never);
});

describe("GET /api/org/getting-started — gates", () => {
  it("503s when the DB is off", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    expect((await get("?org=acme")).status).toBe(503);
    expect(mockBuild).not.toHaveBeenCalled();
  });

  it("400s without ?org", async () => {
    expect((await get("")).status).toBe(400);
    expect(mockBuild).not.toHaveBeenCalled();
  });

  it("returns the member gate's denial verbatim and derives NOTHING (tenant wall)", async () => {
    mockRequireOrgRole.mockResolvedValue(deny(403) as never);
    const res = await get("?org=acme");
    expect(res.status).toBe(403);
    expect(mockRequireOrgRole).toHaveBeenCalledWith("acme", "viewer");
    expect(mockBuild).not.toHaveBeenCalled();
    expect(mockGetStamp).not.toHaveBeenCalled();
  });
});

describe("GET /api/org/getting-started — payload", () => {
  it("threads the resolved viewer role into the derivation (availability honesty)", async () => {
    mockGetRole.mockResolvedValue("viewer");
    await get("?org=acme");
    expect(mockGetRole).toHaveBeenCalledWith("acme", "dana");
    expect(mockBuild).toHaveBeenCalledWith("acme", "viewer");
  });

  it("serves steps + allDone + personal + the caller's stamp, ISO-dated", async () => {
    const completedAt = new Date("2026-08-01T00:00:00Z");
    mockGetStamp.mockResolvedValue({ completedAt, skippedAt: null, dismissed: true });
    const json = await (await get("?org=acme")).json();
    expect(json).toEqual({
      steps: model.steps,
      allDone: false,
      personal: false,
      onboarding: { completedAt: completedAt.toISOString(), skippedAt: null, dismissed: true },
    });
  });

  it("identityless viewer (auth-off): null role → unrestricted model, onboarding null", async () => {
    mockResolveViewerLogin.mockResolvedValue(null);
    const json = await (await get("?org=acme")).json();
    expect(mockBuild).toHaveBeenCalledWith("acme", null);
    expect(mockGetStamp).not.toHaveBeenCalled();
    expect(json.onboarding).toBeNull();
  });

  it("a failing stamp read degrades to onboarding:null, never a 500", async () => {
    mockGetStamp.mockRejectedValue(new Error("boom"));
    const res = await get("?org=acme");
    expect(res.status).toBe(200);
    expect((await res.json()).onboarding).toBeNull();
  });
});
