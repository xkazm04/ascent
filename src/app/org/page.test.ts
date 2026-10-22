// Bare /org forwards to the viewer's remembered org. It used to ask getActiveOrg with the DORMANT
// custom-OAuth session, which production never mints, so under the Supabase wall every member landed
// on /org/public no matter what they had chosen in the header. It now reads the one workspace
// resolver, which honors memberships and the same canReadOrg predicate POST /api/org/active writes with.

import { describe, it, expect, beforeEach, vi } from "vitest";

const h = vi.hoisted(() => ({
  cookie: undefined as string | undefined,
  memberships: [] as Array<{ slug: string; name: string; role: string }>,
  login: null as string | null,
  redirect: vi.fn((url: string) => {
    throw Object.assign(new Error("NEXT_REDIRECT"), { url });
  }),
}));

vi.mock("next/navigation", () => ({ redirect: h.redirect }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (n: string) => (n === "ascent_active_org" && h.cookie ? { value: h.cookie } : undefined) }),
}));
vi.mock("@/lib/auth", () => ({
  ACTIVE_ORG_COOKIE: "ascent_active_org",
  getSession: async () => null,
  getSessionState: async () => ({ session: null, status: "none" }),
  // The dormant-stack behavior: with a null session every cookie resolves to public.
  getActiveOrg: async () => "public",
}));
vi.mock("@/lib/access", () => ({ resolveViewerLogin: async () => h.login }));
vi.mock("@/lib/db", () => ({ listOrgsForLogin: async () => h.memberships }));
vi.mock("@/lib/authz", () => ({
  canReadOrg: async (org: string) => org === "public" || h.memberships.some((m) => m.slug === org.toLowerCase()),
}));

import OrgIndexPage from "./page";

async function landing(): Promise<string> {
  try {
    await OrgIndexPage();
  } catch (e) {
    return (e as { url: string }).url;
  }
  throw new Error("OrgIndexPage did not redirect");
}

describe("OrgIndexPage - bare /org lands on the viewer's real tenant", () => {
  beforeEach(() => {
    h.cookie = undefined;
    h.memberships = [];
    h.login = null;
  });

  it("forwards a member to the org they remembered under the Supabase wall", async () => {
    h.login = "dana";
    h.memberships = [{ slug: "acme", name: "Acme", role: "owner" }];
    h.cookie = "acme";
    expect(await landing()).toBe("/org/acme");
  });

  it("forwards a member with no remembered org to their primary membership", async () => {
    h.login = "dana";
    h.memberships = [{ slug: "beta", name: "Beta", role: "owner" }];
    expect(await landing()).toBe("/org/beta");
  });

  it("never forwards to a cookie-named org the viewer cannot read", async () => {
    h.login = "dana";
    h.cookie = "victim";
    expect(await landing()).toBe("/org/public");
  });
});
