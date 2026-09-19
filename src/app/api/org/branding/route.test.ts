// Pins POST /api/org/branding's audit contract: every successful write records
// `org.branding.updated`; a denied/failed POST must not leave a trail row.
//
// next/server is faked as a class so `requireOrgOwnerPost`'s `instanceof NextResponse` branch works.
// db / authz / auth / access / logo-fetch are mocked; planAllowsWhiteLabel stays REAL (driven by the
// mocked credit.plan). Preview / PDF download / contrast live in other modules and are not touched.

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
  resolveViewerLogin: vi.fn(),
  resolveSafeLogoDataUri: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  isDbConfigured: h.isDbConfigured,
  getCreditState: h.getCreditState,
  setOrgBranding: h.setOrgBranding,
  recordOrgAudit: h.recordOrgAudit,
}));
vi.mock("@/lib/authz", () => ({ requireOrgRole: h.requireOrgRole }));
vi.mock("@/lib/auth", () => ({ requireSameOrigin: h.requireSameOrigin }));
vi.mock("@/lib/access", () => ({ resolveViewerLogin: h.resolveViewerLogin }));
vi.mock("@/lib/net/logo-fetch", () => ({ resolveSafeLogoDataUri: h.resolveSafeLogoDataUri }));

import { POST } from "./route";
import { NextResponse } from "next/server";

const deny = (status: number) => NextResponse.json({ error: "denied" }, { status });

const stored = {
  branding: {
    brandName: "Acme Inc.",
    brandColor: "#c41e3a",
    logoUrl: "https://cdn.example/acme.png",
  },
  rejected: [] as string[],
};

