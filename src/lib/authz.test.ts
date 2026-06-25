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
  mockGetInstallationIdForOwner,
  mockIsDbConfigured,
  mockIsAppConfigured,
  mockIsOrgAdminViaInstallation,
} = vi.hoisted(() => ({
  mockGetSession: vi.fn(),
  mockIsAuthConfigured: vi.fn(),
  mockGetMembershipRole: vi.fn(),
  mockEnsureOwnerMembership: vi.fn(),
  mockOrgHasOwner: vi.fn(),
  mockAuthGateEnabled: vi.fn(),
  mockGetViewer: vi.fn(),
  mockRequireViewer: vi.fn(),
  mockGetInstallationIdForOwner: vi.fn(),
  mockIsDbConfigured: vi.fn(),
  mockIsAppConfigured: vi.fn(),
  mockIsOrgAdminViaInstallation: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  PUBLIC_ORG: "public",
  getSession: mockGetSession,
  isAuthConfigured: mockIsAuthConfigured,
}));

// The installation lookup + GitHub org-admin verification behind the identity-bound owner bootstrap.
vi.mock("@/lib/db", () => ({
  getInstallationIdForOwner: mockGetInstallationIdForOwner,
  isDbConfigured: mockIsDbConfigured,
}));
vi.mock("@/lib/github/app", () => ({
  isAppConfigured: mockIsAppConfigured,
  isOrgAdminViaInstallation: mockIsOrgAdminViaInstallation,
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
  mockGetInstallationIdForOwner.mockReset();
  mockIsDbConfigured.mockReset();
  mockIsAppConfigured.mockReset();
  mockIsOrgAdminViaInstallation.mockReset();
  mockGetSession.mockResolvedValue(null);
  mockGetMembershipRole.mockResolvedValue(null);
  mockEnsureOwnerMembership.mockResolvedValue(undefined);
  mockOrgHasOwner.mockResolvedValue(false);
  // Default: Supabase login wall OFF (mirrors a no-Supabase-env deployment) so the custom-OAuth tests
  // exercise the dormant-wall path. requireViewer is a no-op (null) when the gate is off.
  mockAuthGateEnabled.mockReturnValue(false);
  mockGetViewer.mockResolvedValue(null);
  mockRequireViewer.mockResolvedValue(null);
  // Identity-bound bootstrap deps: default to "no GitHub-org proof available", so the only auto-claim
  // path under the wall is the personal namespace (login === slug). Individual tests opt into the
  // GitHub-confirmed-admin path by enabling the App + a positive isOrgAdminViaInstallation.
  mockGetInstallationIdForOwner.mockResolvedValue(null);
  mockIsDbConfigured.mockReturnValue(true);
  mockIsAppConfigured.mockReturnValue(false);
  mockIsOrgAdminViaInstallation.mockResolvedValue(false);
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

  it("a STRANGER is denied an unowned org and is NOT auto-claimed (owner land-grab fix)", async () => {
    // The pre-fix land-grab seeded the FIRST viewer as owner of any ownerless org (e.g. one the scan
    // pipeline created). Now alice — who neither owns the "victim" personal namespace nor is a
    // GitHub-confirmed admin of it — gets nothing.
    mockGetMembershipRole.mockResolvedValue(null);
    mockOrgHasOwner.mockResolvedValue(false);
    expect((await requireOrgRole("victim", "owner"))?.status).toBe(403);
    expect((await requireOrgRole("victim", "viewer"))?.status).toBe(403); // even at the lowest bar
    expect(mockEnsureOwnerMembership).not.toHaveBeenCalled();
  });

  it("personal namespace: a viewer auto-claims their OWN unowned org (login === slug)", async () => {
    mockGetMembershipRole.mockResolvedValue(null);
    mockOrgHasOwner.mockResolvedValue(false);
    expect(await requireOrgRole("alice", "owner")).toBeNull();
    expect(mockEnsureOwnerMembership).toHaveBeenCalledWith("alice", "alice", undefined);
  });

  it("GitHub-confirmed org admin: claims an unowned ORG installation; a non-admin does not", async () => {
    mockGetMembershipRole.mockResolvedValue(null);
    mockOrgHasOwner.mockResolvedValue(false);
    mockIsAppConfigured.mockReturnValue(true);
    mockGetInstallationIdForOwner.mockResolvedValue(123);
    mockIsOrgAdminViaInstallation.mockResolvedValue(true);
    expect(await requireOrgRole("acme", "owner")).toBeNull();
    expect(mockIsOrgAdminViaInstallation).toHaveBeenCalledWith(123, "acme", "alice");
    expect(mockEnsureOwnerMembership).toHaveBeenCalledWith("acme", "alice", undefined);

    // A viewer GitHub says is NOT an admin gets no claim — fail closed.
    mockEnsureOwnerMembership.mockClear();
    mockIsOrgAdminViaInstallation.mockResolvedValue(false);
    expect((await requireOrgRole("acme", "owner"))?.status).toBe(403);
    expect(mockEnsureOwnerMembership).not.toHaveBeenCalled();
  });

  it("does NOT consult GitHub once the org already has an owner (hard wall, no extra calls)", async () => {
    mockGetMembershipRole.mockResolvedValue(null);
    mockOrgHasOwner.mockResolvedValue(true);
    mockIsAppConfigured.mockReturnValue(true);
    expect((await requireOrgRole("acme", "viewer"))?.status).toBe(403);
    expect(mockGetInstallationIdForOwner).not.toHaveBeenCalled();
    expect(mockIsOrgAdminViaInstallation).not.toHaveBeenCalled();
  });

  it("does NOT re-claim when the viewer already holds a (non-owner) role on the unowned org", async () => {
    mockGetMembershipRole.mockResolvedValue("member");
    mockOrgHasOwner.mockResolvedValue(false);
    expect((await requireOrgRole("fresh", "owner"))?.status).toBe(403); // member < owner
    expect(await requireOrgRole("fresh", "member")).toBeNull(); // member >= member
    expect(mockEnsureOwnerMembership).not.toHaveBeenCalled();
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

describe("requireOrgAccess + canReadOrg under the Supabase login wall (cross-tenant IDOR fix)", () => {
  beforeEach(() => {
    mockAuthGateEnabled.mockReturnValue(true);
    mockRequireViewer.mockResolvedValue(null);
    mockGetViewer.mockResolvedValue({ id: "v", login: "alice" });
    mockIsAuthConfigured.mockReturnValue(false);
  });

  it("requireOrgAccess: a member may write, a stranger may NOT (was: any viewer could)", async () => {
    mockOrgHasOwner.mockResolvedValue(true);
    mockGetMembershipRole.mockResolvedValue("member");
    expect(await requireOrgAccess("acme")).toBeNull();
    mockGetMembershipRole.mockResolvedValue(null);
    expect((await requireOrgAccess("victim"))?.status).toBe(403);
  });

  it("requireOrgAccess: a viewer-role member is below `member` and is refused the write", async () => {
    mockOrgHasOwner.mockResolvedValue(true);
    mockGetMembershipRole.mockResolvedValue("viewer");
    expect((await requireOrgAccess("acme"))?.status).toBe(403);
  });

  it("canReadOrg: any-role member reads, a stranger cannot (was: any viewer could read any org)", async () => {
    mockOrgHasOwner.mockResolvedValue(true);
    mockGetMembershipRole.mockResolvedValue("viewer");
    expect(await canReadOrg("acme")).toBe(true);
    mockGetMembershipRole.mockResolvedValue(null);
    expect(await canReadOrg("victim")).toBe(false);
    // A signed-in non-member reading another tenant gets 403 (authenticated, no standing) — not 401.
    expect((await requireOrgRead("victim"))?.status).toBe(403);
  });

  it("canReadOrg: a signed-out viewer cannot read a private org (requireOrgRead ⇒ 401)", async () => {
    mockGetViewer.mockResolvedValue(null);
    expect(await canReadOrg("acme")).toBe(false);
    expect((await requireOrgRead("acme"))?.status).toBe(401);
  });

  it("public stays readable + writable under the wall", async () => {
    expect(await canReadOrg("public")).toBe(true);
    expect(await requireOrgAccess("public")).toBeNull();
  });
});
