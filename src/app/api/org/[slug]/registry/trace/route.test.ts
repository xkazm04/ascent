// Route test for GET /api/org/[slug]/registry/trace (#36).
//
// What this route alone owns: the cache key, the narrow escalation on a miss, and — the one that
// matters for honesty — that an unreachable GitHub produces "history unavailable" rather than an
// empty timeline a reader would take as "this skill has no history".

import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class extends Response {
    static json(body: unknown, init?: { status?: number }) {
      return new this(JSON.stringify(body), {
        status: init?.status ?? 200,
        headers: { "content-type": "application/json" },
      });
    }
  },
}));

const h = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn(),
  orgId: vi.fn(),
  registry: vi.fn(),
  getTrace: vi.fn(),
  putTrace: vi.fn(),
  lessons: vi.fn(),
  commits: vi.fn(),
  fileAt: vi.fn(),
  localCommits: vi.fn(),
  localFileAt: vi.fn(),
  local: { dir: null as string | null },
}));

vi.mock("@/lib/registry/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/registry/api")>();
  return {
    ...actual,
    guardRegistryRead: h.read,
    guardRegistryWrite: h.write,
    resolveRegistrySource: async (slug: string) => {
      if (h.local.dir) return { kind: "local", row: { id: "reg-1" }, dir: h.local.dir };
      const gate = await h.write(slug);
      return gate && typeof gate === "object" && "token" in gate ? { kind: "github", row: null, token: gate.token } : gate;
    },
  };
});
vi.mock("@/lib/registry/local-source", () => ({ listLocalPathCommits: h.localCommits, readLocalFileAtRef: h.localFileAt }));
vi.mock("@/lib/db/org-rollup", () => ({ getOrgId: h.orgId }));
vi.mock("@/lib/db/org-registry", () => ({ getOrgRegistry: h.registry }));
vi.mock("@/lib/db/org-skill-trace", () => ({ getSkillTrace: h.getTrace, putSkillTrace: h.putTrace }));
vi.mock("@/lib/db/org-skill-lessons", () => ({ listSkillLessons: h.lessons }));
vi.mock("@/lib/registry/read", () => ({ listPathCommits: h.commits, readFileAtRef: h.fileAt }));

import { NextResponse } from "next/server";
import { GET } from "./route";

const ctx = { params: Promise.resolve({ slug: "acme" }) };
const req = (skill = "forge") => new Request(`http://t/api/org/acme/registry/trace?skill=${skill}`);

const SKILL_MD = `---\nname: forge\ndescription: d\ncategory: workflow\nversion: 2.1.0\n---\n\nbody\n`;

beforeEach(() => {
  vi.clearAllMocks();
  h.local.dir = null;
  h.read.mockResolvedValue(null);
  h.write.mockResolvedValue({ token: "tok", capabilities: {} });
  h.orgId.mockResolvedValue("org-1");
  h.registry.mockResolvedValue({ id: "reg-1", fullName: "acme/ai-registry", defaultBranch: "main", lastIndexSha: "head-1" });
  h.getTrace.mockResolvedValue(null);
  h.lessons.mockResolvedValue([{ id: "l1", versionUsed: "2.1.0" }]);
  h.commits.mockResolvedValue({
    commits: [
      { sha: "c2", authoredAt: "2026-08-25T00:00:00.000Z", authorLogin: "a", message: "bump" },
      { sha: "c1", authoredAt: "2026-08-20T00:00:00.000Z", authorLogin: null, message: "seed" },
    ],
    truncated: false,
  });
  h.fileAt.mockResolvedValue(SKILL_MD);
  h.putTrace.mockResolvedValue(undefined);
});