function post(body: Record<string, unknown>) {
  return POST(
    new Request("http://localhost/api/org/branding", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  h.isDbConfigured.mockReturnValue(true);
  h.requireOrgRole.mockResolvedValue(null);
  h.requireSameOrigin.mockReturnValue(null);
  h.getCreditState.mockResolvedValue({ plan: "team", balance: 0, unlimited: false });
  h.setOrgBranding.mockResolvedValue(stored);
  h.recordOrgAudit.mockResolvedValue(true);
  h.resolveViewerLogin.mockResolvedValue("owner-a");
  h.resolveSafeLogoDataUri.mockResolvedValue("data:image/png;base64,xx");
});

describe("POST /api/org/branding — audit on success", () => {
  it("records org.branding.updated with the normalized values that landed", async () => {
    const res = await post({
      org: "acme",
      brandName: "Acme Inc.",
      brandColor: "#c41e3a",
      logoUrl: "https://cdn.example/acme.png",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      branding: stored.branding,
      rejected: [],
      logoUnreachable: false,
    });
    expect(h.setOrgBranding).toHaveBeenCalledTimes(1);
    expect(h.recordOrgAudit).toHaveBeenCalledTimes(1);
    const [action, org, meta, actor] = h.recordOrgAudit.mock.calls[0]!;
    expect(action).toBe("org.branding.updated");
    expect(org).toBe("acme");
    expect(actor).toBe("owner-a");
    expect(meta).toMatchObject({
      org: "acme",
      brandName: "Acme Inc.",
      brandColor: "#c41e3a",
      logoUrl: "https://cdn.example/acme.png",
      rejected: [],
    });
    expect(String((meta as { status: string }).status)).toContain("Acme Inc.");
    expect(String((meta as { status: string }).status)).toContain("#c41e3a");
    expect(String((meta as { status: string }).status)).toContain("logo");
  });

  it("still audits when the owner clears branding (all-null write)", async () => {
    h.setOrgBranding.mockResolvedValue({
      branding: { brandName: null, brandColor: null, logoUrl: null },
      rejected: [],
    });
    const res = await post({ org: "acme", brandName: "", brandColor: "", logoUrl: "" });
    expect(res.status).toBe(200);
    expect(h.recordOrgAudit).toHaveBeenCalledTimes(1);
    const [, , meta] = h.recordOrgAudit.mock.calls[0]!;
    expect(meta).toMatchObject({ brandName: null, brandColor: null, logoUrl: null });
    expect((meta as { status: string }).status).toBe("cleared");
    expect(h.resolveSafeLogoDataUri).not.toHaveBeenCalled();
  });

  it("audits even when the saved logo later probes unreachable (advisory, not a failed write)", async () => {
    h.resolveSafeLogoDataUri.mockResolvedValue(null);
    const res = await post({ org: "acme", logoUrl: "https://cdn.example/acme.png" });
    expect(res.status).toBe(200);
    expect((await res.json()).logoUnreachable).toBe(true);
    expect(h.recordOrgAudit).toHaveBeenCalledTimes(1);
    expect(h.recordOrgAudit.mock.calls[0]![0]).toBe("org.branding.updated");
  });

  it("records dropped fields in the audit row when the validator rejected an input", async () => {
    h.setOrgBranding.mockResolvedValue({
      branding: { brandName: "Acme", brandColor: null, logoUrl: null },
      rejected: ["brandColor", "logoUrl"],
    });
    await post({ org: "acme", brandName: "Acme", brandColor: "red", logoUrl: "http://insecure.example/x.png" });
    const [, , meta] = h.recordOrgAudit.mock.calls[0]!;
    expect(meta).toMatchObject({ rejected: ["brandColor", "logoUrl"] });
    expect(String((meta as { status: string }).status)).toContain("dropped");
  });
});

describe("POST /api/org/branding — no audit unless the write succeeded", () => {
  it("503 db off: writes and audits nothing", async () => {
    h.isDbConfigured.mockReturnValue(false);
    expect((await post({ org: "acme", brandName: "Acme" })).status).toBe(503);
    expect(h.setOrgBranding).not.toHaveBeenCalled();
    expect(h.recordOrgAudit).not.toHaveBeenCalled();
  });

  it("403 cross-origin: writes and audits nothing", async () => {
    h.requireSameOrigin.mockReturnValue(deny(403));
    expect((await post({ org: "acme", brandName: "Acme" })).status).toBe(403);
    expect(h.setOrgBranding).not.toHaveBeenCalled();
    expect(h.recordOrgAudit).not.toHaveBeenCalled();
  });

  it("propagates a non-owner refusal and audits nothing", async () => {
    h.requireOrgRole.mockResolvedValue(deny(403));
    expect((await post({ org: "acme", brandName: "Acme" })).status).toBe(403);
    expect(h.setOrgBranding).not.toHaveBeenCalled();
    expect(h.recordOrgAudit).not.toHaveBeenCalled();
  });

  it("400 missing org: writes and audits nothing", async () => {
    expect((await post({ brandName: "Acme" })).status).toBe(400);
    expect(h.setOrgBranding).not.toHaveBeenCalled();
    expect(h.recordOrgAudit).not.toHaveBeenCalled();
  });

  it("403 below the Team white-label tier: writes and audits nothing", async () => {
    h.getCreditState.mockResolvedValue({ plan: "pro", balance: 0, unlimited: false });
    const res = await post({ org: "acme", brandName: "Acme" });
    expect(res.status).toBe(403);
    expect(h.setOrgBranding).not.toHaveBeenCalled();
    expect(h.recordOrgAudit).not.toHaveBeenCalled();
  });

  it("503 when the plan read fails: writes and audits nothing", async () => {
    h.getCreditState.mockRejectedValue(new Error("db down"));
    expect((await post({ org: "acme", brandName: "Acme" })).status).toBe(503);
    expect(h.setOrgBranding).not.toHaveBeenCalled();
    expect(h.recordOrgAudit).not.toHaveBeenCalled();
  });

  it("404 unknown org: audits nothing (the write did not land)", async () => {
    h.setOrgBranding.mockResolvedValue(null);
    expect((await post({ org: "ghost", brandName: "Ghost" })).status).toBe(404);
    expect(h.recordOrgAudit).not.toHaveBeenCalled();
  });

  it("does not withhold the save when the audit write itself rejects", async () => {
    h.recordOrgAudit.mockRejectedValue(new Error("audit down"));
    const res = await post({ org: "acme", brandName: "Acme Inc." });
    expect(res.status).toBe(200);
    expect((await res.json()).ok).toBe(true);
  });
});
