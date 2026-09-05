// org-branding-white-label 2026-07-16 #3: an over-long logo URL must be REJECTED (stored null +
// reported in `rejected`), never truncated to 500 chars after SSRF validation — the old slice stored
// a broken, no-longer-validated URL while the form showed a green "Saved".

import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockGetPrisma } = vi.hoisted(() => ({ mockGetPrisma: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ getPrisma: mockGetPrisma, isDbConfigured: () => true }));
// The SSRF guard is exercised elsewhere (logo-fetch.test.ts / ssrf tests); here it always passes so
// the length bound is isolated: a SAFE-but-long URL is exactly the case the old slice corrupted.
vi.mock("@/lib/net/ssrf", () => ({ isSafePublicHttpsUrl: () => true }));

import { setOrgBranding } from "./branding";

function fakePrisma() {
  const update = vi.fn(async () => ({}));
  mockGetPrisma.mockReturnValue({
    organization: {
      findUnique: vi.fn(async () => ({ id: "org_1" })),
      update,
    },
  });
  return { update };
}

beforeEach(() => vi.clearAllMocks());

describe("setOrgBranding logoUrl length bound (#3)", () => {
  it("stores a safe URL at the 500-char bound verbatim", async () => {
    const { update } = fakePrisma();
    const url = "https://cdn.example/logo.png?sig=" + "a".repeat(500 - "https://cdn.example/logo.png?sig=".length);
    expect(url).toHaveLength(500);
    const res = await setOrgBranding("acme", { brandName: null, brandColor: null, logoUrl: url });
    expect(res?.branding.logoUrl).toBe(url);
    expect(res?.rejected).toEqual([]);
    expect(update.mock.calls[0]![0]).toMatchObject({ data: { logoUrl: url } });
  });

  it("REJECTS a 501+ char URL (stored null + listed in rejected) instead of slicing it", async () => {
    const { update } = fakePrisma();
    const url = "https://cdn.example/logo.png?sig=" + "a".repeat(600);
    const res = await setOrgBranding("acme", { brandName: null, brandColor: null, logoUrl: url });
    expect(res?.branding.logoUrl).toBeNull();
    expect(res?.rejected).toContain("logoUrl");
    // Nothing truncated lands in the DB — the stored value is null, never a chopped URL.
    expect(update.mock.calls[0]![0]).toMatchObject({ data: { logoUrl: null } });
  });
});
