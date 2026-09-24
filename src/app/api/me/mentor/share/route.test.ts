// POST/GET/DELETE /api/me/mentor/share: owner-self only (backlog develop-2026-09-17 row 46).
//
// The db module runs for real against an in-memory Prisma double, so "the data is really gone" is a
// claim about the table, not about a mocked helper. Identity is mocked at the ONE place the route may
// read it (`resolveViewerLogin`); the body never gets a say in whose row is touched.

import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = { id: string; login: string; payloadJson: string; sharedAt: Date };
const { table, resolveViewerLogin, calls } = vi.hoisted(() => ({
  table: new Map<string, Row>(),
  resolveViewerLogin: vi.fn<() => Promise<string | null>>(),
  calls: [] as unknown[],
}));

vi.mock("@/lib/access", () => ({ resolveViewerLogin }));
vi.mock("@/lib/db/client", () => ({
  isDbConfigured: () => true,
  getPrisma: () => ({
    mentorShare: {
      findUnique: async (q: { where: { login: string } }) => (calls.push(q), table.get(q.where.login) ?? null),
      upsert: async (q: { where: { login: string }; create: Omit<Row, "id">; update: Partial<Row> }) => {
        calls.push(q);
        const prev = table.get(q.where.login);
        table.set(q.where.login, prev ? { ...prev, ...q.update } : { id: `id-${table.size}`, ...q.create });
      },
      deleteMany: async (q: { where: { login: string } }) => {
        calls.push(q);
        return { count: table.delete(q.where.login) ? 1 : 0 };
      },
    },
  }),
}));

import { DELETE, GET, POST } from "./route";

const share = () => ({
  contract: 1,
  profile: { role: "backend engineer", archetypeHint: "verifier", goals: ["fewer re-corrections"] },
  moves: [{ id: "plan-mode", title: "Plan mode first", state: "kept", category: "session", why: "re-corrections", expectedSaving: 95, tryFor: null, at: "2026-09-20T10:00:00Z" }],
  journal: [{ at: "2026-09-21T08:00:00Z", line: "kept plan mode", kind: "retro" }],
  shape: { contract: 1, windowDays: 30, launcher: "interactive-only", excludedProgrammatic: 0, fields: { sessionsPerWeek: 3 } },
});
const post = (body: unknown) => POST(new Request("http://x/api/me/mentor/share", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));
const as = (login: string | null) => resolveViewerLogin.mockResolvedValue(login);

beforeEach(() => {
  table.clear();
  calls.length = 0;
  vi.clearAllMocks();
});

describe("owner-self: the session decides whose row, nothing else does", () => {
  it("stores a valid share for the signed-in viewer and returns it on the next GET", async () => {
    as("Ada");
    const res = await post(share());
    expect(res.status).toBe(200);
    expect([...table.keys()]).toEqual(["ada"]);
    const got = await GET();
    expect(got.status).toBe(200);
    const body = await got.json();
    expect(body.share.profile.role).toBe("backend engineer");
    expect(typeof body.sharedAt).toBe("string");
    expect(body.share.moves[0].at).toBe("2026-09-20T10:00:00.000Z");
  });

  it("another login reads 404, not 403, and cannot tell a share exists", async () => {
    as("ada");
    await post(share());
    as("bob");
    const res = await GET();
    expect(res.status).toBe(404);
    as("carol-never-shared");
    expect(await (await GET()).json()).toEqual(await res.json());
  });

  it("another login's DELETE is a 404 and leaves the owner's row intact", async () => {
    as("ada");
    await post(share());
    as("bob");
    expect((await DELETE()).status).toBe(404);
    expect(table.has("ada")).toBe(true);
  });

  it("a body that names someone else is refused and writes nothing for anyone", async () => {
    as("bob");
    const res = await post({ ...share(), login: "ada" });
    expect(res.status).toBe(400);
    expect(table.size).toBe(0);
  });

  it("every query is keyed by the resolved login, exactly", async () => {
    as("  Ada ");
    await post(share());
    await GET();
    await DELETE();
    for (const q of calls as Array<{ where: unknown }>) expect(q.where).toEqual({ login: "ada" });
  });

  it("signed out: 401 on every verb, and no query at all", async () => {
    as(null);
    expect((await post(share())).status).toBe(401);
    expect((await GET()).status).toBe(401);
    expect((await DELETE()).status).toBe(401);
    expect(calls).toEqual([]);
  });
});

describe("delete: the data is really gone", () => {
  it("DELETE removes the row, a second DELETE is a 404, and GET reads nothing", async () => {
    as("ada");
    await post(share());
    expect((await DELETE()).status).toBe(200);
    expect(table.size).toBe(0);
    expect((await DELETE()).status).toBe(404);
    expect((await GET()).status).toBe(404);
  });

  it("a new push replaces the snapshot whole: a section left out is not kept", async () => {
    as("ada");
    await post(share());
    await post({ contract: 1, journal: [] });
    const body = await (await GET()).json();
    expect(body.share).toEqual({ contract: 1, journal: [] });
  });
});

describe("strict validation at the door", () => {
  it("refuses never-sent content with 400 and stores nothing", async () => {
    as("ada");
    const res = await post({ ...share(), journal: [{ at: "2026-09-21T08:00:00Z", line: "x", transcript: "SECRET" }] });
    expect(res.status).toBe(400);
    expect((await res.json()).errors[0]).toMatch(/^never-sent field: journal\[0\]\.transcript/);
    expect(table.size).toBe(0);
  });

  it("refuses invalid JSON and an unknown key with 400", async () => {
    as("ada");
    expect((await post("{not json")).status).toBe(400);
    expect((await post({ ...share(), extra: true })).status).toBe(400);
    expect(table.size).toBe(0);
  });

  it("refuses an oversized body with 413 before parsing it", async () => {
    as("ada");
    const res = await post(JSON.stringify({ contract: 1, pad: "x".repeat(70 * 1024) }));
    expect(res.status).toBe(413);
    expect(table.size).toBe(0);
  });
});
