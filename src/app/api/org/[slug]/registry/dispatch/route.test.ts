// Route test for /api/org/[slug]/registry/dispatch (WP2). What this route alone owns: the gate
// matrix per mode, the org-constrained repo resolution (a foreign repo is a 404, never a read),
// the stage sanity (conform needs a map), and the ledger write that follows the brief.
//
// The brief's own text is pinned in dispatch-brief.test.ts and the local runner in
// dispatch-local.test.ts; here both are mocked.

import { beforeEach, describe, expect, it, vi } from "vitest";

// `new this(...)`: the route's local-mode refusal path is `gate instanceof NextResponse`.
vi.mock("next/server", () => ({
  NextResponse: class extends Response {
    static json(body: unknown, init?: { status?: number }) {
      return new this(JSON.stringify(body), { status: init?.status ?? 200, headers: { "content-type": "application/json" } });
    }
  },
}));

const h = vi.hoisted(() => ({
  read: vi.fn(),
  role: vi.fn(),
  write: vi.fn(),
  requireOrgRole: vi.fn(),
  selfHost: vi.fn(),
  autopilot: vi.fn(),
  orgId: vi.fn(),
  registry: vi.fn(),
  targets: vi.fn(),
  maps: vi.fn(),
  create: vi.fn(),
  list: vi.fn(),
  supersede: vi.fn(),
  localPath: vi.fn(),
  login: vi.fn(),
  run: vi.fn(),
  branch: vi.fn(),
}));

vi.mock("@/lib/registry/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/registry/api")>();
  return { ...actual, guardRegistryRead: h.read, guardRegistryRole: h.role, guardRegistryWrite: h.write };
});
vi.mock("@/lib/authz", () => ({ requireOrgRole: h.requireOrgRole }));
vi.mock("@/lib/api/self-host", () => ({ selfHostGuard: h.selfHost }));
vi.mock("@/lib/local/agent", () => ({ autopilotEnabled: h.autopilot }));
vi.mock("@/lib/db", () => ({ getRepoLocalPath: h.localPath }));
vi.mock("@/lib/db/org-rollup", () => ({ getOrgId: h.orgId }));
vi.mock("@/lib/db/org-registry", () => ({ getOrgRegistry: h.registry }));
vi.mock("@/lib/db/org-registry-conformance", () => ({ listSweepTargets: h.targets, listConformanceMaps: h.maps }));
vi.mock("@/lib/db/org-registry-dispatch", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/db/org-registry-dispatch")>();
  return {
    DISPATCH_STAGES: actual.DISPATCH_STAGES,
    DISPATCH_MODES: actual.DISPATCH_MODES,
    createDispatch: h.create,
    listDispatches: h.list,
    supersedeOpenDispatches: h.supersede,
  };
});
vi.mock("@/lib/access", () => ({ resolveViewerLogin: h.login }));
// The matrix read is best-effort: a null view composes the pre-relation brief (see route.ts).
vi.mock("@/lib/org/knowledge-view", () => ({ getKnowledgeView: async () => null }));
vi.mock("@/lib/registry/dispatch-local", () => ({
  runLocalDispatch: h.run,
  detectDefaultBranch: h.branch,
  defaultDispatchDeps: () => ({}),
}));

import { NextResponse } from "next/server";
import { GET, POST } from "./route";

