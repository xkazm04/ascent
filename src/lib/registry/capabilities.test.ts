// The capability truth table. This is a SECURITY-SHAPED module even though it reads like UI plumbing:
// it decides whether the tab renders a control that mints an installation token and writes to the
// customer's GitHub org. So the properties pinned here are (a) it fails closed on every error, and
// (b) the role check happens BEFORE any token-mint attempt — an unauthorized viewer must never cause
// ascent to reach for a credential.

import { beforeEach, describe, expect, it, vi } from "vitest";

const isDbConfigured = vi.fn(() => true);
const isAppConfigured = vi.fn(() => true);
const getInstallationIdForOwner = vi.fn(async () => "42" as string | null);
const hasOrgRole = vi.fn(async () => true);
const canMintInstallationToken = vi.fn(async () => true);
const githubAppFetch = vi.fn(async () => ({
  permissions: { administration: "write" },
  account: { type: "Organization" },
}));

vi.mock("@/lib/db/client", () => ({ isDbConfigured: () => isDbConfigured() }));
vi.mock("@/lib/db/installations", () => ({
  getInstallationIdForOwner: () => getInstallationIdForOwner(),
}));
vi.mock("@/lib/authz", () => ({
  hasOrgRole: () => hasOrgRole(),
  canMintInstallationToken: () => canMintInstallationToken(),
}));
vi.mock("@/lib/github/app", () => ({
  isAppConfigured: () => isAppConfigured(),
  appInstallUrl: () => "https://github.com/apps/ascent/installations/new",
  createAppJwt: () => "jwt",
  githubAppFetch: () => githubAppFetch(),
}));

import { getRegistryCapabilities, resetRegistryCapabilityCache } from "./capabilities";

beforeEach(() => {
  resetRegistryCapabilityCache();
  isDbConfigured.mockReturnValue(true);
  isAppConfigured.mockReturnValue(true);
  getInstallationIdForOwner.mockResolvedValue("42");
  hasOrgRole.mockResolvedValue(true);
  canMintInstallationToken.mockResolvedValue(true);
  githubAppFetch.mockResolvedValue({ permissions: { administration: "write" }, account: { type: "Organization" } });
  githubAppFetch.mockClear();
  canMintInstallationToken.mockClear();
  getInstallationIdForOwner.mockClear();
});

describe("getRegistryCapabilities truth table", () => {
  it("everything present -> full capability, no reason", async () => {
    expect(await getRegistryCapabilities("acme")).toEqual({
      appConfigured: true,
      installed: true,
      canWrite: true,
      canCreateRepo: true,
      reason: null,
      installUrl: "https://github.com/apps/ascent/installations/new",
    });
  });

  it("no database -> persistence-off, nothing else is even probed", async () => {
    isDbConfigured.mockReturnValue(false);
    const c = await getRegistryCapabilities("acme");
    expect(c).toMatchObject({ reason: "persistence-off", appConfigured: false, canWrite: false });
    expect(getInstallationIdForOwner).not.toHaveBeenCalled();
  });

  it("App env missing -> app-not-configured", async () => {
    isAppConfigured.mockReturnValue(false);
    expect(await getRegistryCapabilities("acme")).toMatchObject({ reason: "app-not-configured", canWrite: false });
  });

  it("no installation -> not-installed, but keeps the install link", async () => {
    getInstallationIdForOwner.mockResolvedValue(null);
    expect(await getRegistryCapabilities("acme")).toMatchObject({
      reason: "not-installed",
      appConfigured: true,
      installed: false,
      canWrite: false,
      installUrl: "https://github.com/apps/ascent/installations/new",
    });
  });

  it("viewer below the role floor -> insufficient-role, and NO token mint is attempted", async () => {
    hasOrgRole.mockResolvedValue(false);
    const c = await getRegistryCapabilities("acme");
    expect(c).toMatchObject({ reason: "insufficient-role", installed: true, canWrite: false });
    expect(canMintInstallationToken).not.toHaveBeenCalled();
  });

  it("token not mintable -> token-not-mintable", async () => {
    canMintInstallationToken.mockResolvedValue(false);
    expect(await getRegistryCapabilities("acme")).toMatchObject({ reason: "token-not-mintable", canWrite: false });
  });

  it("a thrown role check fails CLOSED", async () => {
    hasOrgRole.mockRejectedValue(new Error("db down"));
    expect(await getRegistryCapabilities("acme")).toMatchObject({ canWrite: false, reason: "insufficient-role" });
  });

  it("write is possible without create when `administration` is not granted", async () => {
    githubAppFetch.mockResolvedValue({ permissions: { contents: "write" }, account: { type: "Organization" } });
    expect(await getRegistryCapabilities("acme")).toMatchObject({ canWrite: true, canCreateRepo: false });
  });

  it("a USER account can never create — only an organization can", async () => {
    githubAppFetch.mockResolvedValue({ permissions: { administration: "write" }, account: { type: "User" } });
    expect(await getRegistryCapabilities("dev")).toMatchObject({ canWrite: true, canCreateRepo: false });
  });

  it("a failed permission probe is not a grant", async () => {
    githubAppFetch.mockRejectedValue(new Error("rate limited"));
    expect(await getRegistryCapabilities("acme")).toMatchObject({ canWrite: true, canCreateRepo: false });
  });

  it("probeCreate:false skips the GitHub round-trip entirely", async () => {
    const c = await getRegistryCapabilities("acme", { probeCreate: false });
    expect(c).toMatchObject({ canWrite: true, canCreateRepo: false });
    expect(githubAppFetch).not.toHaveBeenCalled();
  });

  it("memoizes the permission probe across calls, and the reset seam clears it", async () => {
    await getRegistryCapabilities("acme");
    await getRegistryCapabilities("acme");
    expect(githubAppFetch).toHaveBeenCalledTimes(1);
    resetRegistryCapabilityCache();
    await getRegistryCapabilities("acme");
    expect(githubAppFetch).toHaveBeenCalledTimes(2);
  });
});
