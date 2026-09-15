// Unit tests for the Feature 2 sync additions (mocked Prisma, mirroring org-skills.test.ts):
//   - pushOrgSkill: create when absent; idempotent `unchanged` on an identical body; `conflict` when the
//     supplied baseVersion is stale (no write); `updated` (version bumped) on a real change;
//   - recordSkillEvents: forged/other-org skillIds are dropped (tenant boundary), and only a real use
//     (`download` or `invoke`) bumps the rolling tally + downloadCount — a passive `sync` does not.
//     `invoke` is back (moonshot #19) now that the hook/MCP channel produces it, and it arrives with
//     the three writer invariants that make a chatty producer safe: a normalized `source`, a clamped
//     `ts`, and idempotency on (session, skill, ts).

import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";
import { contentDigest } from "@/lib/registry/parse";

const { mockGetPrisma } = vi.hoisted(() => ({ mockGetPrisma: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ getPrisma: mockGetPrisma, isDbConfigured: () => true }));
vi.mock("@/lib/db/org-rollup", () => ({ getOrgId: async (slug: string) => (slug === "acme" ? "org_acme" : null) }));

import { pushOrgSkill, recordSkillEvents, skillEventDedupeKey } from "@/lib/db/org-skills";

/** The canonical digest a row carries today — one shared function with the registry catalog. */
const hash = (s: string) => contentDigest(s);
/** The pre-`sha256-n1:` recipe: raw bytes, untagged. Only a row written before the change has one. */
const legacyHash = (s: string) => createHash("sha256").update(s).digest("hex");

function pushPrisma(existing: { id: string; version: number; contentHash: string } | null) {
  const calls = { create: 0, update: [] as { where: unknown; data: Record<string, unknown> }[] };
  const prisma = {
    organization: { upsert: vi.fn(async () => ({ id: "org_acme" })) },
    orgSkill: {
      findFirst: vi.fn(async () => existing),
      create: vi.fn(async () => { calls.create++; return { id: "skill_new", version: 1 }; }),
      update: vi.fn(async (args: { where: unknown; data: Record<string, unknown> }) => {
        calls.update.push(args);
        return { id: existing?.id ?? "x", version: (existing?.version ?? 1) + 1 };
      }),
    },
  };
  mockGetPrisma.mockReturnValue(prisma);
  return calls;
}

const input = { name: "Deploy", category: "workflow", content: "the body", description: "d" };

describe("pushOrgSkill", () => {
  it("creates when no skill of that name exists", async () => {
    const calls = pushPrisma(null);
    const r = await pushOrgSkill("acme", input);
    expect(r).toEqual({ status: "created", id: "skill_new", version: 1 });
    expect(calls.create).toBe(1);
  });

  it("is idempotent: identical body → unchanged, no write", async () => {
    const calls = pushPrisma({ id: "s1", version: 3, contentHash: hash("the body") });
    const r = await pushOrgSkill("acme", input);
    expect(r).toEqual({ status: "unchanged", id: "s1", version: 3 });
    expect(calls.update).toHaveLength(0);
  });

  it("re-keys a pre-versioning digest as `unchanged` — no mass diverge, no version bump", async () => {
    // THE MIGRATION DECISION. Versioning the digest changed every stored value at once; without the
    // legacy-recognition branch the first push after the change would report `updated` for every skill
    // in every library, bumping versions for content nobody touched — the fleet-wide false "diverged"
    // the normalization exists to prevent. The row is silently re-keyed instead.
    const calls = pushPrisma({ id: "s1", version: 3, contentHash: legacyHash("the body") });
    const r = await pushOrgSkill("acme", input);
    expect(r).toEqual({ status: "unchanged", id: "s1", version: 3 });
    expect(calls.update).toHaveLength(1);
    expect(calls.update[0]!.data).toEqual({ contentHash: hash("the body") });
    expect(calls.update[0]!.data.version).toBeUndefined();
  });

  it("still reports a REAL edit as updated when the stored digest is a legacy one", async () => {
    const calls = pushPrisma({ id: "s1", version: 5, contentHash: legacyHash("some older body") });
    const r = await pushOrgSkill("acme", input, { baseVersion: 5 });
    expect(r).toEqual({ status: "updated", id: "s1", version: 6 });
    expect(calls.update[0]!.data.version).toEqual({ increment: 1 });
  });

  it("treats a CRLF re-push of the same body as unchanged (the platform-clone case)", async () => {
    const calls = pushPrisma({ id: "s1", version: 3, contentHash: hash("line one\nline two") });
    const r = await pushOrgSkill("acme", { ...input, content: "line one\r\nline two" });
    expect(r).toEqual({ status: "unchanged", id: "s1", version: 3 });
    expect(calls.update).toHaveLength(0);
  });

  it("conflicts (no write) when baseVersion is stale", async () => {
    const calls = pushPrisma({ id: "s1", version: 5, contentHash: hash("old body") });
    const r = await pushOrgSkill("acme", input, { baseVersion: 4 });
    expect(r).toEqual({ status: "conflict", id: "s1", version: 5 });
    expect(calls.update).toHaveLength(0);
  });

  it("updates + bumps version when the body changed and baseVersion matches", async () => {
    const calls = pushPrisma({ id: "s1", version: 5, contentHash: hash("old body") });
    const r = await pushOrgSkill("acme", input, { baseVersion: 5 });
    expect(r).toEqual({ status: "updated", id: "s1", version: 6 });
    expect(calls.update[0]!.data.version).toEqual({ increment: 1 });
  });
});

