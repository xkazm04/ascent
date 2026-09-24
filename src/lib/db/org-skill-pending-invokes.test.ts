// Pending invokes (backlog develop-2026-09-17 row 5): an agent's report for a registry skill the
// library has not mirrored yet survives the race with the indexer, and the next index pass attaches
// it. The Prisma client is mocked with a tiny in-memory OrgSkillEvent table so the re-key, the
// duplicate drop and the tenant filter are exercised as data, not as call shapes.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetPrisma } = vi.hoisted(() => ({ mockGetPrisma: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ getPrisma: mockGetPrisma, isDbConfigured: () => true }));

import { attachPendingSkillInvokes, recordPendingSkillInvoke } from "@/lib/db/org-skill-pending-invokes";
import { upsertRegistrySkill } from "@/lib/db/org-registry-mirror";
import { listSkillInvokeAnchors, skillEventDedupeKey } from "@/lib/db/org-skills";
import { unmirroredSkillId } from "@/lib/registry/usage-samples";

type Ev = { id: string; orgId: string; skillId: string; type: string; sessionId: string | null; dedupeKey: string | null; createdAt: Date; repo?: string | null };
type Where = Partial<Record<keyof Ev, unknown>>;

function db(initial: Ev[] = []) {
  const events = [...initial];
  const tally = { txns: 0, uses: [] as unknown[] };
  const match = (w: Where) => (e: Ev) => Object.entries(w).every(([k, v]) => e[k as keyof Ev] === v);
  const prisma = {
    organization: { findUnique: vi.fn(async ({ where }: { where: { slug: string } }) => (where.slug === "acme" ? { id: "org_acme" } : null)) },
    orgSkillEvent: {
      findFirst: vi.fn(async ({ where }: { where: Where }) => events.find(match(where)) ?? null),
      findMany: vi.fn(async ({ where }: { where: Where }) => events.filter(match(where))),
      createMany: vi.fn(async ({ data }: { data: Omit<Ev, "id">[] }) => {
        data.forEach((d, i) => events.push({ id: `new-${events.length + i}`, ...d }));
        return { count: data.length };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Partial<Ev> }) => Object.assign(events.find((e) => e.id === where.id)!, data)),
      delete: vi.fn(async ({ where }: { where: { id: string } }) => events.splice(events.findIndex((e) => e.id === where.id), 1)[0]),
      groupBy: vi.fn(async () => []),
    },
    orgSkillDownload: { upsert: vi.fn(async (a: unknown) => (tally.uses.push(a), {})) },
    orgSkill: {
      update: vi.fn(async () => ({})),
      findFirst: vi.fn(async () => null),
      create: vi.fn(async () => ({ id: "skill-real" })),
    },
    $transaction: vi.fn(async () => (tally.txns++, [])),
  };
  mockGetPrisma.mockReturnValue(prisma);
  return { events, tally, prisma };
}

const TS = "2026-09-24T10:00:00.000Z";
const pendingRow = (over: Partial<Ev> = {}): Ev => ({
  id: "p1",
  orgId: "org_acme",
  skillId: unmirroredSkillId("deploy-check"),
  type: "invoke",
  sessionId: "sess-1",
  dedupeKey: skillEventDedupeKey("sess-1", unmirroredSkillId("deploy-check"), new Date(TS)),
  createdAt: new Date(TS),
  ...over,
});

beforeEach(() => {
  mockGetPrisma.mockReset();
  vi.useFakeTimers({ now: new Date("2026-09-24T12:00:00.000Z"), toFake: ["Date"] });
});

describe("recordPendingSkillInvoke", () => {
  it("holds the invoke under the registry NAME, in the caller's org, without inventing an OrgSkill", async () => {
    const { events, prisma } = db();
    const r = await recordPendingSkillInvoke("acme", { name: "Deploy Check", session: "sess-1", repo: "acme/api", ts: TS });
    expect(r).toEqual({ recorded: 1, name: "deploy-check" });
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ orgId: "org_acme", skillId: "registry:deploy-check", type: "invoke", source: "mcp", repo: "acme/api" });
    expect(prisma.orgSkill.create).not.toHaveBeenCalled();
  });

  it("records a retried report once (same session, same bucketed ts)", async () => {
    const { events } = db();
    await recordPendingSkillInvoke("acme", { name: "deploy-check", session: "sess-1", ts: TS });
    const again = await recordPendingSkillInvoke("acme", { name: "deploy-check", session: "sess-1", ts: TS });
    expect(again?.recorded).toBe(0);
    expect(events).toHaveLength(1);
  });

  it("guard: records nothing for a name that slugs to nothing", async () => {
    const { events } = db();
    expect(await recordPendingSkillInvoke("acme", { name: "!!!", session: "s" })).toEqual({ recorded: 0, name: "" });
    expect(events).toHaveLength(0);
  });
});

describe("attachPendingSkillInvokes", () => {
  it("re-keys the pending rows onto the mirrored skill and counts them as uses", async () => {
    const { events, tally } = db([pendingRow()]);
    expect(await attachPendingSkillInvokes("org_acme", "skill-real", "deploy-check")).toBe(1);
    expect(events[0]!.skillId).toBe("skill-real");
    // The key hashes the skill id, so it is recomputed: a post-mirror retry now dedupes against it.
    expect(events[0]!.dedupeKey).toBe(skillEventDedupeKey("sess-1", "skill-real", new Date(TS)));
    expect(tally.txns).toBe(1);
  });

  it("drops a pending row whose invocation was already recorded against the real id", async () => {
    const real = pendingRow({ id: "r1", skillId: "skill-real", dedupeKey: skillEventDedupeKey("sess-1", "skill-real", new Date(TS)) });
    const { events, tally } = db([pendingRow(), real]);
    expect(await attachPendingSkillInvokes("org_acme", "skill-real", "deploy-check")).toBe(0);
    expect(events.map((e) => e.id)).toEqual(["r1"]);
    expect(tally.txns).toBe(0);
  });

  it("guard: never attaches another org's pending rows", async () => {
    const { events } = db([pendingRow({ orgId: "org_other" })]);
    expect(await attachPendingSkillInvokes("org_acme", "skill-real", "deploy-check")).toBe(0);
    expect(events[0]!.skillId).toBe("registry:deploy-check");
  });
});

describe("the index pass attaches", () => {
  it("upsertRegistrySkill re-keys the pending invokes onto the row it mirrored", async () => {
    const { events } = db([pendingRow()]);
    const id = await upsertRegistrySkill("org_acme", "reg-1", {
      path: "skills/deploy-check/SKILL.md",
      hash: "sha256-n1:x",
      name: "deploy-check",
      description: "",
      category: "workflow",
      content: "# Deploy check\n",
      version: null,
    });
    expect(id).toBe("skill-real");
    expect(events[0]!.skillId).toBe("skill-real");
  });
});

describe("listSkillInvokeAnchors", () => {
  it("excludes pending rows, so an outcome is never keyed to a skill the library does not hold", async () => {
    const { prisma } = db();
    await listSkillInvokeAnchors("acme");
    const where = (prisma.orgSkillEvent.groupBy.mock.calls[0] as unknown as [{ where: Record<string, unknown> }])[0].where;
    expect(where.NOT).toEqual({ skillId: { startsWith: "registry:" } });
  });
});
