// branding-1: POST /api/org/branding/check answers "what would this save do" without doing it. Same
// gate stack as POST /api/org/branding (same-origin, owner, public-org refusal, Team plan with a 503
// on a plan-read failure); writes nothing, audits nothing, and never echoes the fetched logo bytes.

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class MockNextResponse extends Response {
    static json(body: unknown, init?: ResponseInit) {
      return new MockNextResponse(JSON.stringify(body), {
        status: (init as { status?: number } | undefined)?.status ?? 200,
        headers: { "content-type": "application/json" },
      });
    }
  },
}));

const h = vi.hoisted(() => ({
  isDbConfigured: vi.fn(() => true),
  getCreditState: vi.fn(),
  setOrgBranding: vi.fn(),
  recordOrgAudit: vi.fn(),
  requireOrgRole: vi.fn(),
  requireSameOrigin: vi.fn(),
  fetchSafeLogo: vi.fn(),
  setOrgLogoSnapshot: vi.fn(),
  update: vi.fn(),
  refusePublic: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  isDbConfigured: h.isDbConfigured,
  getCreditState: h.getCreditState,
  setOrgBranding: h.setOrgBranding,
  recordOrgAudit: h.recordOrgAudit,
}));
vi.mock("@/lib/db/client", () => ({ isDbConfigured: () => true, getPrisma: () => ({ organization: { update: h.update } }) }));
vi.mock("@/lib/authz", () => ({
  refusePublicOrgAdmin: h.refusePublic,
  requireOrgRole: h.requireOrgRole,
}));
vi.mock("@/lib/auth", () => ({ requireSameOrigin: h.requireSameOrigin }));
vi.mock("@/lib/net/logo-fetch", () => ({ fetchSafeLogo: h.fetchSafeLogo }));
vi.mock("@/lib/db/org-logo-snapshot", () => ({ setOrgLogoSnapshot: h.setOrgLogoSnapshot }));

import { POST } from "./route";
import { __resetRateLimiterState } from "@/lib/rate-limit";
import { NextResponse } from "next/server";

const deny = (status: number) => NextResponse.json({ error: "denied" }, { status });

function post(body: Record<string, unknown>) {
  return POST(
    new Request("http://localhost/api/org/branding/check", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

const LOGO = "https://acme.com/logo.png";

beforeEach(() => {
  vi.clearAllMocks();
  __resetRateLimiterState();
  h.isDbConfigured.mockReturnValue(true);
  h.requireOrgRole.mockResolvedValue(null);
  h.requireSameOrigin.mockReturnValue(null);
  h.getCreditState.mockResolvedValue({ plan: "team" });
  h.fetchSafeLogo.mockResolvedValue({ ok: false, reason: "unreachable" });
  h.refusePublic.mockImplementation((org: string) => (org.toLowerCase() === "public" ? deny(403) : null));
});

function assertNoWrite() {
  expect(h.update).not.toHaveBeenCalled();
  expect(h.setOrgBranding).not.toHaveBeenCalled();
  expect(h.recordOrgAudit).not.toHaveBeenCalled();
  expect(h.setOrgLogoSnapshot).not.toHaveBeenCalled();
}

describe("POST /api/org/branding/check verdict", () => {
  it("an unreachable logo: 200 with logo 'unreachable', contrast on both surfaces, and no write", async () => {
    const res = await post({ org: "acme", logoUrl: LOGO, probeLogo: true });
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d).toMatchObject({
      branding: { brandName: null, brandColor: null, logoUrl: LOGO },
      rejected: [],
      reasons: {},
      logo: "unreachable",
      logoReason: "unreachable",
    });
    expect(typeof d.contrast.onWhite).toBe("number");
    expect(typeof d.contrast.onDark).toBe("number");
    expect(h.fetchSafeLogo).toHaveBeenCalledWith(LOGO);
    assertNoWrite();
  });

  it("never echoes the fetched bytes, even when the logo is fine", async () => {
    h.fetchSafeLogo.mockResolvedValue({ ok: true, bytes: Buffer.from("png"), mime: "image/png", sha256: "c".repeat(64), dataUri: "data:image/png;base64,cG5n" });
    const res = await post({ org: "acme", logoUrl: LOGO, probeLogo: true });
    const text = await res.text();
    expect(JSON.parse(text).logo).toBe("ok");
    expect(text).not.toContain("data:");
    expect(text).not.toContain("cG5n");
    assertNoWrite();
  });

  it("names each rejection's reason and never probes a rejected URL", async () => {
    const d = await (await post({ org: "acme", logoUrl: "http://acme.com/l.png", brandColor: "blue", probeLogo: true })).json();
    expect(d.rejected).toEqual(["brandColor", "logoUrl"]);
    expect(d.reasons).toEqual({ brandColor: "not-hex", logoUrl: "not-https" });
    expect(d.logo).toBe("rejected");
    expect(h.fetchSafeLogo).not.toHaveBeenCalled();
  });

  it("does not fetch unless probeLogo is set", async () => {
    const d = await (await post({ org: "acme", logoUrl: LOGO })).json();
    expect(d.logo).toBe("unchecked");
    expect(h.fetchSafeLogo).not.toHaveBeenCalled();
  });

  it("caps logo probes per org so the check is not a fetch-anything probe", async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 12; i++) statuses.push((await post({ org: "acme", logoUrl: `${LOGO}?v=${i}`, probeLogo: true })).status);
    expect(statuses.slice(0, 10).every((s) => s === 200)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
    expect(h.fetchSafeLogo).toHaveBeenCalledTimes(10);
  });
});

describe("POST /api/org/branding/check gate (identical to the save)", () => {
  it("Free plan -> 403 with the save's message", async () => {
    h.getCreditState.mockResolvedValue({ plan: "free" });
    const res = await post({ org: "acme", logoUrl: LOGO, probeLogo: true });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "Briefing branding is a Team-plan feature." });
    expect(h.fetchSafeLogo).not.toHaveBeenCalled();
  });

  it("a plan read failure -> 503", async () => {
    h.getCreditState.mockRejectedValue(new Error("db down"));
    expect((await post({ org: "acme", logoUrl: LOGO })).status).toBe(503);
  });

  it.each(["public", "Public"])("refuses the public org %j", async (org) => {
    expect((await post({ org, logoUrl: LOGO, probeLogo: true })).status).toBe(403);
    expect(h.fetchSafeLogo).not.toHaveBeenCalled();
  });

  it("cross-origin -> 403", async () => {
    h.requireSameOrigin.mockReturnValue(deny(403));
    expect((await post({ org: "acme", logoUrl: LOGO })).status).toBe(403);
    expect(h.getCreditState).not.toHaveBeenCalled();
  });

  it("a non-owner is refused by the owner gate", async () => {
    h.requireOrgRole.mockResolvedValue(deny(403));
    expect((await post({ org: "acme", logoUrl: LOGO, probeLogo: true })).status).toBe(403);
    expect(h.fetchSafeLogo).not.toHaveBeenCalled();
  });
});
