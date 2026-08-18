// The capability → rendered-actions truth table.
//
// This is the rule that keeps the Registry tab honest: a GitHub button may only appear when ascent can
// actually complete it, because a dead button that 403s teaches the user the product is broken. The rule
// is asserted here rather than through the panel's markup — the decision is the thing worth pinning, and
// a pure function is cheap enough to test exhaustively.

import { describe, expect, it } from "vitest";
import { ERROR_SENTENCE, canRender, capabilityNotice, visibleActions } from "./registryActionRules";
import type { RegistryCapabilities } from "@/lib/registry/capabilities";

/** Everything present: App configured, installed, admin viewer, org account. */
function caps(over: Partial<RegistryCapabilities> = {}): RegistryCapabilities {
  return {
    appConfigured: true,
    installed: true,
    canWrite: true,
    canCreateRepo: true,
    reason: null,
    installUrl: "https://github.com/apps/ascent/installations/new",
    ...over,
  } as RegistryCapabilities;
}

describe("visibleActions", () => {
  it("offers create + map when everything is present and nothing is mapped", () => {
    expect(visibleActions(caps(), { mapped: false })).toEqual(["create-registry", "map-existing"]);
  });

  it("drops create on a user account (repo creation needs an Organization)", () => {
    expect(visibleActions(caps({ canCreateRepo: false }), { mapped: false })).toEqual(["map-existing"]);
  });

  it("switches to the operating set once a registry is mapped", () => {
    expect(visibleActions(caps(), { mapped: true })).toEqual(["reindex", "migrate", "open-repo"]);
  });

  // The load-bearing cases: no write path ⇒ no GitHub affordance, mapped or not.
  it("renders NO github action for a viewer who cannot write", () => {
    for (const mapped of [true, false]) {
      expect(visibleActions(caps({ canWrite: false, reason: "insufficient-role" }), { mapped })).toEqual([]);
      expect(visibleActions(caps({ canWrite: false, reason: "token-not-mintable" }), { mapped })).toEqual([]);
    }
  });

  it("offers only the install link when the App is not installed, and only if there is one", () => {
    const notInstalled = caps({ installed: false, canWrite: false, reason: "not-installed" });
    expect(visibleActions(notInstalled, { mapped: false })).toEqual(["install-app"]);
    // No install URL to give ⇒ nothing at all, rather than a link to nowhere.
    expect(visibleActions({ ...notInstalled, installUrl: null }, { mapped: false })).toEqual([]);
  });

  it("renders nothing actionable when the App is not configured on the deployment", () => {
    const unconfigured = caps({ appConfigured: false, installed: false, canWrite: false, reason: "app-not-configured", installUrl: null });
    expect(visibleActions(unconfigured, { mapped: false })).toEqual([]);
    expect(visibleActions(unconfigured, { mapped: true })).toEqual([]);
  });

  it("never leaks a mapped-state action into an unwritable state", () => {
    const every: RegistryCapabilities[] = [
      caps({ appConfigured: false, installed: false, canWrite: false, reason: "app-not-configured" }),
      caps({ installed: false, canWrite: false, reason: "not-installed" }),
      caps({ canWrite: false, reason: "insufficient-role" }),
      caps({ canWrite: false, reason: "token-not-mintable" }),
    ];
    for (const c of every) {
      const actions = visibleActions(c, { mapped: true });
      for (const write of ["create-registry", "map-existing", "reindex", "migrate"] as const) {
        expect(canRender(actions, write)).toBe(false);
      }
    }
  });
});

describe("capabilityNotice", () => {
  it("is null exactly when the viewer can write", () => {
    expect(capabilityNotice(caps(), "acme")).toBeNull();
  });

  it("explains every withheld state, and names the org where that helps", () => {
    const reasons = ["persistence-off", "app-not-configured", "not-installed", "insufficient-role", "token-not-mintable"] as const;
    for (const reason of reasons) {
      const notice = capabilityNotice(caps({ canWrite: false, reason }), "acme");
      expect(notice, reason).toBeTruthy();
      expect(notice!.length, reason).toBeGreaterThan(20);
    }
    expect(capabilityNotice(caps({ canWrite: false, reason: "not-installed" }), "acme")).toContain("acme");
  });
});

describe("ERROR_SENTENCE", () => {
  it("covers every error code the registry routes can return", () => {
    for (const code of ["persistence-off", "invalid-input", "not-permitted", "not-mapped", "github-error"]) {
      expect(ERROR_SENTENCE[code], code).toBeTruthy();
    }
  });
});
