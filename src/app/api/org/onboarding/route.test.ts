// POST /api/org/onboarding authorization + contract: same-origin and the viewer-role tenant wall run
// BEFORE any write; a denial short-circuits the stamp entirely; invalid input 400s; the no-identity
// path is a clean no-op ({ok, stamped:false}), mirroring the alerts watermark; and the stamp is
// written with the caller's OWN login + the validated status (self-scoped — never a body-supplied
// login).

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
  setOnboardingStamp: vi.fn(),
  isOnboardingStatus: (v: unknown) => v === "completed" || v === "skipped",
}));
vi.mock("@/lib/authz", () => ({ requireOrgRole: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireSameOrigin: vi.fn() }));
vi.mock("@/lib/access", () => ({ resolveViewerLogin: vi.fn() }));

import { POST } from "./route";
import { isDbConfigured, setOnboardingStamp } from "@/lib/db";
import { requireOrgRole } from "@/lib/authz";
import { requireSameOrigin } from "@/lib/auth";
import { resolveViewerLogin } from "@/lib/access";

const mockIsDbConfigured = vi.mocked(isDbConfigured);
const mockSetStamp = vi.mocked(setOnboardingStamp);
const mockRequireOrgRole = vi.mocked(requireOrgRole);
const mockRequireSameOrigin = vi.mocked(requireSameOrigin);
const mockResolveViewerLogin = vi.mocked(resolveViewerLogin);

const post = (body: unknown) =>
  POST(new Request("http://localhost/api/org/onboarding", { method: "POST", body: JSON.stringify(body) }));
const deny = (status: number) => new Response(JSON.stringify({ error: "denied" }), { status });

beforeEach(() => {
  vi.clearAllMocks();
  mockIsDbConfigured.mockReturnValue(true);
  mockRequireSameOrigin.mockReturnValue(null);
  mockRequireOrgRole.mockResolvedValue(null);
  mockResolveViewerLogin.mockResolvedValue("dana");
  mockSetStamp.mockResolvedValue(true);
});

describe("POST /api/org/onboarding — gates", () => {
  it("503s when the DB is off, before anything else", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    expect((await post({ org: "acme", status: "completed" })).status).toBe(503);
    expect(mockSetStamp).not.toHaveBeenCalled();
  });

  it("returns the same-origin denial verbatim (CSRF)", async () => {
    mockRequireSameOrigin.mockReturnValue(deny(403) as never);
    expect((await post({ org: "acme", status: "completed" })).status).toBe(403);
    expect(mockSetStamp).not.toHaveBeenCalled();
  });

  it("400s on a missing org and on an invalid status", async () => {
    expect((await post({ status: "completed" })).status).toBe(400);
    expect((await post({ org: "acme", status: "dismissed" })).status).toBe(400);
    expect(mockSetStamp).not.toHaveBeenCalled();
  });

  it("returns the role gate's denial verbatim and never writes (tenant wall)", async () => {
    mockRequireOrgRole.mockResolvedValue(deny(403) as never);
    const res = await post({ org: "acme", status: "skipped" });
    expect(res.status).toBe(403);
    expect(mockRequireOrgRole).toHaveBeenCalledWith("acme", "viewer");
    expect(mockSetStamp).not.toHaveBeenCalled();
  });
});

describe("POST /api/org/onboarding — stamping", () => {
  it("stamps the CALLER's own row with the validated status", async () => {
    const res = await post({ org: "acme", status: "completed" });
    const json = (await res.json()) as { ok: boolean; stamped: boolean; at?: string };
    expect(json.ok).toBe(true);
    expect(json.stamped).toBe(true);
    expect(json.at).toBeTruthy();
    expect(mockSetStamp).toHaveBeenCalledWith("acme", "dana", "completed", expect.any(Date));
  });

  it("is a clean no-op with no viewer identity (auth-off / public org)", async () => {
    mockResolveViewerLogin.mockResolvedValue(null);
    const res = await post({ org: "acme", status: "skipped" });
    expect(await res.json()).toEqual({ ok: true, stamped: false });
    expect(mockSetStamp).not.toHaveBeenCalled();
  });

  it("reports stamped:false when there is no membership row (write returned false)", async () => {
    mockSetStamp.mockResolvedValue(false);
    const json = (await (await post({ org: "acme", status: "completed" })).json()) as { stamped: boolean; at?: string };
    expect(json.stamped).toBe(false);
    expect(json.at).toBeUndefined();
  });
});
