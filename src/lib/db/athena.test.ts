// Athena's store — the four invariants that are policy rather than plumbing:
//   1. a thread names itself from the first user message (there is no setter to drift from it);
//   2. an unknown token count is written as NULL, never as 0;
//   3. NOTHING in the identity module can update a constitution row;
//   4. an episode lands in OrgMemory with the exact contract constants, and a failed write never
//      escapes to the caller.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockIsDbConfigured, mockGetPrisma } = vi.hoisted(() => ({
  mockIsDbConfigured: vi.fn(() => true),
  mockGetPrisma: vi.fn(),
}));
vi.mock("@/lib/db/client", () => ({ isDbConfigured: mockIsDbConfigured, getPrisma: mockGetPrisma }));

import * as identity from "@/lib/db/athena-identity";
import { appendAthenaTurn, deriveThreadTitle } from "@/lib/db/athena-threads";
import {
  ATHENA_MEMORY_KIND,
  ATHENA_MEMORY_NAMESPACE,
  ATHENA_MEMORY_SOURCE,
  writeAthenaEpisode,
} from "@/lib/db/athena-episodes";

beforeEach(() => {
  mockGetPrisma.mockReset();
  mockIsDbConfigured.mockReset();
  mockIsDbConfigured.mockReturnValue(true);
});

describe("deriveThreadTitle — the title is derived, never typed", () => {
  it("takes the first non-empty line and strips markdown chrome", () => {
    expect(deriveThreadTitle("## Why did the api score drop?")).toBe("Why did the api score drop?");
    expect(deriveThreadTitle("- check the `gate` policy")).toBe("check the gate policy");
    expect(deriveThreadTitle("\n\n  What changed last week?  \nmore text")).toBe("What changed last week?");
  });

  it("cuts a long opener on a word boundary and elides", () => {
    const long = "I would like to understand exactly why the maturity score for our primary API repository moved";
    const title = deriveThreadTitle(long);
    expect(title.endsWith("…")).toBe(true);
    expect(title.length).toBeLessThanOrEqual(73);
    expect(title.slice(0, -1).trim().split(" ").at(-1)).not.toBe("reposit"); // never mid-word
  });

  it("returns empty for an empty message rather than inventing a name", () => {
    expect(deriveThreadTitle("   \n  ")).toBe("");
  });
});

describe("appendAthenaTurn — unknown is not a value", () => {
  function turnPrisma(threadTitle = "") {
    const created: Record<string, unknown>[] = [];
    const threadUpdates: Record<string, unknown>[] = [];
    const tx = {
      athenaTurn: {
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          created.push(data);
          return {
            id: "turn_1",
            threadId: "th_1",
            role: data.role,
            content: data.content,
            metaJson: data.metaJson,
            inputTokens: data.inputTokens,
            outputTokens: data.outputTokens,
            legs: data.legs,
            createdAt: new Date("2026-08-25T00:00:00.000Z"),
          };
        }),
      },
      athenaThread: {
        update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
          threadUpdates.push(data);
          return { id: "th_1" };
        }),
      },
    };
    const prisma = {
      athenaThread: { findFirst: vi.fn(async () => ({ id: "th_1", title: threadTitle })) },
      $transaction: vi.fn(async (fn: (t: typeof tx) => unknown) => fn(tx)),
    };
    return { prisma, created, threadUpdates };
  }

  it("writes null — NOT 0 — when the provider reported no usage", async () => {
    const { prisma, created } = turnPrisma("already titled");
    mockGetPrisma.mockReturnValue(prisma);

    const turn = await appendAthenaTurn({ orgId: "org_1", threadId: "th_1", role: "assistant", content: "hi" });

    expect(created[0]!.inputTokens).toBeNull();
    expect(created[0]!.outputTokens).toBeNull();
    expect(created[0]!.legs).toBeNull();
    expect(turn?.inputTokens).toBeNull();
  });

  it("keeps a real measurement, including a legitimate zero it was actually told", async () => {
    const { prisma, created } = turnPrisma("already titled");
    mockGetPrisma.mockReturnValue(prisma);

    await appendAthenaTurn({
      orgId: "org_1",
      threadId: "th_1",
      role: "assistant",
      content: "hi",
      inputTokens: 1200,
      outputTokens: 0,
      legs: 3,
    });

    expect(created[0]!.inputTokens).toBe(1200);
    expect(created[0]!.outputTokens).toBe(0); // a REPORTED zero is a measurement; only absence is null
    expect(created[0]!.legs).toBe(3);
  });

  it("names an untitled thread from the first USER turn, and never from an assistant one", async () => {
    const first = turnPrisma("");
    mockGetPrisma.mockReturnValue(first.prisma);
    await appendAthenaTurn({ orgId: "org_1", threadId: "th_1", role: "user", content: "Why did D9 drop?" });
    expect(first.threadUpdates[0]).toEqual({ title: "Why did D9 drop?" });

    const assistantFirst = turnPrisma("");
    mockGetPrisma.mockReturnValue(assistantFirst.prisma);
    await appendAthenaTurn({ orgId: "org_1", threadId: "th_1", role: "assistant", content: "Because…" });
    // Still bumps updatedAt (the rail orders on it), but writes no title.
    expect(assistantFirst.threadUpdates[0]).toEqual({});
  });

  it("returns null for a thread that belongs to another tenant", async () => {
    mockGetPrisma.mockReturnValue({ athenaThread: { findFirst: vi.fn(async () => null) } });
    expect(
      await appendAthenaTurn({ orgId: "org_1", threadId: "someone_elses", role: "user", content: "x" }),
    ).toBeNull();
  });
});

