// The catalog write-back: WHEN ascent may commit `catalog.json` into a customer's registry, and what
// it does under each `catalogWrites` policy. The writer is a fake; the GitHub half has its own test.

import { describe, expect, it, vi } from "vitest";
import { buildCatalog, CATALOG_SCHEMA_VERSION, type RegistryCatalog } from "./catalog";
import {
  CATALOG_PR_BRANCH,
  catalogWriteSkip,
  sameCatalog,
  writeCatalogBack,
  type CatalogWriteInput,
  type CatalogWriter,
} from "./catalog-write";

const next = buildCatalog({
  fullName: "acme/ai-registry",
  defaultBranch: "main",
  canonical: true,
  mode: "git-native",
  telemetry: "off",
  skills: [{ name: "lint", version: "1.0.0", category: "ci-cd", path: "skills/lint/SKILL.md", contentHash: "sha256-n1:aa", invokes30d: 4 }],
  generatedAt: "2026-09-24T10:00:00.000Z",
  generatedBy: "ascent",
});

function writer(over: Partial<CatalogWriter> = {}): CatalogWriter & { [k: string]: ReturnType<typeof vi.fn> } {
  return {
    commit: vi.fn(async () => ({ commitSha: "c0ffee", blobSha: "b10b" })),
    readBranch: vi.fn(async () => null),
    propose: vi.fn(async () => ({ url: "https://github.com/acme/ai-registry/pull/7", number: 7, branch: CATALOG_PR_BRANCH, reused: false })),
    ...over,
  } as never;
}

function input(over: Partial<CatalogWriteInput> = {}): CatalogWriteInput {
  return {
    policy: "bot",
    spinePresent: true,
    truncated: false,
    readFailures: 0,
    prior: { state: "absent" },
    next,
    branch: "main",
    headSha: "4f1c9ae3d7b21c05f8a9",
    writer: writer(),
    ...over,
  };
}

describe("catalogWriteSkip — when a write-back must not happen", () => {
  it("needs a writer (a local checkout cannot commit)", () => {
    expect(catalogWriteSkip(input({ writer: undefined }))).toBe("no-writer");
  });
  it("needs the registry to have declared itself: defaults are not consent", () => {
    expect(catalogWriteSkip(input({ spinePresent: false }))).toBe("no-spine");
  });
  it("never writes from a truncated tree: the catalog would drop real entries", () => {
    expect(catalogWriteSkip(input({ truncated: true }))).toBe("truncated");
  });
  it("never writes when a blob read failed this pass", () => {
    expect(catalogWriteSkip(input({ readFailures: 1 }))).toBe("read-failures");
  });
  it("never overwrites a committed catalog it could not read", () => {
    expect(catalogWriteSkip(input({ prior: { state: "unreadable" } }))).toBe("prior-unreadable");
  });
  it("leaves a catalog another producer signed alone (the registry's own build-catalog.mjs --check)", () => {
    const prior = { ...next, generatedBy: "scripts/build-catalog.mjs" } as RegistryCatalog;
    expect(catalogWriteSkip(input({ prior: { state: "read", catalog: prior, blobSha: "b1" } }))).toBe("foreign-producer");
  });
  it("is idempotent: the same content with a new timestamp is not a change (the commit re-fires the push webhook)", () => {
    const prior = { ...next, generatedAt: "2026-01-01T00:00:00.000Z" } as RegistryCatalog;
    expect(catalogWriteSkip(input({ prior: { state: "read", catalog: prior, blobSha: "b1" } }))).toBe("unchanged");
  });
  it("guard: writes over ascent's own seed, an unsigned catalog, or no catalog at all", () => {
    const seed = buildCatalog({ fullName: "acme/ai-registry", defaultBranch: "main", canonical: true, mode: "git-native", telemetry: "off" });
    expect(catalogWriteSkip(input({ prior: { state: "read", catalog: seed, blobSha: "b1" } }))).toBeNull();
    expect(catalogWriteSkip(input({ prior: { state: "read", catalog: { schema: "ascent-registry-catalog" }, blobSha: "b1" } }))).toBeNull();
    expect(catalogWriteSkip(input())).toBeNull();
  });
});

