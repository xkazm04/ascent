// A memory cannot be archived on the shared public org (security scan 2026-10-07, finding O12).
// requireOrgRole admits "public" for any signed-in viewer; DELETE refuses it before the gate. Runs the
// REAL @/lib/authz.

import { describe, it, expect, vi, beforeEach } from "vitest";

// The REAL @/lib/authz runs; only its identity and data edges are stubbed. The caller is a signed-in
// account under the login wall with no Membership anywhere, and every org already has an owner (so
// there is no bootstrap claim either): a stranger.
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
vi.mock("@/lib/github/app", () => ({ isAppConfigured: () => false, isOrgAdminViaInstallation: vi.fn() }));
vi.mock("@/lib/db/members", async (orig) => ({
  ...(await orig<typeof import("@/lib/db/members")>()),
  getMembershipRole: vi.fn(async () => null),
  orgHasOwner: vi.fn(async () => true),
  ensureOwnerMembership: vi.fn(async () => {}),
}));
vi.mock("@/lib/db", () => ({
  getInstallationIdForOwner: vi.fn(async () => null),
  isDbConfigured: () => true,
  isPersonalOrg: vi.fn(async () => false),
  recordOrgAudit: vi.fn(async () => {}),
  archiveOrgMemory: vi.fn(async () => {}),
  getCreditState: vi.fn(async () => ({ plan: "team" })),
  getOrgId: vi.fn(async () => "org-1"),
  getOrgMemory: vi.fn(async () => ({ id: "m", visibility: "org" })),
  getOrgMemoryOrgSlug: vi.fn(async (id: string) => (id === "m-priv" ? "acme" : "public")),
  recordAudit: vi.fn(async () => {}),
  updateOrgMemory: vi.fn(async () => {}),
  workspaceAllowsMemory: vi.fn(async () => true),
}));
vi.mock("@/lib/db/org-memory", () => ({
  REGISTRY_ORIGIN_REFUSAL: "registry",
  getOrgMemoryLineage: vi.fn(async () => []),
  memoryVisibleTo: vi.fn(() => true),
  memoryWriteRefusal: vi.fn(() => null),
}));

import { DELETE } from "./route";
import { archiveOrgMemory } from "@/lib/db";

const del = (id: string) =>
  DELETE(new Request(`http://localhost/api/org/memory/${id}`, { method: "DELETE" }), { params: Promise.resolve({ id }) });

beforeEach(() => vi.clearAllMocks());

describe("DELETE /api/org/memory/[id] as a signed-in non-member", () => {
  it("control: a private org refuses the stranger at the admin gate", async () => {
    expect((await del("m-priv")).status).toBe(403);
    expect(archiveOrgMemory).not.toHaveBeenCalled();
  });

  it("refuses archiving a public-org memory", async () => {
    const res = await del("m-pub");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: expect.stringMatching(/public org/i) });
    expect(archiveOrgMemory).not.toHaveBeenCalled();
  });
});
