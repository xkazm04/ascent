// Auth + validation for the registry API. The GitHub layer and the DB are mocked; `@/lib/authz` and
// the capability gate are NOT — they are the thing under test, because these three routes are the
// only door through which a browser can make ascent write to a customer's GitHub organization.
//
// Two properties are pinned hard:
//   • a caller below the role floor gets a 401/403 and NO GitHub call is made (no scaffold, no token);
//   • an input the client controls (`fullName`, `type`) is validated before anything is persisted.

import { beforeEach, describe, expect, it, vi } from "vitest";

const requireOrgRead = vi.fn(async () => null as unknown);
const requireOrgRole = vi.fn(async () => null as unknown);
const isDbConfigured = vi.fn(() => true);
const CAPABLE = { appConfigured: true, installed: true, canWrite: true, canCreateRepo: true, reason: null, installUrl: null };
const getRegistryCapabilities = vi.fn(async () => CAPABLE);
const getInstallationToken = vi.fn(async () => "tok");
const SCAFFOLD_OK = { kind: "ok" as const, url: "https://x/pull/1", number: 1, branch: "ascent/registry-scaffold", committed: [".ascent/registry.yaml"], skipped: [], reused: false };
const openScaffoldPr = vi.fn(async () => SCAFFOLD_OK);
const createRegistryRepo = vi.fn(async () => ({ kind: "ok" as const, fullName: "acme/ai-registry", defaultBranch: "main" }));
const upsertOrgRegistry = vi.fn(async () => ({ id: "reg-1", fullName: "acme/ai-registry" }));
const getOrgRegistry = vi.fn(async () => null as unknown);
const setRegistryStatus = vi.fn(async () => {});
const listHostedArtifacts = vi.fn(async () => ({ skills: [], practices: [], memory: [] }));
const openMigrationPr = vi.fn(async () => ({ kind: "empty" as const, message: "nothing" }));
const getRegistryView = vi.fn(async () => ({ status: "unmapped" }));

vi.mock("@/lib/authz", () => ({ requireOrgRead: () => requireOrgRead(), requireOrgRole: () => requireOrgRole() }));
vi.mock("@/lib/db/client", () => ({ isDbConfigured: () => isDbConfigured() }));
vi.mock("@/lib/db/installations", () => ({ getInstallationIdForOwner: async () => "42" }));
vi.mock("@/lib/github/app", async (orig) => ({ ...(await orig<object>()), getInstallationToken: () => getInstallationToken() }));
vi.mock("@/lib/registry/capabilities", () => ({ getRegistryCapabilities: () => getRegistryCapabilities() }));
vi.mock("@/lib/registry/scaffold", () => ({
  openScaffoldPr: (...a: unknown[]) => openScaffoldPr(...(a as [])),
  createRegistryRepo: (...a: unknown[]) => createRegistryRepo(...(a as [])),
}));
vi.mock("@/lib/access", () => ({ resolveViewerLogin: async () => "octocat" }));
vi.mock("@/lib/org/registry-view", () => ({ getRegistryView: () => getRegistryView() }));
vi.mock("@/lib/db/org-registry", async (orig) => ({
  ...(await orig<object>()),
  upsertOrgRegistry: () => upsertOrgRegistry(),
  getOrgRegistry: () => getOrgRegistry(),
}));
vi.mock("@/lib/db/org-registry-write", () => ({
  setRegistryStatus: (...a: unknown[]) => setRegistryStatus(...(a as [])),
  setMigrationStep: async () => {},
}));
vi.mock("@/lib/db/org-registry-hosted", () => ({ listHostedArtifacts: () => listHostedArtifacts() }));
vi.mock("@/lib/registry/migrate", async (orig) => ({ ...(await orig<object>()), openMigrationPr: () => openMigrationPr() }));

import { NextResponse } from "next/server";
import { GET, POST } from "./route";
import { POST as INDEX_POST } from "./index/route";
import { POST as MIGRATE_POST } from "./migrate/route";

const ctx = { params: Promise.resolve({ slug: "acme" }) };
const post = (body: unknown, url = "https://x/api/org/acme/registry") =>
  new Request(url, { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  requireOrgRead.mockResolvedValue(null);
  requireOrgRole.mockResolvedValue(null);
  isDbConfigured.mockReturnValue(true);
  getRegistryCapabilities.mockResolvedValue(CAPABLE);
  getInstallationToken.mockResolvedValue("tok");
  upsertOrgRegistry.mockResolvedValue({ id: "reg-1", fullName: "acme/ai-registry" });
  getRegistryView.mockResolvedValue({ status: "unmapped" });
});