describe("sameCatalog", () => {
  it("ignores key order, generatedAt and generatedBy, and nothing else", () => {
    const reordered = JSON.parse(JSON.stringify({ counts: next.counts, ...next, generatedAt: null })) as RegistryCatalog;
    expect(sameCatalog(reordered, next)).toBe(true);
    expect(sameCatalog({ ...next, counts: { ...next.counts, skills: 2 } }, next)).toBe(false);
  });
});

describe("writeCatalogBack — catalogWrites: bot", () => {
  it("commits the serialized envelope to the default branch against the blob it read", async () => {
    const w = writer();
    const prior = { schema: "ascent-registry-catalog" } as RegistryCatalog;
    const out = await writeCatalogBack(input({ writer: w, prior: { state: "read", catalog: prior, blobSha: "old-blob" } }));
    expect(out).toEqual({ kind: "committed", commitSha: "c0ffee", blobSha: "b10b" });
    const call = w.commit.mock.calls[0]![0] as { branch: string; content: string; priorBlobSha: string | null; message: string };
    expect(call.branch).toBe("main");
    expect(call.priorBlobSha).toBe("old-blob");
    expect(call.message).toContain("4f1c9ae");
    const written = JSON.parse(call.content) as RegistryCatalog;
    expect(written.schemaVersion).toBe(CATALOG_SCHEMA_VERSION);
    expect(written.skills[0]!.invokes30d).toBe(4);
    expect(call.content.endsWith("}\n")).toBe(true);
    expect(w.propose).not.toHaveBeenCalled();
  });

  it("creates the file when the registry has none", async () => {
    const w = writer();
    await writeCatalogBack(input({ writer: w }));
    expect((w.commit.mock.calls[0]![0] as { priorBlobSha: string | null }).priorBlobSha).toBeNull();
  });

  it("turns a rejected commit (a protected branch) into a failed outcome, never a throw", async () => {
    const w = writer({ commit: vi.fn(async () => Promise.reject(new Error("GitHub App API 409"))) });
    await expect(writeCatalogBack(input({ writer: w }))).resolves.toEqual({ kind: "failed", policy: "bot", message: "GitHub App API 409" });
  });

  it("does not touch GitHub when the decision is a skip", async () => {
    const w = writer();
    await expect(writeCatalogBack(input({ writer: w, truncated: true }))).resolves.toEqual({ kind: "skipped", reason: "truncated" });
    expect(w.commit).not.toHaveBeenCalled();
  });
});

describe("writeCatalogBack — catalogWrites: pr", () => {
  it("opens (or updates) the stable-branch PR and never commits to the default branch", async () => {
    const w = writer();
    const out = await writeCatalogBack(input({ policy: "pr", writer: w }));
    expect(out).toEqual({ kind: "proposed", url: "https://github.com/acme/ai-registry/pull/7", number: 7, branch: CATALOG_PR_BRANCH, reused: false });
    expect(w.commit).not.toHaveBeenCalled();
    const call = w.propose.mock.calls[0]![0] as { base: string; branch: string; content: string };
    expect(call.base).toBe("main");
    expect(call.branch).toBe(CATALOG_PR_BRANCH);
    expect((JSON.parse(call.content) as RegistryCatalog).schemaVersion).toBe(CATALOG_SCHEMA_VERSION);
  });

  it("leaves the PR alone when its branch already carries this content", async () => {
    const w = writer({ readBranch: vi.fn(async () => JSON.stringify({ ...next, generatedAt: "2026-09-01T00:00:00.000Z" })) });
    await expect(writeCatalogBack(input({ policy: "pr", writer: w }))).resolves.toEqual({ kind: "skipped", reason: "pr-current" });
    expect(w.readBranch).toHaveBeenCalledWith(CATALOG_PR_BRANCH);
    expect(w.propose).not.toHaveBeenCalled();
  });

  it("reports a failed PR as a failed outcome", async () => {
    const w = writer({ propose: vi.fn(async () => Promise.reject(new Error("GitHub App API 403"))) });
    await expect(writeCatalogBack(input({ policy: "pr", writer: w }))).resolves.toEqual({ kind: "failed", policy: "pr", message: "GitHub App API 403" });
  });
});
