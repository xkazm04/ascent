// The dispatch ledger's contract: wire-safe rows out, the org constraint on every write, and the
// one-open-per-(repo, stage) rule that `supersedeOpenDispatches` keeps. Prisma is mocked at the
// client boundary the way the sibling db tests mock it.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetPrisma, mockConfigured } = vi.hoisted(() => ({ mockGetPrisma: vi.fn(), mockConfigured: vi.fn(() => true) }));
vi.mock("@/lib/db/client", () => ({ getPrisma: mockGetPrisma, isDbConfigured: mockConfigured }));

import { createDispatch, listDispatches, markDispatch, supersedeOpenDispatches } from "./org-registry-dispatch";

type Row = Record<string, unknown> & { id: string };

function fakePrisma(seed: Row[] = []) {
  const rows: Row[] = [...seed];
  let n = rows.length;
  const registryDispatch = {
    create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      const row = { id: `d-${++n}`, createdAt: new Date("2026-09-05T10:00:00Z"), ...data };
      rows.push(row);
      return row;
    }),
    findMany: vi.fn(async ({ where, take }: { where: Record<string, unknown>; take: number }) =>
      rows
        .filter((r) => r.orgId === where.orgId && (!where.repositoryId || r.repositoryId === where.repositoryId))
        .sort((a, b) => (b.createdAt as Date).getTime() - (a.createdAt as Date).getTime())
        .slice(0, take),
    ),
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => rows.find((r) => r.id === where.id) ?? null),
    updateMany: vi.fn(async ({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
      const statusIn = (where.status as { in?: string[] } | undefined)?.in;
      const notId = (where.id as { not?: string } | undefined)?.not;
      const hits = rows.filter(
        (r) =>
          r.orgId === where.orgId &&
          (typeof where.id !== "string" || r.id === where.id) &&
          (!where.repositoryId || r.repositoryId === where.repositoryId) &&
          (!where.stage || r.stage === where.stage) &&
          (!statusIn || statusIn.includes(r.status as string)) &&
          (!notId || r.id !== notId),
      );
      for (const h of hits) Object.assign(h, data);
      return { count: hits.length };
    }),
  };
  const repository = {
    findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({ fullName: `acme/${where.id}` })),
    findMany: vi.fn(async ({ where }: { where: { id: { in: string[] } } }) => where.id.in.map((id) => ({ id, fullName: `acme/${id}` }))),
  };
  mockGetPrisma.mockReturnValue({ registryDispatch, repository });
  return { rows, registryDispatch };
}

const input = {
  orgId: "org-1",
  repositoryId: "api",
  registryId: "reg-1",
  stage: "conform" as const,
  mode: "brief" as const,
  subjects: ["table", "feed"],
  briefDigest: "sha256:abc",
  actor: "x@example.com",
  mapShaBefore: "m1",
};

beforeEach(() => {
  mockGetPrisma.mockReset();
  mockConfigured.mockReturnValue(true);
});

describe("createDispatch", () => {
  it("writes a handed_off row and returns the wire-safe shape with the repo name joined", async () => {
    fakePrisma();
    const row = await createDispatch(input);
    expect(row).toMatchObject({
      id: "d-1",
      repoFullName: "acme/api",
      stage: "conform",
      mode: "brief",
      status: "handed_off",
      subjects: ["table", "feed"],
      mapShaBefore: "m1",
      mapShaAfter: null,
      createdAt: "2026-09-05T10:00:00.000Z",
      startedAt: null,
      endedAt: null,
    });
    // ISO strings, never Date objects — the wire-safe rule.
    expect(typeof row!.createdAt).toBe("string");
  });

  it("returns null with persistence off rather than pretending a row was recorded", async () => {
    mockConfigured.mockReturnValue(false);
    expect(await createDispatch(input)).toBeNull();
  });
});

describe("listDispatches", () => {
  it("lists newest first, narrowed by repo when asked", async () => {
    const { rows } = fakePrisma();
    await createDispatch(input);
    rows[0]!.createdAt = new Date("2026-09-01T00:00:00Z");
    await createDispatch({ ...input, repositoryId: "web", stage: "map" });
    const all = await listDispatches("org-1");
    expect(all.map((d) => d.id)).toEqual(["d-2", "d-1"]);
    expect(all[0]!.repoFullName).toBe("acme/web");
    expect((await listDispatches("org-1", { repositoryId: "api" })).map((d) => d.id)).toEqual(["d-1"]);
  });
});

describe("markDispatch", () => {
  it("patches status and the run receipt, constrained by org", async () => {
    fakePrisma();
    await createDispatch(input);
    const updated = await markDispatch("org-1", "d-1", {
      status: "proposed",
      prUrl: "https://github.com/acme/api/pull/7",
      branch: "registry/conform-table",
      costMicros: 1234,
      endedAt: new Date("2026-09-05T11:00:00Z"),
    });
    expect(updated).toMatchObject({ status: "proposed", prUrl: "https://github.com/acme/api/pull/7", costMicros: 1234, endedAt: "2026-09-05T11:00:00.000Z" });
    // Another org's id does not reach the row.
    expect(await markDispatch("org-2", "d-1", { status: "failed" })).toBeNull();
    expect((await listDispatches("org-1"))[0]!.status).toBe("proposed");
  });
});

describe("supersedeOpenDispatches", () => {
  it("closes the OPEN rows for the same repo + stage, keeps the new one and terminal history", async () => {
    fakePrisma();
    await createDispatch(input); // d-1 handed_off
    await createDispatch({ ...input, status: "running" }); // d-2
    await createDispatch({ ...input, status: "done" }); // d-3 terminal
    await createDispatch({ ...input, stage: "map" }); // d-4 other stage
    await createDispatch(input); // d-5 the replacement
    const closed = await supersedeOpenDispatches("org-1", "api", "conform", "d-5");
    expect(closed).toBe(2);
    const byId = Object.fromEntries((await listDispatches("org-1")).map((d) => [d.id, d.status]));
    expect(byId).toEqual({ "d-1": "superseded", "d-2": "superseded", "d-3": "done", "d-4": "handed_off", "d-5": "handed_off" });
  });
});
