// Local-first pairing, as the Registry tab reads it (self-hosted): which actions render, what the
// notice says, and how the six steps resolve when the registry is read from a paired checkout with no
// GitHub App. The hosted truth table stays in registryActionRules.test.ts — with the local flags
// absent, nothing there changes.

import { describe, expect, it } from "vitest";
import type { RegistryCapabilities } from "@/lib/registry/capabilities";
import { fixtureRegistryView } from "@/lib/org/registry-view.fixture";
import { capabilityNotice, visibleActions } from "./registryActionRules";
import { registrySteps } from "./registryModel";

const NO_APP: RegistryCapabilities = {
  appConfigured: false,
  installed: false,
  canWrite: false,
  canCreateRepo: false,
  reason: "app-not-configured",
  installUrl: null,
};

describe("visibleActions — local first", () => {
  it("offers pairing on a self-hosted org with no App, where the hosted path offers nothing", () => {
    expect(visibleActions(NO_APP, { mapped: false })).toEqual([]);
    expect(visibleActions({ ...NO_APP, localAvailable: true }, { mapped: false })).toEqual(["pair-local"]);
  });

  it("puts pairing ahead of the App's own actions when both are open", () => {
    const full: RegistryCapabilities = { ...NO_APP, appConfigured: true, installed: true, canWrite: true, canCreateRepo: true, reason: null };
    expect(visibleActions({ ...full, localAvailable: true }, { mapped: false })).toEqual(["pair-local", "create-registry", "map-existing"]);
  });

  it("re-indexes a paired registry without the App, and adds the GitHub writers only when it can act", () => {
    const paired = { ...NO_APP, localAvailable: true, localPaired: true };
    expect(visibleActions(paired, { mapped: true })).toEqual(["reindex"]);
    expect(visibleActions({ ...paired, appConfigured: true, installed: true, canWrite: true, reason: null }, { mapped: true })).toEqual([
      "reindex",
      "migrate",
      "open-repo",
    ]);
  });

  it("says GitHub is optional on a self-hosted install, and says nothing once paired", () => {
    expect(capabilityNotice({ ...NO_APP, localAvailable: true }, "acme")).toMatch(/optional/i);
    expect(capabilityNotice({ ...NO_APP, localAvailable: true, localPaired: true }, "acme")).toBeNull();
  });
});

describe("registrySteps — a locally paired registry", () => {
  const base = fixtureRegistryView("acme", "indexed")!;
  const view = {
    ...base,
    registry: { ...base.registry!, mode: "git_native" as const, localPath: "C:/code/ai-registry" },
    permission: { contentsWrite: false },
    migration: {
      skills: { state: "not-started" as const, moved: 0, total: 0 },
      practices: { state: "not-started" as const, moved: 0, total: 0 },
      memory: { state: "not-started" as const, moved: 0, total: 3 },
    },
  };
  const byId = Object.fromEntries(registrySteps(view).map((s) => [s.id, s]));

  it("names the checkout in step 1", () => {
    expect(byId.choose!.state).toBe("done");
    expect(byId.choose!.detail).toContain("C:/code/ai-registry");
  });

  it("reads the App permission step as optional, never blocked", () => {
    expect(byId.permissions!.state).toBe("skipped");
    expect(byId.permissions!.detail).toMatch(/optional/i);
  });

  it("does not block on migration PRs it cannot open, and says what they would need", () => {
    expect(byId.migrate!.state).toBe("skipped");
    expect(byId.migrate!.detail).toContain("GitHub App");
  });
});
