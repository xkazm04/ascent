import { afterEach, describe, expect, it, vi } from "vitest";

import { isLocalOrg, localOrgName, localOrgSlug } from "@/lib/local/org";

// `selfHosted()` is read at call time, so stubbing the env is enough — no module mock needed.
// ASCENT_SELF_HOSTED=1 makes selfHosted() true explicitly rather than relying on the billing sniff,
// which would otherwise make these assertions depend on whether Polar happens to be configured.
function localMode(value: string | undefined, name?: string) {
  vi.stubEnv("ASCENT_SELF_HOSTED", "1");
  vi.stubEnv("ASCENT_LOCAL_ORG", value ?? "");
  vi.stubEnv("ASCENT_LOCAL_ORG_NAME", name ?? "");
}

afterEach(() => vi.unstubAllEnvs());

describe("the declared local org", () => {
  it("is off unless the flag says otherwise", () => {
    localMode(undefined);
    expect(localOrgSlug()).toBeNull();
    expect(localOrgName()).toBeNull();
  });

  it("treats a boolean flag as the default slug", () => {
    for (const truthy of ["1", "true", "TRUE"]) {
      localMode(truthy);
      expect(localOrgSlug()).toBe("local");
    }
  });

  it("honours an explicit off switch", () => {
    for (const falsy of ["0", "false"]) {
      localMode(falsy);
      expect(localOrgSlug()).toBeNull();
    }
  });

  it("uses any other value AS the slug, lowercased", () => {
    localMode("Kiro");
    expect(localOrgSlug()).toBe("kiro");
  });

  it("refuses an unusable slug rather than falling back to the default", () => {
    // The fallback is the tempting behaviour and the wrong one: a typo would silently create an org
    // under a name the operator never chose, and they would go looking for the one they typed.
    for (const bad of ["has space", "-leading", "a/b", "x".repeat(40), "!"]) {
      localMode(bad);
      expect(localOrgSlug()).toBeNull();
    }
  });

  it("never declares an org off a self-hosted deployment", () => {
    vi.stubEnv("ASCENT_SELF_HOSTED", "0");
    vi.stubEnv("ASCENT_LOCAL_ORG", "kiro");
    expect(localOrgSlug()).toBeNull();
  });

  it("falls back to the slug for a display name", () => {
    localMode("kiro");
    expect(localOrgName()).toBe("kiro");
    localMode("kiro", "Kiro Workshop");
    expect(localOrgName()).toBe("Kiro Workshop");
  });

  describe("isLocalOrg — the guard that keeps this door off real tenants", () => {
    it("matches the declared slug case- and whitespace-insensitively", () => {
      localMode("kiro");
      expect(isLocalOrg("kiro")).toBe(true);
      expect(isLocalOrg("  KIRO ")).toBe(true);
    });

    it("rejects any other org, and everything when the feature is off", () => {
      localMode("kiro");
      expect(isLocalOrg("vercel")).toBe(false);
      expect(isLocalOrg(null)).toBe(false);
      expect(isLocalOrg(undefined)).toBe(false);
      localMode(undefined);
      expect(isLocalOrg("kiro")).toBe(false);
    });
  });
});
