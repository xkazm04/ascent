// The indexer against a checked-in fixture tree mirroring github.com/xkazm04/ai-registry.
//
// What is defended: the indexer runs over content ascent does not control, so the invariant is that a
// bad file costs you THAT FILE. Every case below is one the reference registry does not have and a
// real customer eventually will. The DB is mocked at the module boundary (the two writer modules),
// never the parsers — parse behavior is the thing under test.

import { beforeEach, describe, expect, it, vi } from "vitest";

const upsertSkill = vi.fn(async () => "skill-id");
const upsertPractice = vi.fn(async () => "practice-id");
const upsertMemory = vi.fn(async () => "memory-id");
const archive = vi.fn(async () => ({ skills: 0, practices: 0, memory: 0 }));
const recordResult = vi.fn(async () => {});
const recordError = vi.fn(async () => {});

vi.mock("@/lib/db/org-registry-mirror", () => ({
  upsertRegistrySkill: (...a: unknown[]) => upsertSkill(...(a as [])),
  upsertRegistryPractice: (...a: unknown[]) => upsertPractice(...(a as [])),
  upsertRegistryMemory: (...a: unknown[]) => upsertMemory(...(a as [])),
}));
vi.mock("@/lib/db/org-registry-write", () => ({
  archiveVanishedRegistryRows: (...a: unknown[]) => archive(...(a as [])),
  recordIndexResult: (...a: unknown[]) => recordResult(...(a as [])),
  recordIndexError: (...a: unknown[]) => recordError(...(a as [])),
}));

import { indexRegistry, type RegistrySource } from "./index-registry";
import { FIXTURE_TREE, type FixtureBlob } from "./__fixtures__/registry-tree";
import type { OrgRegistryRow } from "@/lib/db/org-registry";

const REGISTRY = { id: "reg-1", orgId: "org-1", fullName: "xkazm04/ai-registry", defaultBranch: "main" } as unknown as OrgRegistryRow;

/** A source over an in-memory tree. `sha` is the path, so a read is a map lookup. */
function sourceFor(blobs: FixtureBlob[], opts: { truncated?: boolean } = {}): RegistrySource {
  const bodies = new Map(blobs.map((b) => [b.path, b.body]));
  return {
    readTree: async () => ({
      headSha: "4f1c9ae3d7b21c05f8a9",
      truncated: Boolean(opts.truncated),
      entries: blobs.map((b) => ({
        path: b.path,
        type: "blob" as const,
        size: b.size ?? Buffer.byteLength(b.body),
        sha: b.path,
      })),
    }),
    readBlob: async (entry) => bodies.get(entry.sha) ?? null,
  };
}

const names = (m: typeof upsertSkill) => m.mock.calls.map((c) => (c[2] as { path: string }).path);

beforeEach(() => {
  for (const m of [upsertSkill, upsertPractice, upsertMemory, archive, recordResult, recordError]) m.mockClear();
});

