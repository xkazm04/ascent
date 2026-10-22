// requireOrgOwnerPost refuses the shared public org itself (members-0, 2026-10-22). Before, the
// preamble gated with requireOrgRole(org, "owner") alone, which admits PUBLIC_ORG for any signed-in
// viewer, so every caller had to remember its own refusePublicOrgAdmin (briefing/share and its revoke
// did not). Runs the REAL @/lib/authz; only its identity and data edges are stubbed.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextResponse } from "next/server";

// A real owner of "acme"; nobody holds a role anywhere else.
const h = vi.hoisted(() => ({ role: vi.fn(async (org: string): Promise<string | null> => (org === "acme" ? "owner" : null)) }));

vi.mock("@/lib/access", () => ({
  authGateEnabled: () => true,
  getViewer: vi.fn(async () => ({ id: "u1", login: "alice" })),
  requireViewer: vi.fn(async () => null),
  resolveViewerLogin: vi.fn(async () => "alice"),
}));
vi.mock("@/lib/auth", () => ({
  PUBLIC_ORG: "public",
  getSession: vi.fn(async () => null),
  isAuthConfigured: () => false,
  requireSameOrigin: vi.fn(() => null),
}));
vi.mock("@/lib/github/app", () => ({ isAppConfigured: () => false, isOrgAdminViaInstallation: vi.fn() }));
vi.mock("@/lib/db/members", async (orig) => ({
  ...(await orig<typeof import("@/lib/db/members")>()),
  getMembershipRole: h.role,
  orgHasOwner: vi.fn(async () => true),
  ensureOwnerMembership: vi.fn(async () => {}),
}));
vi.mock("@/lib/db", () => ({
  getInstallationIdForOwner: vi.fn(async () => null),
  isDbConfigured: () => true,
}));

import { requireOrgOwnerPost } from "./orgPost";

const req = (body: unknown) =>
  new Request("http://localhost/api/org/x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

beforeEach(() => vi.clearAllMocks());

describe("requireOrgOwnerPost on the shared public org", () => {
  it.each(["public", " Public "])("answers %j with the public-org 403, never { org, body }", async (org) => {
    const gate = await requireOrgOwnerPost(req({ org, x: 1 }));
    expect(gate).toBeInstanceOf(NextResponse);
    const res = gate as NextResponse;
    expect(res.status).toBe(403);
    const json = (await res.json()) as { error: string };
    expect(json.error).toMatch(/public org/i);
    expect(json.error).not.toContain("—");
  });

  it("control: an owner of a real org still gets { org, body } unchanged", async () => {
    const gate = await requireOrgOwnerPost<{ x: number }>(req({ org: "acme", x: 1 }));
    expect(gate).toEqual({ org: "acme", body: { org: "acme", x: 1 } });
  });

  it("control: a non-owner of a real org is still refused by the role gate", async () => {
    const gate = await requireOrgOwnerPost(req({ org: "victim" }));
    expect((gate as NextResponse).status).toBe(403);
    expect(((await (gate as NextResponse).json()) as { error: string }).error).toMatch(/owner role/);
  });
});