type EventRow = {
  skillId: string;
  type: string;
  source: string | null;
  detail: string | null;
  sessionId: string | null;
  dedupeKey: string | null;
  createdAt: Date;
};

function eventsPrisma(ownedIds: string[], alreadyStored: string[] = []) {
  const captured = { events: [] as EventRow[], txns: 0 };
  const prisma = {
    orgSkill: {
      findMany: vi.fn(async () => ownedIds.map((id) => ({ id }))),
      update: vi.fn(async () => ({})),
    },
    orgSkillEvent: {
      // The pre-insert existence probe: what this org has already recorded under those dedupe keys.
      findMany: vi.fn(async (a: { where: { dedupeKey: { in: string[] } } }) =>
        a.where.dedupeKey.in.filter((k) => alreadyStored.includes(k)).map((dedupeKey) => ({ dedupeKey })),
      ),
      createMany: vi.fn(async (a: { data: EventRow[] }) => { captured.events = a.data; return { count: a.data.length }; }),
    },
    orgSkillDownload: { upsert: vi.fn(async () => ({})) },
    $transaction: vi.fn(async () => { captured.txns++; return []; }),
  };
  mockGetPrisma.mockReturnValue(prisma);
  return captured;
}

describe("recordSkillEvents", () => {
  it("drops events for skills not owned by the org (tenant boundary)", async () => {
    const cap = eventsPrisma(["s1"]);
    const r = await recordSkillEvents("acme", [
      { skillId: "s1", type: "download" },
      { skillId: "s_other", type: "download" }, // not owned → dropped
    ]);
    expect(r.recorded).toBe(1);
    expect(cap.events).toHaveLength(1);
  });

  it("bumps the use tally for a download but not for a passive sync", async () => {
    const cap = eventsPrisma(["s1", "s2"]);
    await recordSkillEvents("acme", [
      { skillId: "s1", type: "download" },
      { skillId: "s2", type: "sync" },
    ]);
    // Only s1 (a real use) triggers a counter transaction; s2's sync is logged but not counted.
    expect(cap.txns).toBe(1);
  });

  it("records an `invoke` and counts it as a real use", async () => {
    // FAIL-BEFORE: `invoke` was not in SkillEventType, so this event was filtered out entirely and
    // `recorded` was 0 with no counter transaction.
    const cap = eventsPrisma(["s1"]);
    const r = await recordSkillEvents("acme", [{ skillId: "s1", type: "invoke" }]);
    expect(r.recorded).toBe(1);
    expect(cap.events[0]!.type).toBe("invoke");
    expect(cap.txns).toBe(1);
  });

  it("normalizes the shipped CLI's `cli:<state>` source into source + detail", async () => {
    const cap = eventsPrisma(["s1"]);
    await recordSkillEvents("acme", [{ skillId: "s1", type: "sync", source: "cli:diverged" }]);
    expect(cap.events[0]!.source).toBe("cli");
    expect(cap.events[0]!.detail).toBe("diverged");
  });

  it("clamps a backdated `ts` to the 90-day floor instead of trusting a skewed clock", async () => {
    const cap = eventsPrisma(["s1"]);
    const twoYearsAgo = new Date(Date.now() - 730 * 86_400_000).toISOString();
    await recordSkillEvents("acme", [{ skillId: "s1", type: "invoke", ts: twoYearsAgo }]);
    const age = Date.now() - cap.events[0]!.createdAt.getTime();
    // Landed at the floor, not two years back — a clock-skewed client cannot bury a live skill.
    expect(age).toBeGreaterThan(89 * 86_400_000);
    expect(age).toBeLessThan(91 * 86_400_000);
  });

  it("clamps a forward-dated `ts` to now, so no skill can be pinned active forever", async () => {
    const cap = eventsPrisma(["s1"]);
    const nextYear = new Date(Date.now() + 365 * 86_400_000).toISOString();
    await recordSkillEvents("acme", [{ skillId: "s1", type: "invoke", ts: nextYear }]);
    expect(cap.events[0]!.createdAt.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  it("dedupes a repeated (session, skill, ts) inside one batch", async () => {
    const cap = eventsPrisma(["s1"]);
    const ts = new Date().toISOString();
    const r = await recordSkillEvents("acme", [
      { skillId: "s1", type: "invoke", session: "sess-1", ts },
      { skillId: "s1", type: "invoke", session: "sess-1", ts },
    ]);
    expect(r.recorded).toBe(1);
    expect(cap.events).toHaveLength(1);
    // The tally must follow the INSERT, not the submission, or a retry inflates "N uses".
    expect(cap.txns).toBe(1);
  });

  it("records nothing when the whole batch was already stored under those keys", async () => {
    const ts = new Date();
    const key = skillEventDedupeKey("sess-1", "s1", ts)!;
    const cap = eventsPrisma(["s1"], [key]);
    const r = await recordSkillEvents("acme", [
      { skillId: "s1", type: "invoke", session: "sess-1", ts: ts.toISOString() },
    ]);
    expect(r.recorded).toBe(0);
    expect(cap.events).toHaveLength(0);
    expect(cap.txns).toBe(0);
  });

  it("leaves an un-sessioned event unconstrained (today's at-least-once behaviour)", async () => {
    const cap = eventsPrisma(["s1"]);
    const ts = new Date().toISOString();
    const r = await recordSkillEvents("acme", [
      { skillId: "s1", type: "invoke", ts },
      { skillId: "s1", type: "invoke", ts },
    ]);
    expect(r.recorded).toBe(2);
    expect(cap.events.every((e) => e.dedupeKey === null)).toBe(true);
  });
});
