// parseOrgRepo: the playbook routes' tenant gate on a caller-supplied repo (backlog
// develop-2026-09-17 row 41). It used to require `owner === org`, so an org could loop and watch
// `xkazm04/kp` under org `kiro` but not roll a playbook into it. It now asks the same tracked-set
// predicate the admission routes use (`repoUnderOrg`), and still refuses a random owner.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));
vi.mock("@/lib/db", () => ({ getPlaybookOrgSlug: vi.fn(), isDbConfigured: () => true }));
vi.mock("@/lib/authz", () => ({ requireOrgAccess: vi.fn(), requireOrgRole: vi.fn() }));
vi.mock("@/lib/db/org-admission", () => ({ orgTracksRepo: vi.fn(async () => false) }));

import { parseOrgRepo } from "./playbook-gate";
import { orgTracksRepo } from "@/lib/db/org-admission";

const mockTracks = vi.mocked(orgTracksRepo);

beforeEach(() => {
  vi.clearAllMocks();
  mockTracks.mockResolvedValue(false);
});

describe("parseOrgRepo", () => {
  it("guard: admits the org's own namespace (any case) without a tracked-set read", async () => {
    expect(await parseOrgRepo("Acme/App", "acme")).toEqual({ fullName: "Acme/App", owner: "Acme", repo: "App" });
    expect(mockTracks).not.toHaveBeenCalled();
  });

  it("admits a repo the org tracks under another owner", async () => {
    mockTracks.mockImplementation(async (org, full) => org === "kiro" && full === "xkazm04/kp");
    expect(await parseOrgRepo("xkazm04/kp", "kiro")).toEqual({ fullName: "xkazm04/kp", owner: "xkazm04", repo: "kp" });
  });

  it("still 400s a random owner the org does not track", async () => {
    const res = await parseOrgRepo("facebook/react", "acme");
    expect(res).toBeInstanceOf(Response);
    expect((res as Response).status).toBe(400);
    expect(((await (res as Response).json()) as { error: string }).error).toMatch(/must belong to acme/i);
  });

  it("guard: 400s a coordinate that does not parse", async () => {
    const res = await parseOrgRepo("::::", "acme");
    expect((res as Response).status).toBe(400);
    expect(mockTracks).not.toHaveBeenCalled();
  });
});
