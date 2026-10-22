// branding-1: normalizeBranding is the one validation door. It must reproduce EXACTLY what
// setOrgBranding persisted before the relocation (the legacy inline rule is copied below as the
// parity oracle), add a reason per rejection, and be what setOrgBranding now calls.

import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockGetPrisma } = vi.hoisted(() => ({ mockGetPrisma: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ getPrisma: mockGetPrisma, isDbConfigured: () => true }));

import { normalizeBranding, type OrgBranding } from "./normalize";
import { setOrgBranding } from "@/lib/db/branding";
import { isSafePublicHttpsUrl } from "@/lib/net/ssrf";
import { HEX_COLOR_RE } from "@/lib/branding/color";

/** The pre-relocation body of setOrgBranding (src/lib/db/branding.ts at 03bbb72a), verbatim. */
function legacy(input: OrgBranding) {
  const brandName = input.brandName?.trim().slice(0, 80) || null;
  const brandColor = input.brandColor && HEX_COLOR_RE.test(input.brandColor.trim()) ? input.brandColor.trim().toLowerCase() : null;
  const trimmedLogo = input.logoUrl?.trim() ?? "";
  const logoUrl = trimmedLogo && trimmedLogo.length <= 500 && isSafePublicHttpsUrl(trimmedLogo) ? trimmedLogo : null;
  const rejected: string[] = [];
  if (input.brandColor?.trim() && !brandColor) rejected.push("brandColor");
  if (input.logoUrl?.trim() && !logoUrl) rejected.push("logoUrl");
  return { branding: { brandName, brandColor, logoUrl }, rejected };
}

const full = (over: Partial<OrgBranding>): OrgBranding => ({ brandName: null, brandColor: null, logoUrl: null, ...over });

const CASES: { input: OrgBranding; reasons: Record<string, string> }[] = [
  { input: full({ logoUrl: "http://acme.com/l.png" }), reasons: { logoUrl: "not-https" } },
  { input: full({ logoUrl: "https://10.0.0.1/l.png" }), reasons: { logoUrl: "private-host" } },
  { input: full({ logoUrl: "https://acme.com/" + "x".repeat(600) }), reasons: { logoUrl: "too-long" } },
  { input: full({ brandColor: "blue" }), reasons: { brandColor: "not-hex" } },
  { input: full({ brandName: "x".repeat(90) }), reasons: {} },
  { input: full({}), reasons: {} },
];

function fakePrisma() {
  const update = vi.fn(async () => ({}));
  mockGetPrisma.mockReturnValue({ organization: { findUnique: vi.fn(async () => ({ id: "org_1" })), update } });
  return { update };
}

beforeEach(() => vi.clearAllMocks());

describe("normalizeBranding parity with the legacy save rule", () => {
  it.each(CASES.map((c, i) => [i, c] as const))("case %i: same branding + rejected, plus the reason", (_i, c) => {
    const out = normalizeBranding(c.input);
    const old = legacy(c.input);
    expect(out.branding).toEqual(old.branding);
    expect(out.rejected).toEqual(old.rejected);
    expect(out.reasons).toEqual(c.reasons);
  });

  it("truncates a 90-char name to 80 without rejecting it", () => {
    const out = normalizeBranding(full({ brandName: "x".repeat(90) }));
    expect(out.branding.brandName).toHaveLength(80);
    expect(out.rejected).toEqual([]);
  });

  it("treats whitespace as a deliberate clear, not a rejection", () => {
    const out = normalizeBranding({ brandName: "  ", brandColor: " ", logoUrl: "  " });
    expect(out).toEqual({ branding: { brandName: null, brandColor: null, logoUrl: null }, rejected: [], reasons: {} });
  });

  it("lower-cases and keeps a valid hex and a public https logo", () => {
    const out = normalizeBranding({ brandColor: " #C41E3A ", logoUrl: " https://acme.com/logo.png " });
    expect(out.branding).toEqual({ brandName: null, brandColor: "#c41e3a", logoUrl: "https://acme.com/logo.png" });
    expect(out.rejected).toEqual([]);
  });
});

describe("setOrgBranding calls normalizeBranding", () => {
  it.each(CASES.map((c, i) => [i, c] as const))("case %i: prisma update data is unchanged", async (_i, c) => {
    const { update } = fakePrisma();
    const res = await setOrgBranding("acme", c.input);
    const old = legacy(c.input);
    expect(update.mock.calls[0]![0]).toEqual({ where: { id: "org_1" }, data: old.branding });
    expect(res).toMatchObject({ branding: old.branding, rejected: old.rejected, reasons: c.reasons });
  });
});
