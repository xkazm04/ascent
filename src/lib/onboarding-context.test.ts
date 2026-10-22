// What /onboarding knows about the viewer (oauth-1). The page used to read installations, suggested
// orgs and the seeded org off the DORMANT custom-OAuth cookie only, which the live Supabase stack
// never mints, so a production viewer got a cold start and no session controls. The resolver keeps
// the dormant path exactly as it was and gives the live stack its own sources: membership-derived
// installations and the discovery row recorded at sign-in for the viewer's OWN login.

import { describe, it, expect, vi } from "vitest";
import { resolveOnboardingContext } from "./onboarding-context";

const DISCOVERY = { suggestedOrgs: ["acme", "beta"], seededOrg: "acme", discoveredAt: "2026-10-22T10:00:00.000Z" };

describe("resolveOnboardingContext - live (Supabase) stack", () => {
  it("returns installations, suggestions minus installed orgs, the seeded org and supabase controls", async () => {
    const ctx = await resolveOnboardingContext({
      session: null,
      viewer: { login: "dana" },
      getInstallations: async () => [{ id: 42, login: "acme" }],
      getLoginDiscovery: async () => DISCOVERY,
    });
    expect(ctx).toEqual({
      installations: [{ login: "acme", id: "42" }],
      suggestedOrgs: ["beta"],
      seededOrg: "acme",
      controls: "supabase",
    });
  });

  it("filters installed orgs case-insensitively", async () => {
    const ctx = await resolveOnboardingContext({
      session: null,
      viewer: { login: "dana" },
      getInstallations: async () => [{ id: 1, login: "Acme" }],
      getLoginDiscovery: async () => ({ ...DISCOVERY, suggestedOrgs: ["ACME", "beta"] }),
    });
    expect(ctx.suggestedOrgs).toEqual(["beta"]);
  });

  it("with no viewer and no session: empty, no controls, and the discovery reader is never invoked", async () => {
    const getLoginDiscovery = vi.fn(async () => DISCOVERY);
    const getInstallations = vi.fn(async () => [{ id: 1, login: "acme" }]);
    const ctx = await resolveOnboardingContext({ session: null, viewer: null, getInstallations, getLoginDiscovery });
    expect(ctx).toEqual({ installations: [], suggestedOrgs: [], seededOrg: undefined, controls: null });
    expect(getLoginDiscovery).not.toHaveBeenCalled();
    expect(getInstallations).not.toHaveBeenCalled();
  });

  it("reads discovery ONLY for the resolved viewer's own login, exactly once", async () => {
    const getLoginDiscovery = vi.fn<(login: string) => Promise<typeof DISCOVERY>>(async () => DISCOVERY);
    await resolveOnboardingContext({
      session: null,
      viewer: { login: "dana" },
      getInstallations: async () => [],
      getLoginDiscovery,
    });
    expect(getLoginDiscovery).toHaveBeenCalledTimes(1);
    expect(getLoginDiscovery).toHaveBeenCalledWith("dana");
  });

  it("the resolver accepts no request input: an extra searchParams-shaped field never reaches the reader", async () => {
    const getLoginDiscovery = vi.fn<(login: string) => Promise<typeof DISCOVERY>>(async () => DISCOVERY);
    await resolveOnboardingContext({
      session: null,
      viewer: { login: "dana" },
      getInstallations: async () => [],
      getLoginDiscovery,
      // A caller mistake: request input riding along. It must be ignored, not used as the key.
      ...({ searchParams: { login: "victim", org: "victim" } } as object),
    });
    expect(getLoginDiscovery.mock.calls).toEqual([["dana"]]);
  });

  it("an unreadable discovery (null) or a throwing reader yields empty suggestions and does not throw", async () => {
    const nullCtx = await resolveOnboardingContext({
      session: null,
      viewer: { login: "dana" },
      getInstallations: async () => [],
      getLoginDiscovery: async () => null,
    });
    expect(nullCtx).toMatchObject({ suggestedOrgs: [], seededOrg: undefined, controls: "supabase" });

    const thrown = await resolveOnboardingContext({
      session: null,
      viewer: { login: "dana" },
      getInstallations: async () => {
        throw new Error("db down");
      },
      getLoginDiscovery: async () => {
        throw new Error("db down");
      },
    });
    expect(thrown).toEqual({ installations: [], suggestedOrgs: [], seededOrg: undefined, controls: "supabase" });
  });

  it("offers no controls to a viewer when the live wall is off (dev bypass): the revoke would be a no-op", async () => {
    const ctx = await resolveOnboardingContext({
      session: null,
      viewer: { login: "developer" },
      liveWall: false,
      getInstallations: async () => [],
      getLoginDiscovery: async () => null,
    });
    expect(ctx.controls).toBeNull();
  });
});

describe("resolveOnboardingContext - dormant custom-OAuth session (parity guard)", () => {
  it("reads everything off the session and never touches the live-stack readers", async () => {
    const getLoginDiscovery = vi.fn(async () => DISCOVERY);
    const getInstallations = vi.fn(async () => []);
    const ctx = await resolveOnboardingContext({
      session: { installations: [{ id: 7, login: "Org" }], suggestedOrgs: ["x"], seededOrg: "Org" },
      viewer: { login: "dana" },
      getInstallations,
      getLoginDiscovery,
    });
    expect(ctx).toEqual({
      installations: [{ login: "Org", id: "7" }],
      suggestedOrgs: ["x"],
      seededOrg: "Org",
      controls: "dormant",
    });
    expect(getLoginDiscovery).not.toHaveBeenCalled();
    expect(getInstallations).not.toHaveBeenCalled();
  });
});
