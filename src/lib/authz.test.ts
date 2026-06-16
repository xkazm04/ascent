// Locks in the org tenant-isolation model these gates enforce (the cross-tenant IDOR fixes).
// The whole point is that a non-member can neither act on nor read another org's data, while the
// shared "public" org stays open (the free funnel) and auth-off local/demo boxes behave predictably.
//
// @/lib/auth is mocked so we can drive (isAuthConfigured, getSession) directly without cookies or a
// DB. PUBLIC_ORG keeps its real value ("public"). The dashboard opt-in flag is driven via stubEnv.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { NextResponse } from "next/server";

const {
  mockGetSession,
  mockIsAuthConfigured,
  mockGetMembershipRole,
  mockEnsureOwnerMembership,
  mockOrgHasOwner,
  mockAuthGateEnabled,
  mockGetViewer,
  mockRequireViewer,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockIsAuthConfigured: vi.fn(),
  mockGetMembershipRole: vi.fn(),
  mockEnsureOwnerMembership: vi.fn(),
  mockOrgHasOwner: vi.fn(),
  mockAuthGateEnabled: vi.fn(),
  mockGetViewer: vi.fn(),
  mockRequireViewer: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  PUBLIC_ORG: "public",
  getSession: mockGetSession,
  isAuthConfigured: mockIsAuthConfigured,
}));

// Mock the Supabase login-wall access layer so we can drive (authGateEnabled, getViewer, requireViewer)
// directly. Defaults (set in beforeEach) keep the wall OFF, so the custom-OAuth tests below behave
// exactly as they did against the real module (no Supabase env ⇒ gate disabled).
vi.mock("@/lib/access", () => ({
  authGateEnabled: mockAuthGateEnabled,
  getViewer: mockGetViewer,
  requireViewer: mockRequireViewer,
}));

// Mock the membership data layer; keep a real roleAtLeast so the gate's hierarchy logic is exercised.
vi.mock("@/lib/db/members", () => ({
  getMembershipRole: mockGetMembershipRole,
  ensureOwnerMembership: mockEnsureOwnerMembership,
  orgHasOwner: mockOrgHasOwner,
  roleAtLeast: (role: string | null | undefined, min: string) => {
    const rank: Record<string, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };
    if (!role) return false;
    return (rank[role] ?? -1) >= (rank[min] ?? 99);
  },
}));

import {
  canReadOrg,
  openOrgDashboardsEnabled,
  requireOrgAccess,
  requireOrgRead,
  requireOrgRole,
  sessionHasInstallation,
  sessionOwnsOrg,
} from "./authz";

/** A session whose installations cover `orgs` (login = org slug). */
function sessionWith(orgs: string[], ids?: number[]) {
  return { login: "u", installations: orgs.map((login, i) => ({ id: ids?.[i] ?? i + 1, login })) };
}

beforeEach(() => {
  mockGetSession.mockReset();
  mockIsAuthConfigured.mockReset();
  mockGetMembershipRole.mockReset();
  mockEnsureOwnerMembership.mockReset();
  mockOrgHasOwner.mockReset();
  mockAuthGateEnabled.mockReset();
  mockGetViewer.mockReset();
  mockRequireViewer.mockReset();
  mockGetSession.mockResolvedValue(null);
  mockGetMembershipRole.mockResolvedValue(null);
  mockEnsureOwnerMembership.mockResolvedValue(undefined);
  mockOrgHasOwner.mockResolvedValue(false);
  // Default: Supabase login wall OFF (mirrors a no-Supabase-env deployment) so the custom-OAuth tests
  // exercise the dormant-wall path. requireViewer is a no-op (null) when the gate is off.
  mockAuthGateEnabled.mockReturnValue(false);
  mockGetViewer.mockResolvedValue(null);
  mockRequireViewer.mockResolvedValue(null);
});
afterEach(() => vi.unstubAllEnvs());

