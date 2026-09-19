// POST /api/org/watch — slug identity. Import and scan canonicalize before the gate AND the
// mutation; this sibling used to pass `body.org` raw, so a mixed-case watch passed requireOrgAccess
// (which normalizes internally) then minted a duplicate tenant via ensureOrg.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));
vi.mock("@/lib/db", () => ({
  isDbConfigured: () => true,
  setRepoWatch: vi.fn(async () => {}),
}));
vi.mock("@/lib/github/app", () => ({ isAppConfigured: () => true }));
vi.mock("@/lib/authz", () => ({
  requireOrgAccess: vi.fn(async () => null),
  requireFleetOrg: vi.fn(async () => null),
}));

import { POST } from "./route";
import { setRepoWatch } from "@/lib/db";
import { requireOrgAccess, requireFleetOrg } from "@/lib/authz";

const mockWatch = vi.mocked(setRepoWatch);
const mockAccess = vi.mocked(requireOrgAccess);
const mockFleet = vi.mocked(requireFleetOrg);

function post(body: Record<string, unknown>) {
  return new Request("http://localhost/api/org/watch", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAccess.mockResolvedValue(null);
  mockFleet.mockResolvedValue(null);
});

describe("POST /api/org/watch canonicalizes the org", () => {
  it("canonicalizes before the gate AND the single-repo write", async () => {
    const res = await POST(post({ org: "  AcMe ", owner: "acme", name: "web", fullName: "acme/web", watched: true }));
    expect(res.status).toBe(200);
    expect(mockAccess).toHaveBeenCalledWith("acme");
    expect(mockFleet).toHaveBeenCalledWith("acme");
    expect(mockWatch).toHaveBeenCalledWith("acme", expect.objectContaining({ fullName: "acme/web" }), true);
  });

  it("canonicalizes the bulk path the same way", async () => {
    const res = await POST(
      post({ org: "  AcMe ", watched: true, repos: [{ owner: "acme", name: "web", fullName: "acme/web" }] }),
    );
    expect(res.status).toBe(200);
    expect(mockAccess).toHaveBeenCalledWith("acme");
    expect(mockWatch).toHaveBeenCalledWith("acme", expect.objectContaining({ fullName: "acme/web" }), true);
  });

  it("400s a whitespace-only org rather than minting a blank-slug tenant", async () => {
    const res = await POST(post({ org: "   ", owner: "a", name: "b", fullName: "a/b", watched: true }));
    expect(res.status).toBe(400);
    expect(mockWatch).not.toHaveBeenCalled();
    expect(mockAccess).not.toHaveBeenCalled();
  });
});
