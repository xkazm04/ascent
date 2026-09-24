// The index pass writes `catalog.json` back (backlog develop-2026-09-17 row 23). Before this, the
// pass built the catalog it "would commit" and nothing committed it, so a scaffolded registry kept
// its empty seed forever and fleet sync had no current key to hash against.
//
// Same harness as index-registry.test.ts: the DB writers are mocked at the module boundary, the
// catalog writer is a fake injected through the source (exactly where `githubSource` puts the real one).

import { beforeEach, describe, expect, it, vi } from "vitest";

const recordResult = vi.fn(async () => {});
vi.mock("@/lib/db/org-registry-mirror", () => ({
  upsertRegistrySkill: vi.fn(async () => "skill-id"),
  upsertRegistryPractice: vi.fn(async () => "practice-id"),
  upsertRegistryMemory: vi.fn(async () => "memory-id"),
}));
vi.mock("@/lib/db/org-registry-write", () => ({
  archiveVanishedRegistryRows: vi.fn(async () => ({ skills: 0, practices: 0, memory: 0 })),
  recordIndexResult: (...a: unknown[]) => recordResult(...(a as [])),
  recordIndexError: vi.fn(async () => {}),
}));
vi.mock("@/lib/db/org-skill-lessons", () => ({
  replaceSkillLessons: vi.fn(async () => ({ written: 0, removed: 0 })),
  purgeSkillLessons: vi.fn(async () => 0),
}));
vi.mock("./conformance-sweep", () => ({ sweepConformance: vi.fn() }));

import { indexRegistry, type RegistrySource } from "./index-registry";
import { CATALOG_SCHEMA_VERSION, type RegistryCatalog } from "./catalog";
import type { CatalogWriter } from "./catalog-write";
import { FIXTURE_REGISTRY_YAML, FIXTURE_TREE, type FixtureBlob } from "./__fixtures__/registry-tree";
import type { OrgRegistryRow } from "@/lib/db/org-registry";

const REGISTRY = { id: "reg-1", orgId: "org-1", fullName: "xkazm04/ai-registry", defaultBranch: "main" } as unknown as OrgRegistryRow;

function fakeWriter() {
  return {
    commit: vi.fn<CatalogWriter["commit"]>(async () => ({ commitSha: "c0ffee", blobSha: "fresh-blob" })),
    readBranch: vi.fn(async () => null),
    propose: vi.fn(async () => ({ url: "https://github.com/x/pull/1", number: 1, branch: "ascent/registry-catalog", reused: false })),
  } satisfies CatalogWriter;
}

/** A source over an in-memory tree; `sha` is the path. `failing` paths throw on read. */
function sourceFor(blobs: FixtureBlob[], writer?: CatalogWriter, opts: { truncated?: boolean; failing?: string[] } = {}): RegistrySource {
  const bodies = new Map(blobs.map((b) => [b.path, b.body]));
  return {
    readTree: async () => ({
      headSha: "4f1c9ae3d7b21c05f8a9",
      truncated: Boolean(opts.truncated),
      entries: blobs.map((b) => ({ path: b.path, type: "blob" as const, size: Buffer.byteLength(b.body), sha: b.path })),
    }),
    readBlob: async (entry) => {
      if (opts.failing?.includes(entry.path)) throw new Error("GitHub App API 502");
      return bodies.get(entry.sha) ?? null;
    },
    ...(writer ? { catalogWriter: writer } : {}),
  };
}

const withFile = (path: string, body: string) => [...FIXTURE_TREE.filter((b) => b.path !== path), { path, body }];
const stamped = () => recordResult.mock.calls.at(-1)![1] as unknown as { catalogSha: string | null };

beforeEach(() => recordResult.mockClear());

