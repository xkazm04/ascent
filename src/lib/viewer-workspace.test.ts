// resolveViewerWorkspace - the loader every reader of "the viewer's active org" consults (the header
// switcher, bare /org, /usage). It feeds the pure resolveWorkspace from BOTH identity stacks and then
// keeps only the options canReadOrg admits: the same predicate POST /api/org/active applies when it
// writes the cookie, so the read can never offer (or land on) an org the write would refuse.
//
// Runs against the module's REAL default wiring with each dependency mocked at its import, so these
// cases also pin which functions it reads from (canReadOrg from @/lib/authz, not a re-derived check).

import { describe, it, expect, beforeEach, vi } from "vitest";

type Install = { id: number; login: string };
type Member = { slug: string; name: string; role: "owner" | "admin" | "member" | "viewer" };

const h = vi.hoisted(() => ({
  session: null as null | { login: string; installations: Install[] },
  login: null as string | null,
  memberships: [] as Member[],
  cookie: undefined as string | undefined,
  listOrgsForLogin: vi.fn(),
  canReadOrg: vi.fn(),
  getSession: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "ascent_active_org" && h.cookie !== undefined ? { value: h.cookie } : undefined) }),
}));
vi.mock("@/lib/auth", () => ({ ACTIVE_ORG_COOKIE: "ascent_active_org", getSession: h.getSession }));
vi.mock("@/lib/access", () => ({ resolveViewerLogin: async () => h.login }));
vi.mock("@/lib/db", () => ({ listOrgsForLogin: h.listOrgsForLogin }));
vi.mock("@/lib/authz", () => ({ canReadOrg: h.canReadOrg }));

import { resolveViewerWorkspace } from "./viewer-workspace";

/** canReadOrg with membership semantics: PUBLIC_ORG always, a private org iff the viewer is a member. */
function membershipCanRead(org: string): boolean {
  const slug = org.trim().toLowerCase();
  return slug === "public" || h.memberships.some((m) => m.slug.toLowerCase() === slug);
}

const m = (slug: string, role: Member["role"] = "member"): Member => ({ slug, name: slug.toUpperCase(), role });

beforeEach(() => {
  vi.clearAllMocks();
  h.session = null;
  h.login = null;
  h.memberships = [];
  h.cookie = undefined;
  h.getSession.mockImplementation(async () => h.session);
  h.listOrgsForLogin.mockImplementation(async () => h.memberships);
  h.canReadOrg.mockImplementation(async (org: string) => membershipCanRead(org));
});

describe("resolveViewerWorkspace", () => {
  it("under the Supabase wall, offers the viewer's memberships and reads back the remembered org", async () => {
    h.login = "dana";
    h.memberships = [m("acme", "owner"), m("beta", "viewer")];
    h.cookie = "beta";
    await expect(resolveViewerWorkspace()).resolves.toEqual({ options: ["acme", "beta", "public"], active: "beta" });
    expect(h.listOrgsForLogin).toHaveBeenCalledWith("dana");
  });

  it("subset property: every option it returns is one canReadOrg admits", async () => {
    const scenarios: Array<() => void> = [
      () => { h.login = "dana"; h.memberships = [m("acme", "owner"), m("beta", "viewer")]; },
      () => { h.login = "dana"; h.memberships = [m("acme")]; h.cookie = "victim"; },
      // A dormant installation the viewer holds no membership in: the retired stack no longer
      // authorizes it, so the read must not offer it either.
      () => { h.login = "erin"; h.session = { login: "erin", installations: [{ id: 7, login: "Stranger" }] }; },
      () => { h.login = "erin"; h.session = { login: "erin", installations: [{ id: 7, login: "Acme" }] }; h.memberships = [m("acme")]; },
      () => { h.login = null; h.cookie = "acme"; },
    ];
    for (const setup of scenarios) {
      h.session = null; h.memberships = []; h.cookie = undefined;
      setup();
      const ws = await resolveViewerWorkspace();
      for (const option of ws.options) expect(membershipCanRead(option)).toBe(true);
      expect(ws.options).toContain(ws.active);
    }
  });

  it("drops an option canReadOrg refuses and never lands on it from the cookie", async () => {
    h.login = "erin";
    h.session = { login: "erin", installations: [{ id: 7, login: "Stranger" }] };
    h.cookie = "stranger";
    await expect(resolveViewerWorkspace()).resolves.toEqual({ options: ["public"], active: "public" });
  });

  it("asks canReadOrg about each private candidate and never about public (always readable)", async () => {
    h.login = "dana";
    h.memberships = [m("acme"), m("beta")];
    await resolveViewerWorkspace();
    expect(h.canReadOrg.mock.calls.map((c) => c[0])).toEqual(["acme", "beta"]);
  });

  it("an anonymous viewer reads no memberships and gets only public", async () => {
    h.cookie = "acme";
    await expect(resolveViewerWorkspace()).resolves.toEqual({ options: ["public"], active: "public" });
    expect(h.listOrgsForLogin).not.toHaveBeenCalled();
  });

  it("collapses to public, without throwing, when listOrgsForLogin rejects (the header renders on every page)", async () => {
    h.login = "dana";
    h.cookie = "acme";
    h.listOrgsForLogin.mockRejectedValue(new Error("db down"));
    await expect(resolveViewerWorkspace()).resolves.toEqual({ options: ["public"], active: "public" });
  });

  it("collapses to public when the session read or the gate itself throws", async () => {
    h.login = "dana";
    h.memberships = [m("acme")];
    h.getSession.mockRejectedValue(new Error("cookie store unavailable"));
    await expect(resolveViewerWorkspace()).resolves.toEqual({ options: ["public"], active: "public" });

    h.getSession.mockImplementation(async () => null);
    h.canReadOrg.mockRejectedValue(new Error("gate failed"));
    await expect(resolveViewerWorkspace()).resolves.toEqual({ options: ["public"], active: "public" });
  });
});
