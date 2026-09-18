// The lesson route's STANDING-RUNNER surface (spark theater-upgrade, operator Q10): the ledger's read
// of what the runner kept (`runnerKept` on the GET) and the owner's `revoke`. The db layer is mocked
// with the same gate-then-constrain shape it really has — every call takes the org and matches on it —
// so the tenancy case below is about the ROUTE passing the authorized org through, not a mock agreeing.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/server", () => ({
  NextResponse: class {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), init);
    }
  },
}));

const gates = { access: null as unknown, deniedBelow: null as null | "owner" };
const roles: string[] = [];

vi.mock("@/lib/api/self-host", () => ({ selfHostGuard: () => null }));
vi.mock("@/lib/auth", () => ({ PUBLIC_ORG: "public", requireSameOrigin: () => null }));
vi.mock("@/lib/access", () => ({ getViewer: vi.fn(async () => ({ login: "kazimi66" })) }));
vi.mock("@/lib/authz", () => ({
  requireOrgAccess: vi.fn(async () => gates.access),
  // Records the minimum role each write asked for; `deniedBelow: "owner"` models a MEMBER caller.
  requireOrgRole: vi.fn(async (_org: string, min: string) => {
    roles.push(min);
    return gates.deniedBelow === "owner" && min === "owner" ? new Response(JSON.stringify({ error: "Forbidden." }), { status: 403 }) : null;
  }),
}));
vi.mock("@/lib/db/org-memory", () => ({ createOrgMemory: vi.fn(async () => ({ id: "mem-x" })) }));

/** One runner-kept candidate per org, plus a human-kept one in acme. */
const kept = new Map<string, { org: string; state: string; by: string }>();
const revoked: { org: string; id: string; by: string | null }[] = [];
const listed: { org: string; since: Date | null }[] = [];

vi.mock("@/lib/db/loop-lessons", () => ({
  LOOP_LESSON_SOURCE: "loop-lesson",
  isLessonStatus: () => false,
  listLoopLessons: vi.fn(async () => []),
  getLoopLesson: vi.fn(async () => null),
  settleLoopLesson: vi.fn(async () => null),
  listRunnerKeptLessons: vi.fn(async (org: string, opts: { since?: Date | null }) => {
    listed.push({ org, since: opts.since ?? null });
    return [...kept.entries()].filter(([, v]) => v.org === org && v.by === "runner").map(([id]) => ({ id, state: "kept" }));
  }),
  revokeRunnerKeptLesson: vi.fn(async (org: string, id: string, by: string | null) => {
    const row = kept.get(id);
    if (!row || row.org !== org) return { ok: false, reason: "not-found" };
    if (row.by !== "runner" || row.state !== "kept") return { ok: false, reason: "not-runner-kept" };
    if (id === "c-flaky") return { ok: false, reason: "failed" };
    row.state = "revoked";
    revoked.push({ org, id, by });
    return { ok: true, lesson: { id, state: "revoked", revokedBy: by } };
  }),
}));

import { GET, POST } from "./route";

const post = (body: unknown) =>
  POST(new Request("http://localhost/api/org/loop/lessons", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
const get = (qs: string) => GET(new Request(`http://localhost/api/org/loop/lessons?${qs}`));

beforeEach(() => {
  gates.access = null;
  gates.deniedBelow = null;
  roles.length = 0;
  revoked.length = 0;
  listed.length = 0;
  kept.clear();
  kept.set("c-acme", { org: "acme", state: "kept", by: "runner" });
  kept.set("c-human", { org: "acme", state: "kept", by: "human" });
  kept.set("c-flaky", { org: "acme", state: "kept", by: "runner" });
  kept.set("c-other", { org: "other", state: "kept", by: "runner" });
});

describe("GET — the ledger's read of what the runner kept", () => {
  it("adds `runnerKept` beside `lessons`, for the authorized org only", async () => {
    const res = await get("org=acme");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { lessons: unknown[]; runnerKept: { id: string }[] };
    expect(body.lessons).toEqual([]);
    expect(body.runnerKept.map((r) => r.id).sort()).toEqual(["c-acme", "c-flaky"]);
    expect(listed).toEqual([{ org: "acme", since: null }]);
  });

  it("passes a valid `since` through as a Date and 400s a malformed one before reading anything", async () => {
    await get("org=acme&since=2026-09-18T06:00:00.000Z");
    expect(listed[0]!.since?.toISOString()).toBe("2026-09-18T06:00:00.000Z");
    const bad = await get("org=acme&since=yesterday");
    expect(bad.status).toBe(400);
    expect(listed).toHaveLength(1);
  });

  it("is behind the read gate like the rest of the GET", async () => {
    gates.access = new Response(JSON.stringify({ error: "Forbidden." }), { status: 403 });
    expect((await get("org=acme")).status).toBe(403);
    expect(listed).toEqual([]);
  });
});

describe("POST revoke — the owner takes back a runner keep", () => {
  it("asks for the OWNER role, not member, and revokes as the signed-in owner", async () => {
    const res = await post({ org: "acme", id: "c-acme", action: "revoke" });
    expect(res.status).toBe(200);
    expect(roles).toEqual(["owner"]);
    expect(revoked).toEqual([{ org: "acme", id: "c-acme", by: "kazimi66" }]);
    expect(((await res.json()) as { lesson: { state: string } }).lesson.state).toBe("revoked");
  });

  it("refuses a member: 403, and nothing is revoked", async () => {
    gates.deniedBelow = "owner";
    expect((await post({ org: "acme", id: "c-acme", action: "revoke" })).status).toBe(403);
    expect(revoked).toEqual([]);
  });

  it("404s ANOTHER org's runner-kept lesson — the id is looked up inside the authorized org only", async () => {
    const res = await post({ org: "acme", id: "c-other", action: "revoke" });
    expect(res.status).toBe(404);
    expect(revoked).toEqual([]);
    expect(kept.get("c-other")!.state).toBe("kept");
  });

  it("409s a lesson a HUMAN kept, and a second revoke of the same lesson", async () => {
    expect((await post({ org: "acme", id: "c-human", action: "revoke" })).status).toBe(409);
    expect((await post({ org: "acme", id: "c-acme", action: "revoke" })).status).toBe(200);
    expect((await post({ org: "acme", id: "c-acme", action: "revoke" })).status).toBe(409);
  });

  it("500s a failed write with a message that says a retry is safe", async () => {
    const res = await post({ org: "acme", id: "c-flaky", action: "revoke" });
    expect(res.status).toBe(500);
    expect(((await res.json()) as { error: string }).error).toMatch(/again is safe/);
  });

  it("keep and discard still ask for member, never owner", async () => {
    await post({ org: "acme", id: "c-acme", action: "keep" });
    await post({ org: "acme", id: "c-acme", action: "discard" });
    expect(roles).toEqual(["member", "member"]);
  });
});