describe("requireOrgAccess (write gate)", () => {
  it("auth OFF: any org is actable (local/demo is open)", async () => {
    mockIsAuthConfigured.mockReturnValue(false);
    expect(await requireOrgAccess("acme")).toBeNull();
    expect(await requireOrgAccess("public")).toBeNull();
  });

  it("auth ON: public is open, but a private org needs a session", async () => {
    mockIsAuthConfigured.mockReturnValue(true);
    expect(await requireOrgAccess("public")).toBeNull();
    const res = await requireOrgAccess("acme");
    expect(res?.status).toBe(401);
  });

  it("auth ON: a member passes, a non-member gets 403 (case-insensitive)", async () => {
    mockIsAuthConfigured.mockReturnValue(true);
    mockGetSession.mockResolvedValue(sessionWith(["acme"]));
    expect(await requireOrgAccess("ACME")).toBeNull();
    const res = await requireOrgAccess("other");
    expect(res?.status).toBe(403);
  });
});

describe("canReadOrg / requireOrgRead (read gate)", () => {
  it("public is always readable", async () => {
    mockIsAuthConfigured.mockReturnValue(true);
    expect(await canReadOrg("public")).toBe(true);
    expect(await requireOrgRead("public")).toBeNull();
  });

  it("auth ON: member reads, non-member is blocked, anon is 401", async () => {
    mockIsAuthConfigured.mockReturnValue(true);
    mockGetSession.mockResolvedValue(sessionWith(["acme"]));
    expect(await canReadOrg("acme")).toBe(true);
    expect(await requireOrgRead("acme")).toBeNull();
    expect(await canReadOrg("other")).toBe(false);
    expect((await requireOrgRead("other"))?.status).toBe(403);

    mockGetSession.mockResolvedValue(null);
    expect((await requireOrgRead("acme"))?.status).toBe(401);
  });

  it("auth OFF: a private org is closed unless the dashboard flag is set", async () => {
    mockIsAuthConfigured.mockReturnValue(false);
    vi.stubEnv("ASCENT_OPEN_ORG_DASHBOARDS", "");
    expect(await canReadOrg("acme")).toBe(false);
    expect((await requireOrgRead("acme"))?.status).toBe(403);

    vi.stubEnv("ASCENT_OPEN_ORG_DASHBOARDS", "1");
    expect(await canReadOrg("acme")).toBe(true);
    expect(await requireOrgRead("acme")).toBeNull();
  });
});

describe("openOrgDashboardsEnabled", () => {
  it("only '1' or 'true' enable it; default is off", () => {
    vi.stubEnv("ASCENT_OPEN_ORG_DASHBOARDS", "1");
    expect(openOrgDashboardsEnabled()).toBe(true);
    vi.stubEnv("ASCENT_OPEN_ORG_DASHBOARDS", "true");
    expect(openOrgDashboardsEnabled()).toBe(true);
    vi.stubEnv("ASCENT_OPEN_ORG_DASHBOARDS", "0");
    expect(openOrgDashboardsEnabled()).toBe(false);
    vi.stubEnv("ASCENT_OPEN_ORG_DASHBOARDS", "");
    expect(openOrgDashboardsEnabled()).toBe(false);
  });
});

describe("session installation checks (scan-token IDOR)", () => {
  it("sessionOwnsOrg matches case-insensitively", async () => {
    mockGetSession.mockResolvedValue(sessionWith(["acme"]));
    expect(await sessionOwnsOrg("ACME")).toBe(true);
    expect(await sessionOwnsOrg("other")).toBe(false);
  });

  it("sessionHasInstallation matches by id", async () => {
    mockGetSession.mockResolvedValue(sessionWith(["acme"], [42]));
    expect(await sessionHasInstallation(42)).toBe(true);
    expect(await sessionHasInstallation("42")).toBe(true);
    expect(await sessionHasInstallation(99)).toBe(false);
  });

  it("no session ⇒ no ownership", async () => {
    mockGetSession.mockResolvedValue(null);
    expect(await sessionOwnsOrg("acme")).toBe(false);
    expect(await sessionHasInstallation(1)).toBe(false);
  });
});