const ctx = { params: Promise.resolve({ slug: "acme" }) };
const post = (body: unknown) =>
  new Request("http://t/api/org/acme/registry/dispatch", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const get = (qs = "") => GET(new Request(`http://t/api/org/acme/registry/dispatch${qs}`), ctx);

const mapRow = (over: Record<string, unknown> = {}) => ({ repositoryId: "repo-0", mapSha: "sha-0", domains: ["software-engineering"], ...over });

beforeEach(() => {
  vi.clearAllMocks();
  h.read.mockResolvedValue(null);
  h.role.mockResolvedValue(null);
  h.write.mockResolvedValue({ token: "tok", capabilities: {} });
  h.requireOrgRole.mockResolvedValue(null);
  h.selfHost.mockReturnValue(null);
  h.autopilot.mockReturnValue(true);
  h.orgId.mockResolvedValue("org-1");
  h.registry.mockResolvedValue({ id: "reg-1", fullName: "acme/ai-registry" });
  h.targets.mockResolvedValue({ orgId: "org-1", repos: [{ id: "repo-0", fullName: "acme/api" }] });
  h.maps.mockResolvedValue([mapRow()]);
  h.create.mockImplementation(async (input: Record<string, unknown>) => ({ ...input, subjects: input.subjects ?? [] }));
  h.list.mockResolvedValue([]);
  h.supersede.mockResolvedValue(0);
  h.localPath.mockResolvedValue(null);
  h.login.mockResolvedValue("octocat");
  h.run.mockResolvedValue(undefined);
  h.branch.mockResolvedValue("main");
});

describe("GET", () => {
  it("lists the org's dispatches for a member, newest first as the ledger returns them", async () => {
    h.list.mockResolvedValue([{ id: "d-2" }, { id: "d-1" }]);
    const res = await get();
    expect(res.status).toBe(200);
    expect((await res.json()).dispatches.map((d: { id: string }) => d.id)).toEqual(["d-2", "d-1"]);
    expect(h.list).toHaveBeenCalledWith("org-1", { limit: 100 });
  });

  it("narrows to one repo with ?repositoryId=", async () => {
    await get("?repositoryId=repo-0");
    expect(h.list).toHaveBeenCalledWith("org-1", { limit: 100, repositoryId: "repo-0" });
  });

  it("refuses a non-member with the read guard's own response", async () => {
    h.read.mockResolvedValue(new Response("no", { status: 403 }));
    expect((await get()).status).toBe(403);
    expect(h.list).not.toHaveBeenCalled();
  });

  it("answers empty for an org that does not resolve", async () => {
    h.orgId.mockResolvedValue(null);
    expect(await (await get()).json()).toEqual({ dispatches: [] });
  });
});

describe("POST validation", () => {
  it("400s a bad stage, a bad mode, and a missing repositoryId", async () => {
    expect((await POST(post({ repositoryId: "repo-0", stage: "judge", mode: "brief" }), ctx)).status).toBe(400);
    expect((await POST(post({ repositoryId: "repo-0", stage: "map", mode: "cloud" }), ctx)).status).toBe(400);
    expect((await POST(post({ stage: "map", mode: "brief" }), ctx)).status).toBe(400);
    expect(h.create).not.toHaveBeenCalled();
  });

  it("conform requires at least one subject and at most 12", async () => {
    expect((await POST(post({ repositoryId: "repo-0", stage: "conform", mode: "brief" }), ctx)).status).toBe(400);
    const many = Array.from({ length: 13 }, (_, i) => `s-${i}`);
    expect((await POST(post({ repositoryId: "repo-0", stage: "conform", mode: "brief", subjects: many }), ctx)).status).toBe(400);
  });

  it("populate / map ignore subjects", async () => {
    const res = await POST(post({ repositoryId: "repo-0", stage: "map", mode: "brief", subjects: ["x"] }), ctx);
    expect(res.status).toBe(201);
    expect(h.create.mock.calls[0]![0].subjects).toEqual([]);
  });
});

describe("POST brief", () => {
  it("needs the admin floor and no token — the write gate is never consulted", async () => {
    h.role.mockResolvedValue(NextResponse.json({ error: "admin" }, { status: 403 }));
    expect((await POST(post({ repositoryId: "repo-0", stage: "map", mode: "brief" }), ctx)).status).toBe(403);
    expect(h.write).not.toHaveBeenCalled();
    expect(h.create).not.toHaveBeenCalled();
  });

  it("composes the brief, supersedes the open row for (repo, stage), records handed_off and answers 201", async () => {
    const res = await POST(post({ repositoryId: "repo-0", stage: "conform", mode: "brief", subjects: ["quality-gates", " feature-flags ", "quality-gates"] }), ctx);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(typeof body.brief).toBe("string");
    expect(body.brief).toContain("/conform --subject quality-gates");
    expect(body.brief).toContain("/conform --subject feature-flags");
    expect(body.brief).toContain(`Dispatch id: \`${body.dispatch.id}\``);
    expect(h.supersede).toHaveBeenCalledWith("org-1", "repo-0", "conform");
    expect(h.create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: body.dispatch.id,
        orgId: "org-1",
        repositoryId: "repo-0",
        registryId: "reg-1",
        stage: "conform",
        mode: "brief",
        status: "handed_off",
        subjects: ["quality-gates", "feature-flags"],
        actor: "octocat",
        mapShaBefore: "sha-0",
      }),
    );
    expect(h.create.mock.calls[0]![0].briefDigest).toMatch(/^sha256:[0-9a-f]{16}$/);
    expect(h.run).not.toHaveBeenCalled();
  });

  it("404s a repo outside the org — the id goes into the org-constrained query, never to a bare lookup", async () => {
    h.targets.mockResolvedValue({ orgId: "org-1", repos: [] });
    const res = await POST(post({ repositoryId: "someone-elses", stage: "map", mode: "brief" }), ctx);
    expect(res.status).toBe(404);
    expect(h.targets).toHaveBeenCalledWith({ orgId: "org-1" }, ["someone-elses"]);
    expect(h.create).not.toHaveBeenCalled();
  });

  it("409s a conform dispatch for a repo with no map, with a plain message", async () => {
    h.maps.mockResolvedValue([mapRow({ mapSha: null })]);
    const res = await POST(post({ repositoryId: "repo-0", stage: "conform", mode: "brief", subjects: ["a"] }), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain("no .ai/registry-map.json yet");
  });

  it("409s when the org has no registry mapped", async () => {
    h.registry.mockResolvedValue(null);
    const res = await POST(post({ repositoryId: "repo-0", stage: "map", mode: "brief" }), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("not-mapped");
  });

  it("records a null mapShaBefore for a never-swept repo", async () => {
    h.maps.mockResolvedValue([]);
    await POST(post({ repositoryId: "repo-0", stage: "populate", mode: "brief" }), ctx);
    expect(h.create.mock.calls[0]![0].mapShaBefore).toBeNull();
  });
});

describe("POST local", () => {
  const local = { repositoryId: "repo-0", stage: "map", mode: "local" };

  it("404s on managed cloud before any role check", async () => {
    h.selfHost.mockReturnValue(NextResponse.json({ error: "Not found." }, { status: 404 }));
    expect((await POST(post(local), ctx)).status).toBe(404);
    expect(h.requireOrgRole).not.toHaveBeenCalled();
  });

  it("needs an owner", async () => {
    h.requireOrgRole.mockResolvedValue(NextResponse.json({ error: "owner" }, { status: 403 }));
    expect((await POST(post(local), ctx)).status).toBe(403);
    expect(h.requireOrgRole).toHaveBeenCalledWith("acme", "owner");
    expect(h.create).not.toHaveBeenCalled();
  });

  it("409s autopilot-off when the operator has not consented", async () => {
    h.autopilot.mockReturnValue(false);
    const res = await POST(post(local), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("autopilot-off");
    expect(h.run).not.toHaveBeenCalled();
  });

  it("409s not-paired when the repo has no local path", async () => {
    const res = await POST(post(local), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("not-paired");
    expect(h.write).not.toHaveBeenCalled();
  });

  it("takes the write gate's refusal verbatim when no installation token can be minted", async () => {
    h.localPath.mockResolvedValue("/repos/api");
    h.write.mockResolvedValue(NextResponse.json({ error: "nope", code: "not-permitted" }, { status: 403 }));
    expect((await POST(post(local), ctx)).status).toBe(403);
    expect(h.write).toHaveBeenCalledWith("acme", { minRole: "owner" });
    expect(h.create).not.toHaveBeenCalled();
  });

  it("creates the row running, answers 202 at once, and starts the runner detached with the brief and token", async () => {
    h.localPath.mockResolvedValue("/repos/api");
    h.branch.mockResolvedValue("develop");
    const res = await POST(post(local), ctx);
    expect(res.status).toBe(202);
    const body = await res.json();
    expect(body.brief).toBeUndefined();
    expect(h.create).toHaveBeenCalledWith(expect.objectContaining({ mode: "local", status: "running", startedAt: expect.any(Date) }));
    expect(h.run).toHaveBeenCalledTimes(1);
    const [, arg] = h.run.mock.calls[0]!;
    expect(arg).toMatchObject({
      orgId: "org-1",
      dispatchId: body.dispatch.id,
      stage: "map",
      repo: { repositoryId: "repo-0", fullName: "acme/api", defaultBranch: "develop", localPath: "/repos/api" },
      token: "tok",
    });
    expect(arg.brief).toContain("Never commit to `develop` directly.");
  });
});