describe("GET /api/org/:slug/registry", () => {
  it("returns the view under `view`", async () => {
    const res = await GET(new Request("https://x/api/org/acme/registry"), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ view: { status: "unmapped" } });
  });

  it("defers to the org read gate", async () => {
    requireOrgRead.mockResolvedValue(NextResponse.json({ error: "nope" }, { status: 403 }));
    const res = await GET(new Request("https://x/api/org/acme/registry"), ctx);
    expect(res.status).toBe(403);
    expect(getRegistryView).not.toHaveBeenCalled();
  });

  it("503s with a typed code when persistence is off", async () => {
    isDbConfigured.mockReturnValue(false);
    const res = await GET(new Request("https://x/api/org/acme/registry"), ctx);
    expect(res.status).toBe(503);
    expect((await res.json()).code).toBe("persistence-off");
  });
});

describe("POST /api/org/:slug/registry", () => {
  it("maps a valid repo and opens the scaffold PR", async () => {
    const res = await POST(post({ fullName: "acme/ai-registry" }), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ fullName: "acme/ai-registry", status: "scaffold_pr_open", scaffolded: true });
    expect(setRegistryStatus).toHaveBeenCalledWith("reg-1", "scaffold_pr_open", expect.anything());
  });

  it("rejects a caller below the role floor BEFORE touching GitHub", async () => {
    requireOrgRole.mockResolvedValue(NextResponse.json({ error: "admin only" }, { status: 403 }));
    const res = await POST(post({ fullName: "acme/ai-registry" }), ctx);
    expect(res.status).toBe(403);
    expect(getInstallationToken).not.toHaveBeenCalled();
    expect(openScaffoldPr).not.toHaveBeenCalled();
    expect(upsertOrgRegistry).not.toHaveBeenCalled();
  });

  it("rejects when the capability gate says no, naming the reason", async () => {
    getRegistryCapabilities.mockResolvedValue({ ...CAPABLE, installed: false, canWrite: false, reason: "not-installed" } as never);
    const res = await POST(post({ fullName: "acme/ai-registry" }), ctx);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("not-permitted");
    expect(openScaffoldPr).not.toHaveBeenCalled();
  });

  it.each([{}, { fullName: "" }, { fullName: "acme" }, { fullName: "../../etc/passwd" }, { fullName: 7 }])(
    "400s on invalid input %j without persisting anything",
    async (body) => {
      const res = await POST(post(body), ctx);
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("invalid-input");
      expect(upsertOrgRegistry).not.toHaveBeenCalled();
    },
  );

  it("`create: true` creates the repo, then scaffolds it", async () => {
    const res = await POST(post({ create: true }), ctx);
    expect(res.status).toBe(200);
    expect(createRegistryRepo).toHaveBeenCalledWith("tok", "acme", "ai-registry");
  });

  it("rejects an invalid repo name on the create path", async () => {
    const res = await POST(post({ create: true, name: "not a repo/name" }), ctx);
    expect(res.status).toBe(400);
    expect(createRegistryRepo).not.toHaveBeenCalled();
  });

  it("reports an ALREADY-a-registry repo as mapped, not as an error", async () => {
    openScaffoldPr.mockResolvedValue({ kind: "already-installed", message: "already carries it" } as never);
    const res = await POST(post({ fullName: "acme/handbook" }), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ scaffolded: false, status: "scaffolding" });
  });

  it("never 500s on a GitHub failure — it records the error and returns a typed 502", async () => {
    openScaffoldPr.mockRejectedValue(new Error("socket hang up"));
    const res = await POST(post({ fullName: "acme/ai-registry" }), ctx);
    expect(res.status).toBe(502);
    expect((await res.json()).code).toBe("github-error");
    expect(setRegistryStatus).toHaveBeenCalledWith("reg-1", "error", expect.anything());
  });
});

describe("POST /api/org/:slug/registry/index", () => {
  it("409s with `not-mapped` when no registry is mapped", async () => {
    getOrgRegistry.mockResolvedValue(null);
    const res = await INDEX_POST(post({}), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("not-mapped");
  });

  it("honors the role gate", async () => {
    requireOrgRole.mockResolvedValue(NextResponse.json({ error: "no" }, { status: 401 }));
    expect((await INDEX_POST(post({}), ctx)).status).toBe(401);
  });
});

describe("POST /api/org/:slug/registry/migrate", () => {
  const migrate = (qs: string) => MIGRATE_POST(post({}, `https://x/api/org/acme/registry/migrate${qs}`), ctx);

  it.each(["", "?type=", "?type=everything", "?type=Skills"])("400s on `%s`", async (qs) => {
    const res = await migrate(qs);
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("invalid-input");
  });

  it("409s when nothing is mapped", async () => {
    getOrgRegistry.mockResolvedValue(null);
    expect((await migrate("?type=skills")).status).toBe(409);
  });

  it("is a NO-OP (not an empty PR) when the org has nothing hosted of that type", async () => {
    getOrgRegistry.mockResolvedValue({ id: "reg-1", fullName: "acme/ai-registry", defaultBranch: "main" });
    const res = await migrate("?type=memory");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ type: "memory", opened: false, moved: 0, total: 0 });
    expect(openMigrationPr).not.toHaveBeenCalled();
  });
});