describe("cache", () => {
  it("serves a cache hit as ONE db read, touching GitHub not at all", async () => {
    h.getTrace.mockResolvedValue({ skillName: "forge", registryPath: "p", headSha: "head-1", entries: [{ sha: "c2" }], truncated: false, builtAt: "t" });
    const body = await (await GET(req(), ctx)).json();
    expect(body).toMatchObject({ cached: true, entries: [{ sha: "c2" }] });
    expect(h.write).not.toHaveBeenCalled();
    expect(h.commits).not.toHaveBeenCalled();
  });

  it("rebuilds when the registry head has moved past the cached one", async () => {
    h.getTrace.mockResolvedValue({ skillName: "forge", registryPath: "p", headSha: "OLD", entries: [], truncated: false, builtAt: "t" });
    const body = await (await GET(req(), ctx)).json();
    expect(body.cached).toBe(false);
    expect(h.commits).toHaveBeenCalled();
    expect(h.putTrace).toHaveBeenCalledWith(expect.objectContaining({ headSha: "head-1", registryPath: "skills/forge/SKILL.md" }));
  });

  it("resolves versions for the newest commits and leaves the rest null", async () => {
    h.fileAt.mockImplementation(async (_t: string, _o: string, _r: string, _p: string, ref: string) =>
      ref === "c2" ? SKILL_MD : null,
    );
    const body = await (await GET(req(), ctx)).json();
    expect(body.entries.map((e: { sha: string; version: string | null }) => [e.sha, e.version])).toEqual([
      ["c2", "2.1.0"],
      ["c1", null],
    ]);
  });
});

describe("local registry", () => {
  it("reads history from the paired checkout with git, never minting a token", async () => {
    h.local.dir = "C:/registry";
    h.localCommits.mockResolvedValue({ commits: [{ sha: "c9", authoredAt: "2026-09-16T00:00:00.000Z", authorLogin: null, message: "bump" }], truncated: false });
    h.localFileAt.mockResolvedValue(SKILL_MD);
    const body = await (await GET(req(), ctx)).json();
    expect(h.localCommits).toHaveBeenCalledWith("C:/registry", "skills/forge/SKILL.md", "head-1", expect.any(Number));
    expect(body.entries[0]).toMatchObject({ sha: "c9", version: "2.1.0" });
    expect(h.write).not.toHaveBeenCalled();
    expect(h.commits).not.toHaveBeenCalled();
  });
});

describe("degrade paths", () => {
  it("says HISTORY UNAVAILABLE rather than returning an empty timeline", async () => {
    h.commits.mockRejectedValue(new Error("rate limited"));
    const body = await (await GET(req(), ctx)).json();
    expect(body.entries).toEqual([]);
    expect(body.error).toContain("History is unavailable");
    // The lessons are still served — they are in the database and do not depend on GitHub.
    expect(body.lessons).toHaveLength(1);
    expect(h.putTrace).not.toHaveBeenCalled();
  });

  it("serves a STALE cache when the token cannot be minted, labelled as stale", async () => {
    h.getTrace.mockResolvedValue({ skillName: "forge", registryPath: "p", headSha: "OLD", entries: [{ sha: "c0" }], truncated: false, builtAt: "t" });
    h.write.mockResolvedValue(NextResponse.json({ error: "no" }, { status: 403 }));
    const body = await (await GET(req(), ctx)).json();
    expect(body).toMatchObject({ stale: true, cached: true, headSha: "OLD" });
    expect(body.entries).toHaveLength(1);
  });

  it("says unavailable when there is neither a cache nor a token", async () => {
    h.write.mockResolvedValue(NextResponse.json({ error: "no" }, { status: 403 }));
    const body = await (await GET(req(), ctx)).json();
    expect(body.entries).toEqual([]);
    expect(body.error).toContain("History is unavailable");
  });
});

describe("gates and input", () => {
  it("takes the read guard's refusal verbatim", async () => {
    h.read.mockResolvedValue(new Response("no", { status: 403 }));
    expect((await GET(req(), ctx)).status).toBe(403);
    expect(h.registry).not.toHaveBeenCalled();
  });

  it("400s a skill name that could not address a path", async () => {
    expect((await GET(req("../../etc/passwd"), ctx)).status).toBe(400);
    expect((await GET(new Request("http://t/api/org/acme/registry/trace"), ctx)).status).toBe(400);
  });

  it("409s when no registry is mapped", async () => {
    h.registry.mockResolvedValue(null);
    expect((await GET(req(), ctx)).status).toBe(409);
  });
});
