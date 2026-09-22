// Route test for POST /api/org/[slug]/registry/index (ai-registry-repo#A, challenge-2026-09-23).
// What this route owns: the local-first source choice, the wire shape, and — since the index pass
// became one door — that a double-click JOINS the pass in flight instead of starting a second one
// over the same registry. The indexer is mocked at its module boundary and held open by a deferred.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class extends Response {
    static json(body: unknown, init?: { status?: number }) {
      return new this(JSON.stringify(body), { status: init?.status ?? 200, headers: { "content-type": "application/json" } });
    }
  },
}));

const { mockGate, mockGetRegistry, mockIndex } = vi.hoisted(() => ({
  mockGate: vi.fn(),
  mockGetRegistry: vi.fn(),
  mockIndex: vi.fn(),
}));

vi.mock("@/lib/registry/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/registry/api")>()),
  resolveRegistrySource: mockGate,
}));
vi.mock("@/lib/db/org-registry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/db/org-registry")>()),
  getOrgRegistry: mockGetRegistry,
}));
vi.mock("@/lib/registry/index-registry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/registry/index-registry")>()),
  indexRegistry: mockIndex,
}));

import { POST } from "./route";

const ctx = { params: Promise.resolve({ slug: "acme" }) };
const req = () => new Request("http://t/api/org/acme/registry/index", { method: "POST" });
const REGISTRY = { id: "reg-1", fullName: "acme/ai-registry", defaultBranch: "main", localPath: null };
const OK = {
  kind: "ok",
  headSha: "sha-1",
  counts: { skills: 2, practices: 1, memory: 0, lessons: 0 },
  archived: { skills: 0, practices: 0, memory: 0 },
  warnings: ["w1"],
  catalog: { internal: true },
};

beforeEach(() => {
  vi.clearAllMocks();
  mockGate.mockResolvedValue({ kind: "github", row: REGISTRY, token: "ghs_x" });
  mockGetRegistry.mockResolvedValue(REGISTRY);
  mockIndex.mockResolvedValue(OK);
});

describe("POST /api/org/[slug]/registry/index", () => {
  it("two concurrent POSTs run ONE pass and both answer with the same headSha/counts", async () => {
    let settle!: (r: unknown) => void;
    mockIndex.mockImplementationOnce(() => new Promise((r) => (settle = r)));
    const a = POST(req(), ctx);
    const b = POST(req(), ctx);
    // Let both requests reach the door before the pass settles.
    for (let i = 0; i < 10 && mockIndex.mock.calls.length === 0; i++) await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    settle(OK);
    const [ra, rb] = await Promise.all([a, b]);
    expect(mockIndex).toHaveBeenCalledTimes(1);
    const [ja, jb] = [await ra.json(), await rb.json()];
    expect(ja.headSha).toBe("sha-1");
    expect(jb.headSha).toBe("sha-1");
    expect(ja.counts).toEqual(jb.counts);
  });

  it("guard: the response keys stay {fullName, source, headSha, counts, archived, warnings}", async () => {
    mockIndex.mockResolvedValueOnce(OK);
    const res = await POST(req(), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["archived", "counts", "fullName", "headSha", "source", "warnings"]);
    expect(body).toMatchObject({ fullName: "acme/ai-registry", source: "github", warnings: ["w1"] });
  });

  it("guard: 409 not-mapped when nothing is mapped, and the indexer is never reached", async () => {
    mockGetRegistry.mockResolvedValueOnce(null);
    const res = await POST(req(), ctx);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("not-mapped");
    expect(mockIndex).not.toHaveBeenCalled();
  });

  it("guard: 502 github-error when the pass fails, carrying its message", async () => {
    mockIndex.mockResolvedValueOnce({ kind: "error", message: "tree unreadable" });
    const res = await POST(req(), ctx);
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ code: "github-error", error: "tree unreadable" });
  });
});