describe("index pass -> catalog.json write-back", () => {
  it("catalogWrites: bot commits the envelope against the blob it read and records the written sha", async () => {
    const w = fakeWriter();
    const result = await indexRegistry(REGISTRY, sourceFor(FIXTURE_TREE, w));
    expect(result.catalogWrite).toEqual({ kind: "committed", commitSha: "c0ffee", blobSha: "fresh-blob" });
    const call = w.commit.mock.calls[0]![0];
    expect(call.priorBlobSha).toBe("catalog.json");
    const head = JSON.parse(call.content) as RegistryCatalog;
    expect(head.schemaVersion).toBe(CATALOG_SCHEMA_VERSION);
    expect(head.skills.length).toBeGreaterThan(0);
    for (const s of head.skills) expect(typeof s.invokes30d).toBe("number");
    expect(stamped().catalogSha).toBe("fresh-blob");
    expect(w.propose).not.toHaveBeenCalled();
  });

  it("is idempotent: a pass over the catalog it just committed writes nothing (no push-webhook loop)", async () => {
    const first = fakeWriter();
    await indexRegistry(REGISTRY, sourceFor(FIXTURE_TREE, first));
    const committed = first.commit.mock.calls[0]![0].content;
    const again = fakeWriter();
    const result = await indexRegistry(REGISTRY, sourceFor(withFile("catalog.json", committed), again));
    expect(result.catalogWrite).toEqual({ kind: "skipped", reason: "unchanged" });
    expect(again.commit).not.toHaveBeenCalled();
    expect(stamped().catalogSha).toBe("catalog.json");
  });

  it("catalogWrites: pr opens the PR and leaves the default branch alone", async () => {
    const w = fakeWriter();
    const spine = FIXTURE_REGISTRY_YAML.replace("catalogWrites: bot", "catalogWrites: pr");
    const result = await indexRegistry(REGISTRY, sourceFor(withFile(".ascent/registry.yaml", spine), w));
    expect(result.catalogWrite).toMatchObject({ kind: "proposed", number: 1 });
    expect(w.commit).not.toHaveBeenCalled();
    expect(stamped().catalogSha).toBe("catalog.json");
  });

  it("leaves a catalog signed by another producer alone", async () => {
    const w = fakeWriter();
    const signed = JSON.stringify({ schema: "ascent-registry-catalog", generatedBy: "scripts/build-catalog.mjs", skills: [] });
    const result = await indexRegistry(REGISTRY, sourceFor(withFile("catalog.json", signed), w));
    expect(result.catalogWrite).toEqual({ kind: "skipped", reason: "foreign-producer" });
    expect(w.commit).not.toHaveBeenCalled();
  });

  it("does not write from a truncated tree, a registry with no spine, or a pass with a failed read", async () => {
    const w = fakeWriter();
    expect((await indexRegistry(REGISTRY, sourceFor(FIXTURE_TREE, w, { truncated: true }))).catalogWrite).toEqual({ kind: "skipped", reason: "truncated" });
    const noSpine = FIXTURE_TREE.filter((b) => b.path !== ".ascent/registry.yaml");
    expect((await indexRegistry(REGISTRY, sourceFor(noSpine, w))).catalogWrite).toEqual({ kind: "skipped", reason: "no-spine" });
    const skill = FIXTURE_TREE.find((b) => b.path.endsWith("/SKILL.md"))!.path;
    expect((await indexRegistry(REGISTRY, sourceFor(FIXTURE_TREE, w, { failing: [skill] }))).catalogWrite).toEqual({ kind: "skipped", reason: "read-failures" });
    expect((await indexRegistry(REGISTRY, sourceFor(FIXTURE_TREE, w, { failing: ["catalog.json"] }))).catalogWrite).toMatchObject({ kind: "skipped" });
    expect(w.commit).not.toHaveBeenCalled();
  });

  it("guard: a source without a writer (fixtures, a local checkout) indexes and writes nothing", async () => {
    const result = await indexRegistry(REGISTRY, sourceFor(FIXTURE_TREE));
    expect(result.kind).toBe("ok");
    expect(result.catalogWrite).toEqual({ kind: "skipped", reason: "no-writer" });
  });

  it("a rejected write is a warning on a successful pass, never an index failure", async () => {
    const w = fakeWriter();
    w.commit.mockRejectedValueOnce(new Error("GitHub App API 409"));
    const result = await indexRegistry(REGISTRY, sourceFor(FIXTURE_TREE, w));
    expect(result.kind).toBe("ok");
    expect(result.warnings).toContain("catalog.json: not written back (GitHub App API 409)");
    expect(stamped().catalogSha).toBe("catalog.json");
  });
});
