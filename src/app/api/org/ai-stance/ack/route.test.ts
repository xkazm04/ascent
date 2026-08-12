// /api/org/ai-stance/ack (W3): the acknowledgement write is ADMIN-gated + same-origin, refuses to
// acknowledge when nothing is published, defaults to the active version, and clamps an explicit
// version to real ones (1..active) — you can adopt an older revision, never a future one.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class extends Response {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), { status: (init as { status?: number })?.status ?? 200, headers: { "content-type": "application/json" } });
    }
  },
}));

const h = vi.hoisted(() => ({
  requireOrgRole: vi.fn(),
  requireSameOrigin: vi.fn(),
  recordOrgAudit: vi.fn(),
  getActiveOrgStance: vi.fn(),
  ackOrgStance: vi.fn(),
  resolveViewerLogin: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  isDbConfigured: () => true,
  getActiveOrgStance: h.getActiveOrgStance,
  ackOrgStance: h.ackOrgStance,
  recordOrgAudit: h.recordOrgAudit,
}));
vi.mock("@/lib/authz", () => ({ requireOrgRole: h.requireOrgRole }));
vi.mock("@/lib/auth", () => ({ requireSameOrigin: h.requireSameOrigin }));
vi.mock("@/lib/access", () => ({ resolveViewerLogin: h.resolveViewerLogin }));

import { POST } from "./route";

const post = (body: unknown) =>
  POST(new Request("http://t/api/org/ai-stance/ack", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));

beforeEach(() => {
  vi.clearAllMocks();
  h.requireOrgRole.mockResolvedValue(null);
  h.requireSameOrigin.mockReturnValue(null);
  h.recordOrgAudit.mockResolvedValue(true);
  h.getActiveOrgStance.mockResolvedValue({ version: 3 });
  h.ackOrgStance.mockImplementation(async (_o: string, repo: string, v: number) => ({ repoFullName: repo, version: v, ackedBy: "bob", ackedAt: new Date() }));
  h.resolveViewerLogin.mockResolvedValue("bob");
});

describe("POST /api/org/ai-stance/ack", () => {
  it("requires { org, repo } and a parseable repo", async () => {
    expect((await post({ org: "acme" })).status).toBe(400);
    expect((await post({ org: "acme", repo: "not a repo!!" })).status).toBe(400);
  });

  it("is ADMIN-gated (not just member) and same-origin", async () => {
    h.requireOrgRole.mockResolvedValue(Response.json({ error: "no" }, { status: 403 }));
    expect((await post({ org: "acme", repo: "acme/api" })).status).toBe(403);
    expect(h.requireOrgRole).toHaveBeenCalledWith("acme", "admin");

    h.requireOrgRole.mockResolvedValue(null);
    h.requireSameOrigin.mockReturnValue(Response.json({ error: "xo" }, { status: 403 }));
    expect((await post({ org: "acme", repo: "acme/api" })).status).toBe(403);
  });

  it("409s when no stance is published — there is nothing to acknowledge", async () => {
    h.getActiveOrgStance.mockResolvedValue(null);
    expect((await post({ org: "acme", repo: "acme/api" })).status).toBe(409);
    expect(h.ackOrgStance).not.toHaveBeenCalled();
  });

  it("defaults to the ACTIVE version and clamps a future/invalid explicit version to it", async () => {
    await post({ org: "acme", repo: "acme/api" });
    expect(h.ackOrgStance).toHaveBeenLastCalledWith("acme", "acme/api", 3, "bob");

    await post({ org: "acme", repo: "acme/api", version: 99 });
    expect(h.ackOrgStance).toHaveBeenLastCalledWith("acme", "acme/api", 3, "bob");

    await post({ org: "acme", repo: "acme/api", version: 2 }); // a real older revision is honored
    expect(h.ackOrgStance).toHaveBeenLastCalledWith("acme", "acme/api", 2, "bob");
  });

  it("audits the acknowledgement with repo + version", async () => {
    await post({ org: "acme", repo: "acme/api" });
    const [action, org, meta] = h.recordOrgAudit.mock.calls[0]!;
    expect(action).toBe("org.ai_stance_ack");
    expect(org).toBe("acme");
    expect(meta).toMatchObject({ repo: "acme/api", version: 3 });
  });
});
