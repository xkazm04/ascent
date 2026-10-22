// readDeliverableBranding: the one door both client-facing deliverables (the board PDF and the
// anonymous share page) read white-label branding through. Pins: the paid-feature re-check runs
// before anything else is read; a snapshot whose sourceUrl matches the saved logo URL is served with
// no network call at all; a mismatched or missing snapshot heals once and persists, and a failed heal
// is a negative snapshot that is not retried inside the hour.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const h = vi.hoisted(() => ({
  getOrgBranding: vi.fn(),
  getCreditState: vi.fn(),
  getOrgLogoSnapshot: vi.fn(),
  setOrgLogoSnapshot: vi.fn(),
  fetchSafeLogo: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ getOrgBranding: h.getOrgBranding, getCreditState: h.getCreditState }));
vi.mock("@/lib/db/org-logo-snapshot", () => ({
  getOrgLogoSnapshot: h.getOrgLogoSnapshot,
  setOrgLogoSnapshot: h.setOrgLogoSnapshot,
}));
vi.mock("@/lib/net/logo-fetch", () => ({ fetchSafeLogo: h.fetchSafeLogo }));
vi.mock("@/lib/api/respond", () => ({ reportHandledError: vi.fn() }));

import { readDeliverableBranding, LOGO_NEGATIVE_TTL_MS } from "./deliverable";

const LOGO = "https://cdn.acme.com/l.png";
const BRANDING = { brandName: "Acme Corp", brandColor: "#c41e3a", logoUrl: LOGO };
const NOW = Date.parse("2026-10-22T12:00:00Z");
const okSnapshot = (sourceUrl: string) => ({
  sourceUrl,
  status: "ok" as const,
  dataUri: "data:image/png;base64,c25hcA==",
  sha256: "a".repeat(64),
  mime: "image/png",
  reason: null,
  fetchedAt: new Date(NOW - 86_400_000).toISOString(),
});

let fetchSpy: ReturnType<typeof vi.fn>;
beforeEach(() => {
  vi.clearAllMocks();
  fetchSpy = vi.fn();
  vi.stubGlobal("fetch", fetchSpy);
  vi.spyOn(console, "warn").mockImplementation(() => {});
  h.getOrgBranding.mockResolvedValue(BRANDING);
  h.getCreditState.mockResolvedValue({ plan: "team" });
  h.getOrgLogoSnapshot.mockResolvedValue(null);
  h.setOrgLogoSnapshot.mockResolvedValue(true);
  h.fetchSafeLogo.mockResolvedValue({
    ok: true,
    bytes: Buffer.from("new"),
    mime: "image/png",
    sha256: "b".repeat(64),
    dataUri: "data:image/png;base64,bmV3",
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("readDeliverableBranding - the entitlement re-check survives the move", () => {
  it("free plan -> null, and neither the snapshot nor any fetch is touched", async () => {
    h.getCreditState.mockResolvedValue({ plan: "free" });
    expect(await readDeliverableBranding("acme", { nowMs: NOW })).toBeNull();
    expect(h.getOrgLogoSnapshot).not.toHaveBeenCalled();
    expect(h.fetchSafeLogo).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("an unreadable plan is not an entitlement (null, like the two call sites it replaces)", async () => {
    h.getCreditState.mockRejectedValue(new Error("db down"));
    expect(await readDeliverableBranding("acme", { nowMs: NOW })).toBeNull();
  });

  it("no stored branding -> null with no snapshot read", async () => {
    h.getOrgBranding.mockResolvedValue(null);
    expect(await readDeliverableBranding("acme", { nowMs: NOW })).toBeNull();
    expect(h.getOrgLogoSnapshot).not.toHaveBeenCalled();
  });

  it("branding without a logo is returned as-is with no snapshot read", async () => {
    h.getOrgBranding.mockResolvedValue({ ...BRANDING, logoUrl: null });
    expect(await readDeliverableBranding("acme", { nowMs: NOW })).toEqual({ ...BRANDING, logoUrl: null });
    expect(h.getOrgLogoSnapshot).not.toHaveBeenCalled();
  });
});

describe("readDeliverableBranding - snapshot, not a per-render fetch", () => {
  it("a matching snapshot is served as the logo with no egress", async () => {
    h.getOrgLogoSnapshot.mockResolvedValue(okSnapshot(LOGO));
    expect(await readDeliverableBranding("acme", { nowMs: NOW })).toEqual({
      brandName: "Acme Corp",
      brandColor: "#c41e3a",
      logoUrl: "data:image/png;base64,c25hcA==",
    });
    expect(h.fetchSafeLogo).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("a snapshot of a different URL heals once: one fetch, persisted, new data URI returned", async () => {
    h.getOrgLogoSnapshot.mockResolvedValue(okSnapshot("https://cdn.acme.com/old.png"));
    const out = await readDeliverableBranding("acme", { nowMs: NOW });
    expect(out?.logoUrl).toBe("data:image/png;base64,bmV3");
    expect(h.fetchSafeLogo).toHaveBeenCalledTimes(1);
    expect(h.fetchSafeLogo).toHaveBeenCalledWith(LOGO);
    expect(h.setOrgLogoSnapshot).toHaveBeenCalledWith("acme", {
      sourceUrl: LOGO,
      sha256: "b".repeat(64),
      mime: "image/png",
      dataUri: "data:image/png;base64,bmV3",
    });
  });

  it("a failed heal records a negative snapshot and keeps the name and accent", async () => {
    h.fetchSafeLogo.mockResolvedValue({ ok: false, reason: "unsupported-format" });
    const out = await readDeliverableBranding("acme", { nowMs: NOW });
    expect(out).toEqual({ ...BRANDING, logoUrl: null });
    expect(h.setOrgLogoSnapshot).toHaveBeenCalledWith("acme", { sourceUrl: LOGO, failure: "unsupported-format" });
  });

  it("a negative snapshot younger than 1 h is not retried; an older one is", async () => {
    const failed = (ageMs: number) => ({
      sourceUrl: LOGO,
      status: "failed" as const,
      dataUri: null,
      sha256: null,
      mime: null,
      reason: "unreachable",
      fetchedAt: new Date(NOW - ageMs).toISOString(),
    });
    h.getOrgLogoSnapshot.mockResolvedValue(failed(LOGO_NEGATIVE_TTL_MS - 60_000));
    expect((await readDeliverableBranding("acme", { nowMs: NOW }))?.logoUrl).toBeNull();
    expect(h.fetchSafeLogo).not.toHaveBeenCalled();

    h.getOrgLogoSnapshot.mockResolvedValue(failed(LOGO_NEGATIVE_TTL_MS + 60_000));
    expect((await readDeliverableBranding("acme", { nowMs: NOW }))?.logoUrl).toBe("data:image/png;base64,bmV3");
    expect(h.fetchSafeLogo).toHaveBeenCalledTimes(1);
  });

  it("a snapshot read or write failure degrades to no logo, never a throw", async () => {
    h.getOrgLogoSnapshot.mockRejectedValue(new Error("db down"));
    h.setOrgLogoSnapshot.mockRejectedValue(new Error("db down"));
    const out = await readDeliverableBranding("acme", { nowMs: NOW });
    expect(out?.brandName).toBe("Acme Corp");
    expect(out?.logoUrl).toBe("data:image/png;base64,bmV3");
  });
});
