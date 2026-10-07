// Segments cannot be created, renamed or deleted on the shared public org (security scan 2026-10-07,
// finding O2). requireOrgAccess / requireOrgRole admit "public" for any signed-in viewer, so before the
// fix a stranger could create, rename and delete the public org's repo segments.

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
  segmentInputError: () => null,
  createSegment: vi.fn(async () => ({ id: "seg-1" })),
  getSegmentOrgSlug: vi.fn(async (id: string) => (id === "seg-priv" ? "acme" : "public")),
  updateSegment: vi.fn(async () => {}),
  deleteSegment: vi.fn(async () => {}),
  recordOrgAudit: vi.fn(async () => {}),
}));

import { POST } from "./route";
import { PATCH, DELETE } from "./[id]/route";
import { createSegment, updateSegment, deleteSegment } from "@/lib/db";

const json = (method: string, body?: unknown) =>
  new Request("http://localhost/api/org/segments", {
    method,
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => vi.clearAllMocks());

describe("/api/org/segments as a signed-in non-member", () => {
  it("control: a private org refuses the stranger at the gate", async () => {
    expect((await POST(json("POST", { org: "acme", name: "x" }))).status).toBe(403);
    expect((await PATCH(json("PATCH", { name: "y" }), ctx("seg-priv"))).status).toBe(403);
    expect((await DELETE(json("DELETE"), ctx("seg-priv"))).status).toBe(403);
    expect(createSegment).not.toHaveBeenCalled();
    expect(updateSegment).not.toHaveBeenCalled();
    expect(deleteSegment).not.toHaveBeenCalled();
  });

  it.each(["public", "Public"])("POST refuses creating a segment on %j", async (org) => {
    const res = await POST(json("POST", { org, name: "platform" }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: expect.stringMatching(/public org/i) });
    expect(createSegment).not.toHaveBeenCalled();
  });

  it("PATCH refuses renaming a public-org segment", async () => {
    expect((await PATCH(json("PATCH", { name: "y" }), ctx("seg-pub"))).status).toBe(403);
    expect(updateSegment).not.toHaveBeenCalled();
  });

  it("DELETE refuses removing a public-org segment", async () => {
    expect((await DELETE(json("DELETE"), ctx("seg-pub"))).status).toBe(403);
    expect(deleteSegment).not.toHaveBeenCalled();
  });
});