describe("the constitution is write-locked BY CONSTRUCTION", () => {
  it("exports no function whose name suggests it could write a constitution", () => {
    const writers = Object.keys(identity).filter((k) => /^(update|set|write|patch|edit|replace)/i.test(k));
    // `updateSelfModel` is the ONLY mutating export, and its tier is hardcoded (asserted below).
    expect(writers).toEqual(["updateSelfModel"]);
  });

  it('never passes "constitution" to an update anywhere in the module source', () => {
    const src = readFileSync(join(process.cwd(), "src", "lib", "db", "athena-identity.ts"), "utf8");
    // The only `.update(` call in the file, and the tier in its where-clause is a literal.
    const updates = [...src.matchAll(/athenaIdentity\.update\(/g)];
    expect(updates).toHaveLength(1);
    expect(src).toContain('where: { orgId_tier: { orgId, tier: "self_model" } },\n    data: {');
    // No updateMany / upsert back door either — an upsert would be an update in disguise.
    expect(src).not.toMatch(/athenaIdentity\.(updateMany|upsert)\(/);
  });

  it("seeding is CREATE-only: an existing row is returned untouched, never overwritten", async () => {
    const existing = {
      id: "i1",
      orgId: "org_1",
      tier: "constitution",
      content: "the original",
      version: 1,
      updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedBy: null,
    };
    const prisma = {
      athenaIdentity: {
        findUnique: vi.fn(async () => existing),
        create: vi.fn(),
        update: vi.fn(),
      },
    };
    mockGetPrisma.mockReturnValue(prisma);

    const seeded = await identity.seedAthenaIdentity("org_1", "constitution", "AN OVERWRITE ATTEMPT");

    expect(seeded?.content).toBe("the original");
    expect(prisma.athenaIdentity.create).not.toHaveBeenCalled();
    expect(prisma.athenaIdentity.update).not.toHaveBeenCalled();
  });

  it("a refused diff writes nothing and returns the typed refusal", async () => {
    const prisma = {
      athenaIdentity: {
        findUnique: vi.fn(async () => ({
          id: "i2",
          orgId: "org_1",
          tier: "self_model",
          content: "## Notes\n- a fact\n",
          version: 4,
          updatedAt: new Date(),
          updatedBy: null,
        })),
        update: vi.fn(),
      },
    };
    mockGetPrisma.mockReturnValue(prisma);

    const result = await identity.updateSelfModel(
      "org_1",
      [{ op: "replace", section: "Notes", anchor: "- a fact that moved", line: "- new" }],
      "someone",
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("anchor-not-found");
    expect(prisma.athenaIdentity.update).not.toHaveBeenCalled();
  });
});

describe("writeAthenaEpisode — the OrgMemory contract", () => {
  it("writes with exactly the contract constants", async () => {
    const create = vi.fn(async () => ({ id: "mem_1" }));
    mockGetPrisma.mockReturnValue({ orgMemory: { create } });

    await writeAthenaEpisode({ orgId: "org_1", content: "  She noticed the api repo regressed.  ", tags: ["th_1"] });

    const data = create.mock.calls[0]![0].data as Record<string, unknown>;
    expect(data.namespace).toBe(ATHENA_MEMORY_NAMESPACE);
    expect(data.kind).toBe(ATHENA_MEMORY_KIND);
    expect(data.source).toBe(ATHENA_MEMORY_SOURCE);
    expect(data.visibility).toBe("shared");
    expect(data.createdBy).toBeNull();
    expect(data.content).toBe("She noticed the api repo regressed.");
    expect(data.tags).toBe(JSON.stringify(["th_1"]));
    // The literal values are the contract the erase sweep matches on — pin them, not just the consts.
    expect([ATHENA_MEMORY_NAMESPACE, ATHENA_MEMORY_KIND, ATHENA_MEMORY_SOURCE]).toEqual([
      "athena",
      "episodic",
      "athena",
    ]);
  });

  it("NEVER throws — a memory failure must not fail the turn that produced it", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    mockGetPrisma.mockReturnValue({
      orgMemory: {
        create: vi.fn(async () => {
          throw new Error("store is down");
        }),
      },
    });

    await expect(writeAthenaEpisode({ orgId: "org_1", content: "something worth remembering" })).resolves.toBeNull();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("writes nothing for a blank body or an absent database", async () => {
    const create = vi.fn();
    mockGetPrisma.mockReturnValue({ orgMemory: { create } });
    expect(await writeAthenaEpisode({ orgId: "org_1", content: "   " })).toBeNull();

    mockIsDbConfigured.mockReturnValue(false);
    expect(await writeAthenaEpisode({ orgId: "org_1", content: "real content" })).toBeNull();
    expect(create).not.toHaveBeenCalled();
  });
});
