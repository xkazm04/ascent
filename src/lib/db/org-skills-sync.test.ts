// Unit tests for the Feature 2 sync additions (mocked Prisma, mirroring org-skills.test.ts):
//   - pushOrgSkill: create when absent; idempotent `unchanged` on an identical body; `conflict` when the
//     supplied baseVersion is stale (no write); `updated` (version bumped) on a real change;
//   - recordSkillEvents: forged/other-org skillIds are dropped (tenant boundary), and only a real use
//     (`download`) bumps the rolling tally + downloadCount — a passive `sync` does not. (`invoke` was
//     retired 2026-07-29: it had no producer, so it could never mark anything active.)

import { describe, it, expect, vi } from "vitest";
import { createHash } from "node:crypto";

const { mockGetPrisma } = vi.hoisted(() => ({ mockGetPrisma: vi.fn() }));
vi.mock("@/lib/db/client", () => ({ getPrisma: mockGetPrisma, isDbConfigured: () => true }));
vi.mock("@/lib/db/org-rollup", () => ({ getOrgId: async (slug: string) => (slug === "acme" ? "org_acme" : null) }));

import { pushOrgSkill, recordSkillEvents } from "@/lib/db/org-skills";

const hash = (s: string) => createHash("sha256").update(s).digest("hex");

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

function eventsPrisma(ownedIds: string[]) {
  const captured = { events: [] as unknown[], txns: 0 };
  const prisma = {
    orgSkill: {
      findMany: vi.fn(async () => ownedIds.map((id) => ({ id }))),
      update: vi.fn(async () => ({})),
    },
    orgSkillEvent: { createMany: vi.fn(async (a: { data: unknown[] }) => { captured.events = a.data; return { count: a.data.length }; }) },
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
});
