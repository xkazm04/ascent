// The lesson inbox's guards. The one that matters most is the last: a `keep` is the ONLY path in the
// loop that writes into Org Memory, and it runs as a human's decision through the shared memory door
// — never as the agent's own write.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));

const gates = { selfHosted: true, sameOrigin: true, access: null as unknown, role: null as unknown };

vi.mock("@/lib/api/self-host", () => ({
  selfHostGuard: () => (gates.selfHosted ? null : new Response(JSON.stringify({ error: "Not found." }), { status: 404 })),
}));
vi.mock("@/lib/auth", () => ({
  PUBLIC_ORG: "public",
  requireSameOrigin: () => (gates.sameOrigin ? null : new Response(JSON.stringify({ error: "Cross-origin." }), { status: 403 })),
}));
vi.mock("@/lib/access", () => ({ getViewer: vi.fn(async () => ({ login: "kazimi66" })) }));
vi.mock("@/lib/authz", () => ({
  requireOrgAccess: vi.fn(async () => gates.access),
  requireOrgRole: vi.fn(async () => gates.role),
}));

const created: Record<string, unknown>[] = [];
vi.mock("@/lib/db/org-memory", () => ({
  createOrgMemory: vi.fn(async (org: string, input: Record<string, unknown>) => {
    created.push({ org, ...input });
    return { id: "mem-1" };
  }),
}));

/** Two candidates, one per org — the whole point of the tenancy case below. */
const store = new Map<string, { id: string; org: string; status: string; content: string; namespace: string | null; kind: string }>();
const settled: { id: string; action: string; promotedMemoryId: string | null }[] = [];

vi.mock("@/lib/db/loop-lessons", () => ({
  LOOP_LESSON_SOURCE: "loop-lesson",
  isLessonStatus: (v: unknown) => v === "pending" || v === "kept" || v === "discarded",
  listLoopLessons: vi.fn(async (org: string) => [...store.values()].filter((c) => c.org === org)),
  // GATE-THEN-CONSTRAIN, modelled: both take the org and match on it, so a foreign id is "not found".
  getLoopLesson: vi.fn(async (org: string, id: string) => {
    const c = store.get(id);
    return c && c.org === org ? { ...c, promotedMemoryId: null } : null;
  }),
  settleLoopLesson: vi.fn(async (org: string, id: string, action: string, _by: string | null, promotedMemoryId: string | null) => {
    const c = store.get(id);
    if (!c || c.org !== org) return null;
    settled.push({ id, action, promotedMemoryId });
    c.status = action === "keep" ? "kept" : "discarded";
    return { ...c, promotedMemoryId };
  }),
}));

import { GET, POST } from "./route";

const post = (body: unknown) =>
  POST(new Request("http://localhost/api/org/loop/lessons", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
const get = (qs: string) => GET(new Request(`http://localhost/api/org/loop/lessons?${qs}`));

beforeEach(() => {
  gates.selfHosted = true;
  gates.sameOrigin = true;
  gates.access = null;
  gates.role = null;
  created.length = 0;
  settled.length = 0;
  store.clear();
  store.set("c-acme", { id: "c-acme", org: "acme", status: "pending", content: "We pin actions by sha.", namespace: "acme/web", kind: "procedural" });
  store.set("c-other", { id: "c-other", org: "other", status: "pending", content: "Not yours.", namespace: null, kind: "procedural" });
});

describe("gates", () => {
  it("404s off a self-hosted deployment, on both verbs", async () => {
    gates.selfHosted = false;
    expect((await get("org=acme")).status).toBe(404);
    expect((await post({ org: "acme", id: "c-acme", action: "keep" })).status).toBe(404);
  });

  it("refuses a cross-origin write BEFORE anything else", async () => {
    gates.sameOrigin = false;
    const res = await post({ org: "acme", id: "c-acme", action: "keep" });
    expect(res.status).toBe(403);
    expect(created).toEqual([]);
  });

  it("takes the org role for a write and mere access for the read", async () => {
    gates.role = new Response(JSON.stringify({ error: "Forbidden." }), { status: 403 });
    expect((await post({ org: "acme", id: "c-acme", action: "discard" })).status).toBe(403);
    expect((await get("org=acme")).status).toBe(200);
  });
});

describe("tenancy — gate-then-constrain", () => {
  it("404s a keep on another org's candidate, and writes no memory for it", async () => {
    const res = await post({ org: "acme", id: "c-other", action: "keep" });
    expect(res.status).toBe(404);
    expect(created).toEqual([]);
    expect(settled).toEqual([]);
  });

  it("404s a discard on another org's candidate", async () => {
    expect((await post({ org: "acme", id: "c-other", action: "discard" })).status).toBe(404);
  });
});

describe("keep / discard", () => {
  it("promotes through the shared memory door and stamps the memory it became", async () => {
    const res = await post({ org: "acme", id: "c-acme", action: "keep" });
    expect(res.status).toBe(200);
    // The loop never writes OrgMemory itself; this is the human's decision going through the one door.
    expect(created[0]).toMatchObject({ org: "acme", content: "We pin actions by sha.", namespace: "acme/web", source: "loop-lesson" });
    expect(settled[0]).toMatchObject({ action: "keep", promotedMemoryId: "mem-1" });
  });

  it("discards SOFTLY — the row is settled, never deleted, and no memory is written", async () => {
    const res = await post({ org: "acme", id: "c-acme", action: "discard" });
    expect(res.status).toBe(200);
    expect(created).toEqual([]);
    expect(settled[0]).toMatchObject({ action: "discard", promotedMemoryId: null });
    expect(store.get("c-acme")!.status).toBe("discarded");
  });

  it("409s a second keep rather than writing the memory twice", async () => {
    store.get("c-acme")!.status = "kept";
    const res = await post({ org: "acme", id: "c-acme", action: "keep" });
    expect(res.status).toBe(409);
    expect(created).toEqual([]);
  });

  it("400s a missing action instead of guessing one", async () => {
    expect((await post({ org: "acme", id: "c-acme" })).status).toBe(400);
    expect((await post({ org: "acme", action: "keep" })).status).toBe(400);
  });
});
