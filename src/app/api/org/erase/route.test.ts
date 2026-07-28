// Pins the erase endpoint's guard chain (item G2-09). This is the only route that can irreversibly
// destroy a tenant's analysis history on demand, so its authorization/confirmation invariants are the
// contract worth testing: eraseOrgData is invoked IFF all three guards pass, in this order —
//   1. same-origin (CSRF)  2. typed confirmation  3. owner role
// plus the honest status mapping (a partial or unaudited erasure never reports a green 200).

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));
vi.mock("@/lib/authz", () => ({ requireOrgRole: vi.fn(async () => null) }));
vi.mock("@/lib/auth", () => ({ requireSameOrigin: vi.fn(() => null) }));
vi.mock("@/lib/access", () => ({ resolveViewerLogin: vi.fn(async () => "owner-login") }));
vi.mock("@/lib/db/retention", () => ({ eraseOrgData: vi.fn() }));

import { POST, maxDuration } from "./route";
import { requireOrgRole } from "@/lib/authz";
import { requireSameOrigin } from "@/lib/auth";
import { eraseOrgData } from "@/lib/db/retention";

const mockErase = vi.mocked(eraseOrgData);
const mockRole = vi.mocked(requireOrgRole);
const mockSameOrigin = vi.mocked(requireSameOrigin);

function req(body: unknown) {
  return new Request("http://localhost/api/org/erase", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const CLEAN = {
  ok: true as const,
  orgSlug: "acme",
  scope: "org" as const,
  reposProcessed: 2,
  scansDeleted: 9,
  dimensionsDeleted: 18,
  recommendationsDeleted: 4,
  recommendationEventsDeleted: 1,
  auditDeleted: 0,
  stoppedEarly: false,
  complete: true,
  audited: true,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockSameOrigin.mockReturnValue(null);
  mockRole.mockResolvedValue(null);
  mockErase.mockResolvedValue(CLEAN);
});

describe("POST /api/org/erase — guard chain", () => {
  it("(1) rejects a cross-origin POST and NEVER erases (CSRF: the session cookie is only SameSite=Lax)", async () => {
    const xo = new Response(JSON.stringify({ error: "Cross-origin request rejected." }), { status: 403 });
    mockSameOrigin.mockReturnValue(xo as never);
    const res = await POST(req({ org: "acme", confirm: "acme" }));
    expect(res).toBe(xo);
    expect(mockErase).not.toHaveBeenCalled();
    expect(mockRole).not.toHaveBeenCalled(); // CSRF is checked before anything else
  });

  it("(2) rejects a MISSING confirmation with 400 and NEVER erases", async () => {
    const res = await POST(req({ org: "acme" }));
    expect(res.status).toBe(400);
    expect(mockErase).not.toHaveBeenCalled();
  });

  it("(2) rejects an INCORRECT confirmation (another org's slug) with 400 and NEVER erases", async () => {
    const res = await POST(req({ org: "acme", confirm: "acme-corp" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Confirmation required/);
    expect(mockErase).not.toHaveBeenCalled();
  });

  it("(2) a repo-scoped erase must confirm the REPO's full name — the org slug alone is not enough", async () => {
    const orgConfirm = await POST(req({ org: "acme", repo: "acme/api", confirm: "acme" }));
    expect(orgConfirm.status).toBe(400);
    expect(mockErase).not.toHaveBeenCalled();

    const ok = await POST(req({ org: "acme", repo: "acme/api", confirm: "acme/api" }));
    expect(ok.status).toBe(200);
    expect(mockErase).toHaveBeenCalledWith(expect.objectContaining({ repoFullName: "acme/api" }));
  });

  it("(2) confirmation is case-insensitive for the org slug (slugs are lowercased app-wide)", async () => {
    const res = await POST(req({ org: "Acme", confirm: "acme" }));
    expect(res.status).toBe(200);
    expect(mockErase).toHaveBeenCalledTimes(1);
  });

  it("(3) returns requireOrgRole's denial verbatim for a NON-OWNER and NEVER erases", async () => {
    const denial = new Response(JSON.stringify({ error: "This action requires the owner role." }), { status: 403 });
    mockRole.mockResolvedValue(denial as never);
    const res = await POST(req({ org: "acme", confirm: "acme" }));
    expect(res).toBe(denial);
    expect(mockRole).toHaveBeenCalledWith("acme", "owner");
    expect(mockErase).not.toHaveBeenCalled();
  });

  it("missing org is a 400 before any authz work", async () => {
    const res = await POST(req({ confirm: "acme" }));
    expect(res.status).toBe(400);
    expect(mockRole).not.toHaveBeenCalled();
    expect(mockErase).not.toHaveBeenCalled();
  });
});

describe("POST /api/org/erase — happy path + honest status mapping", () => {
  it("all guards pass → erases once with the resolved actor, returning the result at 200", async () => {
    const res = await POST(req({ org: "acme", confirm: "acme", includeAudit: true }));
    expect(res.status).toBe(200);
    expect(mockErase).toHaveBeenCalledTimes(1);
    expect(mockErase).toHaveBeenCalledWith({
      orgSlug: "acme",
      repoFullName: undefined,
      includeAudit: true,
      actorId: "owner-login",
    });
    const json = await res.json();
    expect(json.scansDeleted).toBe(9);
    expect(json.ok).toBeUndefined(); // the internal discriminator is not part of the HTTP contract
  });

  it("a PARTIAL erasure returns 207 + resumable, not a green 200", async () => {
    mockErase.mockResolvedValue({ ...CLEAN, complete: false, stoppedEarly: true });
    const res = await POST(req({ org: "acme", confirm: "acme" }));
    expect(res.status).toBe(207);
    const json = await res.json();
    expect(json.resumable).toBe(true);
    expect(json.error).toMatch(/resume/);
  });

  it("a complete erasure whose data.erased trace was LOST also returns 207 (compliance-visible)", async () => {
    mockErase.mockResolvedValue({ ...CLEAN, audited: false });
    const res = await POST(req({ org: "acme", confirm: "acme" }));
    expect(res.status).toBe(207);
    expect((await res.json()).error).toMatch(/audit entry/);
  });

  it("maps the erase refusals to statuses: no DB 503, unknown org 404, unknown repo 404", async () => {
    mockErase.mockResolvedValue({ ok: false, reason: "no-db" });
    expect((await POST(req({ org: "acme", confirm: "acme" }))).status).toBe(503);
    mockErase.mockResolvedValue({ ok: false, reason: "unknown-org" });
    expect((await POST(req({ org: "acme", confirm: "acme" }))).status).toBe(404);
    mockErase.mockResolvedValue({ ok: false, reason: "unknown-repo" });
    expect((await POST(req({ org: "acme", repo: "acme/api", confirm: "acme/api" }))).status).toBe(404);
  });

  it("COUPLED CONSTANT: the route's declared maxDuration equals ERASE_MAX_DURATION_S", async () => {
    // The module mock above replaces the real export, so read the GENUINE constant for this pin —
    // Next.js requires maxDuration to be a literal, so this test is what keeps the two from drifting.
    const actual = await vi.importActual<typeof import("@/lib/db/retention")>("@/lib/db/retention");
    expect(maxDuration).toBe(actual.ERASE_MAX_DURATION_S);
  });
});