describe("indexRegistry over the reference layout", () => {
  it("indexes every well-formed artifact and reports the counts", async () => {
    const result = await indexRegistry(REGISTRY, sourceFor(FIXTURE_TREE));
    expect(result.kind).toBe("ok");
    expect(result.headSha).toBe("4f1c9ae3d7b21c05f8a9");
    // 3 real skills + no-frontmatter + broken-but-readable = 5; empty-skill is skipped.
    expect(result.counts).toEqual({ skills: 5, practices: 2, memory: 4, lessons: 3 });
  });

  it("reads `version` from frontmatter — the drift key the catalog compares on", async () => {
    await indexRegistry(REGISTRY, sourceFor(FIXTURE_TREE));
    const drift = upsertSkill.mock.calls.find((c) => (c[2] as { name: string }).name === "agent-guidance-bootstrap")![2] as unknown as { version: string | null; category: string };
    expect(drift.version).toBe("0.4.0");
    expect(drift.category).toBe("ai-native");
  });

  it("counts LESSONS.md entries and links them from the catalog", async () => {
    const result = await indexRegistry(REGISTRY, sourceFor(FIXTURE_TREE));
    const entry = result.catalog!.skills.find((s) => s.name === "test-before-commit")!;
    expect(entry.lessons).toBe(3);
    expect(entry.lessonsPath).toBe("skills/test-before-commit/LESSONS.md");
    expect(entry.contentHash).toMatch(/^sha256-n1:[0-9a-f]{16}$/);
  });

  it("indexes a skill with NO frontmatter under its directory name, with a warning", async () => {
    const result = await indexRegistry(REGISTRY, sourceFor(FIXTURE_TREE));
    expect(names(upsertSkill)).toContain("skills/no-frontmatter-skill/SKILL.md");
    expect(result.warnings!.some((w) => w.includes("no-frontmatter-skill") && w.includes("no frontmatter"))).toBe(true);
  });

  it("SKIPS an empty document and a body-less note, warning for each, without failing the pass", async () => {
    const result = await indexRegistry(REGISTRY, sourceFor(FIXTURE_TREE));
    expect(names(upsertSkill)).not.toContain("skills/empty-skill/SKILL.md");
    expect(names(upsertMemory)).not.toContain("memory/semantic/empty-note.md");
    expect(result.warnings!.some((w) => w.startsWith("skills/empty-skill/SKILL.md"))).toBe(true);
    expect(result.warnings!.some((w) => w.startsWith("memory/semantic/empty-note.md"))).toBe(true);
    expect(result.kind).toBe("ok");
  });

  it("ignores the generated memory/_index.md and practice starter files", async () => {
    await indexRegistry(REGISTRY, sourceFor(FIXTURE_TREE));
    expect(names(upsertMemory)).not.toContain("memory/_index.md");
    expect(names(upsertPractice)).toEqual(["practices/agent-guidance/PRACTICE.md", "practices/supply-chain-security/PRACTICE.md"]);
  });

  it("attaches each practice's starter/** paths to its catalog entry", async () => {
    const result = await indexRegistry(REGISTRY, sourceFor(FIXTURE_TREE));
    const supply = result.catalog!.practices.find((p) => p.id === "supply-chain-security")!;
    expect(supply.dimension).toBe("D9");
    expect(supply.starter.sort()).toEqual([
      "practices/supply-chain-security/starter/.github/workflows/supply-chain.yml",
      "practices/supply-chain-security/starter/SECURITY.md",
    ]);
  });

  it("maps memory kinds and confidence from frontmatter", async () => {
    await indexRegistry(REGISTRY, sourceFor(FIXTURE_TREE));
    const summary = upsertMemory.mock.calls.find((c) => (c[2] as { path: string }).path.includes("2026-h1"))![2] as unknown as { kind: string; confidence: number };
    expect(summary).toMatchObject({ kind: "summary", confidence: 0.6 });
  });

  it("SOFT-ARCHIVES a vanished path — the pass reports only what the tree still carries", async () => {
    const shrunk = FIXTURE_TREE.filter((b) => b.path !== "skills/ci-gate-check/SKILL.md");
    await indexRegistry(REGISTRY, sourceFor(shrunk));
    const [registryId, seen] = archive.mock.calls[0] as unknown as [string, { skills: string[] }];
    expect(registryId).toBe("reg-1");
    expect(seen.skills).not.toContain("skills/ci-gate-check/SKILL.md");
    expect(seen.skills).toContain("skills/test-before-commit/SKILL.md");
  });

  it("reads mode/telemetry/policies from .ascent/registry.yaml", async () => {
    const result = await indexRegistry(REGISTRY, sourceFor(FIXTURE_TREE));
    expect(result.declaration!.telemetry).toBe("api");
    expect(result.catalog!.registry.mode).toBe("git-native");
  });

  it("warns (not fails) when the spine is missing", async () => {
    const noSpine = FIXTURE_TREE.filter((b) => b.path !== ".ascent/registry.yaml");
    const result = await indexRegistry(REGISTRY, sourceFor(noSpine));
    expect(result.kind).toBe("ok");
    expect(result.warnings!.some((w) => w.includes(".ascent/registry.yaml is missing"))).toBe(true);
  });

  it("skips an oversized blob rather than fetching it", async () => {
    const huge = FIXTURE_TREE.map((b) => (b.path === "skills/ci-gate-check/SKILL.md" ? { ...b, size: 10_000_000 } : b));
    const result = await indexRegistry(REGISTRY, sourceFor(huge));
    expect(names(upsertSkill)).not.toContain("skills/ci-gate-check/SKILL.md");
    expect(result.warnings!.some((w) => w.includes("exceeds the") && w.includes("cap"))).toBe(true);
  });

  it("says so when GitHub truncated the tree", async () => {
    const result = await indexRegistry(REGISTRY, sourceFor(FIXTURE_TREE, { truncated: true }));
    expect(result.warnings!.some((w) => w.includes("truncated"))).toBe(true);
  });
});

describe("indexRegistry failure modes", () => {
  it("returns a typed error (never throws) when the tree cannot be read, and records it", async () => {
    const source: RegistrySource = {
      readTree: async () => {
        throw new Error("GitHub App API 404 on /repos/x/y");
      },
      readBlob: async () => null,
    };
    const result = await indexRegistry(REGISTRY, source);
    expect(result.kind).toBe("error");
    expect(result.message).toContain("404");
    expect(recordError).toHaveBeenCalledWith("reg-1", expect.stringContaining("404"));
    expect(recordResult).not.toHaveBeenCalled();
  });

  it("keeps going when ONE mirror write throws — the file is warned about, not erased from the ledger", async () => {
    upsertSkill.mockImplementationOnce(async () => {
      throw new Error("P2002 unique constraint");
    });
    const result = await indexRegistry(REGISTRY, sourceFor(FIXTURE_TREE));
    expect(result.kind).toBe("ok");
    // The counts describe the REGISTRY, not our database: the skill is still in the repo.
    expect(result.counts!.skills).toBe(5);
    expect(result.warnings!.some((w) => w.includes("P2002") && w.includes("mirror row not written"))).toBe(true);
  });

  it("says so ONCE (not per file) when persistence is off and nothing was mirrored", async () => {
    for (const m of [upsertSkill, upsertPractice, upsertMemory]) m.mockResolvedValue(null as never);
    const result = await indexRegistry(REGISTRY, sourceFor(FIXTURE_TREE));
    expect(result.counts).toEqual({ skills: 5, practices: 2, memory: 4, lessons: 3 });
    const aggregate = result.warnings!.filter((w) => w.includes("persistence is off"));
    expect(aggregate).toHaveLength(1);
    expect(aggregate[0]).toContain("11 artifacts");
    for (const m of [upsertSkill, upsertPractice, upsertMemory]) m.mockResolvedValue("id" as never);
  });

  it("stamps the successful pass with head sha, counts and warnings", async () => {
    await indexRegistry(REGISTRY, sourceFor(FIXTURE_TREE));
    expect(recordResult).toHaveBeenCalledTimes(1);
    const [id, payload] = recordResult.mock.calls[0] as unknown as [string, { headSha: string; counts: unknown }];
    expect(id).toBe("reg-1");
    expect(payload.headSha).toBe("4f1c9ae3d7b21c05f8a9");
    expect(payload.counts).toEqual({ skills: 5, practices: 2, memory: 4, lessons: 3 });
  });
});
