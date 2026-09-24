// POST /api/org/watch: the watch scope (backlog develop-2026-09-17 row 39). A watched repo is a
// standing credit draw, so on a HOSTED deployment a watch must name a repo the org owns or one on its
// GitHub App installation listing; SELF-HOSTED stays free-form. Handle shape is checked in both modes,
// and un-watching is never refused (an out-of-scope unwatch clears an existing row, never creates one).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));
vi.mock("@/lib/db", () => ({ isDbConfigured: () => true, setRepoWatch: vi.fn(async () => {}) }));
vi.mock("@/lib/db/org-watch", () => ({ clearRepoWatch: vi.fn(async () => {}) }));
vi.mock("@/lib/db/installations", () => ({ getInstallationIdForOwner: vi.fn(async () => "inst-acme") }));
vi.mock("@/lib/github/app", () => ({
  isAppConfigured: () => true,
  listInstallationReposResult: vi.fn(async () => ({
    repos: [{ fullName: "acme-labs/widgets", owner: "acme-labs", name: "widgets" }],
    truncated: false,
  })),
}));
vi.mock("@/lib/authz", () => ({
  requireOrgAccess: vi.fn(async () => null),
  requireFleetOrg: vi.fn(async () => null),
}));

import { POST } from "./route";
import { setRepoWatch } from "@/lib/db";
import { clearRepoWatch } from "@/lib/db/org-watch";

const mockWatch = vi.mocked(setRepoWatch);
const mockClear = vi.mocked(clearRepoWatch);

const repo = (fullName: string) => {
  const [owner, name] = fullName.split("/");
  return { owner, name, fullName };
};

function post(body: Record<string, unknown>) {
  return POST(
    new Request("http://localhost/api/org/watch", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ org: "acme", ...body }),
    }),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("ASCENT_SELF_HOSTED", "0");
});
afterEach(() => vi.unstubAllEnvs());

describe("hosted: a watch must name the org's repo or its installation's", () => {
  it("guard: watches an org-owned repo (200)", async () => {
    const res = await post({ ...repo("acme/web"), watched: true });
    expect(res.status).toBe(200);
    expect(mockWatch).toHaveBeenCalledWith("acme", expect.objectContaining({ fullName: "acme/web" }), true);
  });

  it("watches a repo on the org's installation listing (200)", async () => {
    const res = await post({ ...repo("acme-labs/widgets"), watched: true });
    expect(res.status).toBe(200);
    expect(mockWatch).toHaveBeenCalledWith("acme", expect.objectContaining({ fullName: "acme-labs/widgets" }), true);
  });

  it("refuses a foreign repo with 400 and writes nothing", async () => {
    const res = await post({ ...repo("octocat/Hello-World"), watched: true });
    expect(res.status).toBe(400);
    expect(String(((await res.json()) as { error: string }).error)).toMatch(/octocat\/Hello-World/);
    expect(mockWatch).not.toHaveBeenCalled();
  });

  it("refuses a malformed handle with 400", async () => {
    const res = await post({ owner: "acme", name: "web", fullName: "victim/web", watched: true });
    expect(res.status).toBe(400);
    expect(mockWatch).not.toHaveBeenCalled();
  });

  it("bulk: watches the in-scope repos and reports each refused one in failed[]", async () => {
    const res = await post({
      watched: true,
      repos: [repo("acme/web"), repo("octocat/Hello-World"), repo("acme-labs/widgets"), repo("../x/y")],
    });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { count: number; failed: string[] };
    expect(json.count).toBe(2);
    expect(json.failed).toEqual(["octocat/Hello-World", "../x/y"]);
    expect(mockWatch.mock.calls.map((c) => c[1].fullName)).toEqual(["acme/web", "acme-labs/widgets"]);
  });

  it("unwatching a foreign repo is never refused, and never creates a row", async () => {
    const res = await post({ ...repo("octocat/Hello-World"), watched: false });
    expect(res.status).toBe(200);
    expect(mockClear).toHaveBeenCalledWith("acme", "octocat/Hello-World");
    expect(mockWatch).not.toHaveBeenCalled();
  });

  it("guard: unwatching an org-owned repo still records the explicit unwatch row", async () => {
    const res = await post({ ...repo("acme/web"), watched: false });
    expect(res.status).toBe(200);
    expect(mockWatch).toHaveBeenCalledWith("acme", expect.objectContaining({ fullName: "acme/web" }), false);
  });
});

describe("self-hosted: watching stays free-form", () => {
  beforeEach(() => vi.stubEnv("ASCENT_SELF_HOSTED", "1"));

  it("watches a foreign repo (200)", async () => {
    const res = await post({ ...repo("octocat/Hello-World"), watched: true });
    expect(res.status).toBe(200);
    expect(mockWatch).toHaveBeenCalledWith("acme", expect.objectContaining({ fullName: "octocat/Hello-World" }), true);
  });

  it("still refuses a malformed handle (400)", async () => {
    const res = await post({ owner: "a/b", name: "c", fullName: "a/b/c", watched: true });
    expect(res.status).toBe(400);
  });

  it("guard: unwatching a foreign repo is 200", async () => {
    const res = await post({ ...repo("octocat/Hello-World"), watched: false });
    expect(res.status).toBe(200);
  });
});