describe("requireOrgRole (RBAC gate)", () => {
  it("auth OFF and PUBLIC_ORG are open", async () => {
    mockIsAuthConfigured.mockReturnValue(false);
    expect(await requireOrgRole("acme", "owner")).toBeNull();
    mockIsAuthConfigured.mockReturnValue(true);
    expect(await requireOrgRole("public", "owner")).toBeNull();
  });

  it("auth ON without a session is 401", async () => {
    mockIsAuthConfigured.mockReturnValue(true);
    expect((await requireOrgRole("acme", "admin"))?.status).toBe(401);
  });

  it("uses the explicit membership role against the minimum", async () => {
    mockIsAuthConfigured.mockReturnValue(true);
    mockGetSession.mockResolvedValue(sessionWith([])); // signed in, no installation
    mockGetMembershipRole.mockResolvedValue("admin");
    expect(await requireOrgRole("acme", "admin")).toBeNull(); // admin >= admin
    expect((await requireOrgRole("acme", "owner"))?.status).toBe(403); // admin < owner
    expect(mockEnsureOwnerMembership).not.toHaveBeenCalled();
  });

  it("treats an installation-owner as owner and seeds the membership", async () => {
    mockIsAuthConfigured.mockReturnValue(true);
    mockGetSession.mockResolvedValue(sessionWith(["acme"])); // installed the App on acme
    mockGetMembershipRole.mockResolvedValue(null); // no explicit membership yet
    expect(await requireOrgRole("acme", "owner")).toBeNull();
    expect(mockEnsureOwnerMembership).toHaveBeenCalledWith("acme", "u", undefined);
  });

  it("a signed-in non-member with no installation is 403", async () => {
    mockIsAuthConfigured.mockReturnValue(true);
    mockGetSession.mockResolvedValue(sessionWith(["other"]));
    mockGetMembershipRole.mockResolvedValue(null);
    expect((await requireOrgRole("acme", "member"))?.status).toBe(403);
  });
});

describe("requireOrgRole under the Supabase login wall (cross-tenant takeover fix)", () => {
  beforeEach(() => {
    // Wall enforced: a signed-in Supabase viewer (alice) with NO custom-OAuth session. Custom OAuth is
    // dormant, so this branch must resolve a real role rather than blanket-allow (the critical bug).
    mockAuthGateEnabled.mockReturnValue(true);
    mockRequireViewer.mockResolvedValue(null);
    mockGetViewer.mockResolvedValue({ id: "v", login: "alice" });
    mockIsAuthConfigured.mockReturnValue(false); // custom OAuth off — the documented prod config
  });

  it("a viewer with no role is DENIED on an org that already has an owner", async () => {
    mockGetMembershipRole.mockResolvedValue(null);
    mockOrgHasOwner.mockResolvedValue(true);
    expect((await requireOrgRole("victim", "owner"))?.status).toBe(403);
    expect(mockEnsureOwnerMembership).not.toHaveBeenCalled();
  });

  it("trust-on-first-use: the first viewer to manage an unowned org is seeded as owner", async () => {
    mockGetMembershipRole.mockResolvedValue(null);
    mockOrgHasOwner.mockResolvedValue(false);
    expect(await requireOrgRole("fresh", "owner")).toBeNull();
    expect(mockEnsureOwnerMembership).toHaveBeenCalledWith("fresh", "alice", undefined);
  });

  it("enforces an explicit membership role against the minimum", async () => {
    mockOrgHasOwner.mockResolvedValue(true);
    mockGetMembershipRole.mockResolvedValue("admin");
    expect(await requireOrgRole("acme", "admin")).toBeNull(); // admin >= admin
    expect((await requireOrgRole("acme", "owner"))?.status).toBe(403); // admin < owner
  });

  it("a signed-out viewer is refused by the wall (401)", async () => {
    mockRequireViewer.mockResolvedValue(NextResponse.json({ error: "Sign in." }, { status: 401 }));
    expect((await requireOrgRole("acme", "owner"))?.status).toBe(401);
  });

  it("PUBLIC_ORG stays open under the wall", async () => {
    expect(await requireOrgRole("public", "owner")).toBeNull();
  });
});
