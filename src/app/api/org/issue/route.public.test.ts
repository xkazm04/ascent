// POST /api/org/issue refuses the shared public org (members-0, 2026-10-22). The tenant gate keys on
// the repo owner, and requireOrgRole(owner, "admin") alone admits PUBLIC_ORG for any signed-in
// viewer, so a stranger reached the installation lookup for "public". Runs the REAL @/lib/authz;
// only its identity and data edges are stubbed. The caller is a signed-in account with no Membership
// anywhere, and every org already has an owner (no bootstrap claim): a stranger.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/access", () => ({
  authGateEnabled: () => true,
  getViewer: vi.fn(async () => ({ id: "u1", login: "stranger" })),
  requireViewer: vi.fn(async () => null),
  resolveViewerLogin: vi.fn(async () => "stranger"),
}));
vi.mock("@/lib/auth", () => ({
  PUBLIC_ORG: "public",
  getSession: vi.fn(async () => null),
  isAuthConfigured: () => false,
}));
vi.mock("@/lib/github/app", () => ({
  AppApiError: class AppApiError extends Error {},
  getInstallationToken: vi.fn(async () => "installation-token"),
  isAppConfigured: () => true,
  isOrgAdminViaInstallation: vi.fn(),
}));
vi.mock("@/lib/db/members", async (orig) => ({
  ...(await orig<typeof import("@/lib/db/members")>()),
  getMembershipRole: vi.fn(async () => null),
  orgHasOwner: vi.fn(async () => true),
  ensureOwnerMembership: vi.fn(async () => {}),
}));
vi.mock("@/lib/db", () => ({
  getInstallationIdForOwner: vi.fn(async () => 1),
  getOrgId: vi.fn(async () => "org-1"),
  isDbConfigured: () => true,
  recordAudit: vi.fn(async () => true),
}));
vi.mock("@/lib/github/issues", () => ({
  createRepoIssue: vi.fn(async () => ({ number: 1, url: "u", reused: false })),
  passportBlockerMarker: (id: string) => id,
}));

import { POST } from "./route";
import { getInstallationIdForOwner } from "@/lib/db";
import { createRepoIssue } from "@/lib/github/issues";

const req = (body: unknown) =>
  new Request("http://localhost/api/org/issue", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => vi.clearAllMocks());

describe("POST /api/org/issue as a signed-in non-member", () => {
  it("control: a private org refuses the stranger at the admin gate", async () => {
    const res = await POST(req({ repo: "acme/x", title: "t", body: "b" }));
    expect(res.status).toBe(403);
    expect(getInstallationIdForOwner).not.toHaveBeenCalled();
  });

  it.each(["public/x", "Public/x"])("refuses %j with the public-org 403, no installation lookup", async (repo) => {
    const res = await POST(req({ repo, title: "t", body: "b" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: expect.stringMatching(/public org/i) });
    expect(getInstallationIdForOwner).not.toHaveBeenCalled();
    expect(createRepoIssue).not.toHaveBeenCalled();
  });
});
