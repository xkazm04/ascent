// POST/DELETE /api/org/playbooks/:id/repos: the "mark applied" tenant gate (backlog
// develop-2026-09-17 row 41). A repo the org tracks under another owner may be marked; a random
// owner is still refused with 400 and nothing is recorded.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));
vi.mock("@/lib/db", () => ({
  applyPlaybook: vi.fn(async () => true),
  unapplyPlaybook: vi.fn(async () => {}),
  getPlaybookOrgSlug: vi.fn(async () => "kiro"),
  isDbConfigured: () => true,
}));
vi.mock("@/lib/access", () => ({ resolveViewerLogin: vi.fn(async () => "alice") }));
vi.mock("@/lib/authz", () => ({ requireOrgAccess: vi.fn(async () => null), requireOrgRole: vi.fn(async () => null) }));
vi.mock("@/lib/db/org-admission", () => ({
  orgTracksRepo: vi.fn(async (org: string, full: string) => org === "kiro" && full === "xkazm04/kp"),
}));

import { POST, DELETE } from "./route";
import { applyPlaybook, unapplyPlaybook } from "@/lib/db";

const ctx = { params: Promise.resolve({ id: "pb_1" }) };
const req = (method: string, repo: string) =>
  new Request("http://localhost/api/org/playbooks/pb_1/repos", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ repo }),
  });

beforeEach(() => vi.clearAllMocks());

describe("playbook mark: the tracked set, not the owner string", () => {
  it("marks a watched repo under another owner (200)", async () => {
    const res = await POST(req("POST", "xkazm04/kp"), ctx);
    expect(res.status).toBe(200);
    expect(vi.mocked(applyPlaybook)).toHaveBeenCalledWith("kiro", "pb_1", "xkazm04/kp", "alice");
  });

  it("guard: marks an org-owned repo (200)", async () => {
    const res = await POST(req("POST", "kiro/site"), ctx);
    expect(res.status).toBe(200);
    expect(vi.mocked(applyPlaybook)).toHaveBeenCalledWith("kiro", "pb_1", "kiro/site", "alice");
  });

  it("refuses a random owner with 400 and records nothing", async () => {
    const res = await POST(req("POST", "facebook/react"), ctx);
    expect(res.status).toBe(400);
    expect(vi.mocked(applyPlaybook)).not.toHaveBeenCalled();
  });

  it("unmarks a watched repo under another owner (200)", async () => {
    const res = await DELETE(req("DELETE", "xkazm04/kp"), ctx);
    expect(res.status).toBe(200);
    expect(vi.mocked(unapplyPlaybook)).toHaveBeenCalledWith("pb_1", "xkazm04/kp");
  });
});
