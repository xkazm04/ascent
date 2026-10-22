// POST /api/practices/apply refuses the shared public org (members-0, 2026-10-22). It gated with
// requireOrgRole(org, "admin") alone, which admits PUBLIC_ORG for any signed-in viewer, so a stranger
// reached the PR-target lookup and the installation mint for "public". Runs the REAL @/lib/authz;
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
  requireSameOrigin: vi.fn(() => null),
}));
vi.mock("@/lib/github/app", () => ({
  AppApiError: class AppApiError extends Error {},
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
}));
vi.mock("@/lib/github/pr-route", () => ({
  requirePrWriteTarget: vi.fn(async () => {
    throw new Error("must not be reached");
  }),
  mapPrWriteError: vi.fn(() => Response.json({ error: "reached" }, { status: 500 })),
  MINT_FAILED: "mint failed",
}));
vi.mock("@/lib/practices/apply", () => ({ applyPracticeToRepo: vi.fn() }));

import { POST } from "./route";
import { getInstallationIdForOwner } from "@/lib/db";
import { requirePrWriteTarget } from "@/lib/github/pr-route";

const req = (body: unknown) =>
  new Request("http://localhost/api/practices/apply", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => vi.clearAllMocks());

describe("POST /api/practices/apply as a signed-in non-member", () => {
  it("control: a private org refuses the stranger at the admin gate", async () => {
    const res = await POST(req({ org: "acme", repo: "acme/x", practiceId: "agents-md" }));
    expect(res.status).toBe(403);
    expect(requirePrWriteTarget).not.toHaveBeenCalled();
  });

  it.each(["public", "Public"])("refuses %j before any PR-target or installation lookup", async (org) => {
    const res = await POST(req({ org, repo: "public/x", practiceId: "agents-md" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: expect.stringMatching(/public org/i) });
    expect(requirePrWriteTarget).not.toHaveBeenCalled();
    expect(getInstallationIdForOwner).not.toHaveBeenCalled();
  });
});
