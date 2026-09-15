// The `.ai/memory` mirror's five gates, its idempotency, its supersede path and its honesty about
// confidence (moonshot #14). FAILS BEFORE: the module did not exist.
//
// The data layer is mocked at the MODULE boundary rather than at prisma, on purpose: what is under
// test here is the ORCHESTRATION — which gate refuses, what feeds OrgMemory and what merely bumps a
// ledger row. `db/repo-memory.ts`'s own queries are exercised by the schema, not by re-implementing
// prisma in a fixture.

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  resolveMirrorTarget: vi.fn(),
  upsertMirrorEntries: vi.fn(),
  linkMirroredMemory: vi.fn(),
  markSuperseded: vi.fn(),
  countMirrored: vi.fn(),
  getCreditState: vi.fn(),
  workspaceAllowsMemory: vi.fn(),
  archiveOrgMemory: vi.fn(),
  writeMemoryCandidate: vi.fn(),
  selfHosted: vi.fn(() => false),
}));

vi.mock("@/lib/db/repo-memory", () => ({
  resolveMirrorTarget: h.resolveMirrorTarget,
  upsertMirrorEntries: h.upsertMirrorEntries,
  linkMirroredMemory: h.linkMirroredMemory,
  markSuperseded: h.markSuperseded,
  countMirrored: h.countMirrored,
}));
vi.mock("@/lib/db/credits", () => ({ getCreditState: h.getCreditState }));
vi.mock("@/lib/db/personal", () => ({ workspaceAllowsMemory: h.workspaceAllowsMemory }));
vi.mock("@/lib/db/org-memory", () => ({ archiveOrgMemory: h.archiveOrgMemory }));
vi.mock("@/lib/memory/scan-feed", () => ({ writeMemoryCandidate: h.writeMemoryCandidate }));
vi.mock("@/lib/env", () => ({ selfHosted: h.selfHosted }));

import {
  MAX_ENTRIES_PER_SCAN,
  MAX_LIVE_PER_REPO,
  REPO_MEMORY_CONFIDENCE,
  memoryBody,
  mirrorRepoMemory,
} from "@/lib/memory/repo-memory-mirror";
import { REPO_MEMORY_SOURCE } from "@/lib/org/memory-kinds";
import { parseRepoMemoryEntry } from "@/lib/standard/memory-read";

const REPO = "acme/api";
const doc = (id: string, kind = "decision", body = `entry ${id}`, supersedes = "null") =>
  `---\nid: ${id}\nkind: ${kind}\nscope: repo\ndate: 2026-06-10\nsupersedes: ${supersedes}\nrefs: []\n---\n\n${body}\n`;

const file = (n: string, content: string) => ({ path: `.ai/memory/${n}.md`, content });

const TARGET = { orgId: "org_1", orgSlug: "acme", mirrorFlag: null, liveCount: 0 };

/** The default happy-path wiring: everything allowed, every upsert brand new, every ingest accepted. */
function allow() {
  h.resolveMirrorTarget.mockResolvedValue(TARGET);
  h.getCreditState.mockResolvedValue({ plan: "team" });
  h.workspaceAllowsMemory.mockResolvedValue(true);
  h.markSuperseded.mockResolvedValue([]);
  h.upsertMirrorEntries.mockImplementation(
    async (_orgId: string, _repo: string, entries: { path: string; contentHash: string; entryId: string | null; mappedKind: string; body: string; supersedes: string | null }[]) =>
      entries.map((e, i) => ({
        id: `row_${i}`,
        path: e.path,
        contentHash: e.contentHash,
        entryId: e.entryId,
        mappedKind: e.mappedKind,
        body: e.body,
        supersedes: e.supersedes,
        isNew: true,
      })),
  );
  let n = 0;
  h.writeMemoryCandidate.mockImplementation(async () => ({ id: `mem_${n++}` }));
}

beforeEach(() => {
  vi.clearAllMocks();
  h.selfHosted.mockReturnValue(false);
  allow();
});

describe("the five gates — each fails CLOSED", () => {
  it("gate 1: no org (an anonymous / public-funnel scan) mirrors nothing", async () => {
    expect(await mirrorRepoMemory({ repoFullName: REPO, memoryFiles: [file("0001-a", doc("0001"))] })).toBeNull();
    expect(await mirrorRepoMemory({ orgSlug: "  ", repoFullName: REPO, memoryFiles: [file("0001-a", doc("0001"))] })).toBeNull();
    expect(h.resolveMirrorTarget).not.toHaveBeenCalled();
  });

  it('gate 1: the "public" pseudo-org is not an org', async () => {
    const r = await mirrorRepoMemory({ orgSlug: "public", repoFullName: REPO, memoryFiles: [file("0001-a", doc("0001"))] });
    expect(r).toBeNull();
    expect(h.resolveMirrorTarget).not.toHaveBeenCalled();
  });

  it("gate 2: a repo the org does not own is not ingested", async () => {
    h.resolveMirrorTarget.mockResolvedValue(null);
    const r = await mirrorRepoMemory({ orgSlug: "acme", repoFullName: "someone-else/oss", memoryFiles: [file("0001-a", doc("0001"))] });
    expect(r).toBeNull();
    expect(h.writeMemoryCandidate).not.toHaveBeenCalled();
  });

  it("gate 3: an org that opted out mirrors nothing; null (never chosen) is ON", async () => {
    h.resolveMirrorTarget.mockResolvedValue({ ...TARGET, mirrorFlag: false });
    expect(await mirrorRepoMemory({ orgSlug: "acme", repoFullName: REPO, memoryFiles: [file("0001-a", doc("0001"))] })).toBeNull();

    h.resolveMirrorTarget.mockResolvedValue({ ...TARGET, mirrorFlag: null });
    const on = await mirrorRepoMemory({ orgSlug: "acme", repoFullName: REPO, memoryFiles: [file("0001-a", doc("0001"))] });
    expect(on?.mirrored).toBe(1);
  });

  it("gate 4: the same plan gate the memory WRITE route uses", async () => {
    h.workspaceAllowsMemory.mockResolvedValue(false);
    const r = await mirrorRepoMemory({ orgSlug: "acme", repoFullName: REPO, memoryFiles: [file("0001-a", doc("0001"))] });
    expect(r).toBeNull();
    expect(h.writeMemoryCandidate).not.toHaveBeenCalled();
  });

  it("gate 5: entries past the per-scan cap are not mirrored", async () => {
    const files = Array.from({ length: MAX_ENTRIES_PER_SCAN + 5 }, (_, i) =>
      file(`${String(i + 1).padStart(4, "0")}-e`, doc(String(i + 1).padStart(4, "0"))),
    );
    const r = await mirrorRepoMemory({ orgSlug: "acme", repoFullName: REPO, memoryFiles: files });
    expect(h.writeMemoryCandidate).toHaveBeenCalledTimes(MAX_ENTRIES_PER_SCAN);
    expect(r?.mirrored).toBe(MAX_ENTRIES_PER_SCAN);
  });

  it("gate 5: past the per-REPO cap the overflow is LEDGERED as capped, never dropped", async () => {
    h.resolveMirrorTarget.mockResolvedValue({ ...TARGET, liveCount: MAX_LIVE_PER_REPO });
    const r = await mirrorRepoMemory({ orgSlug: "acme", repoFullName: REPO, memoryFiles: [file("0001-a", doc("0001"))] });
    // No OrgMemory row...
    expect(h.writeMemoryCandidate).not.toHaveBeenCalled();
    expect(r?.mirrored).toBe(0);
    expect(r?.skipped).toBe(1);
    // ...but the entry IS in the ledger, with the reason.
    const [, , entries] = h.upsertMirrorEntries.mock.calls[0]!;
    expect((entries as { skipReason: string | null }[])[0]!.skipReason).toBe("capped");
  });
});

describe("the row it writes", () => {
  it("records a repo claim at the MEDIUM band, never the observed one", async () => {
    await mirrorRepoMemory({ orgSlug: "acme", repoFullName: REPO, memoryFiles: [file("0001-a", doc("0001"))] });
    const arg = h.writeMemoryCandidate.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.confidence).toBe(REPO_MEMORY_CONFIDENCE);
    expect(arg.confidence).toBe(0.6);
    expect(arg.confidence).not.toBe(1.0);
  });

  it("namespaces to the repo, sources as repo-memory, and tags all three facets", async () => {
    await mirrorRepoMemory({ orgSlug: "acme", repoFullName: REPO, memoryFiles: [file("0007-x", doc("0007", "failed-approach"))] });
    const arg = h.writeMemoryCandidate.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg).toMatchObject({
      orgId: "org_1",
      namespace: REPO,
      source: REPO_MEMORY_SOURCE,
      kind: "procedural",
    });
    expect(arg.tags).toEqual([REPO, "procedural", REPO_MEMORY_SOURCE]);
  });

  it("quotes the entry verbatim under a provenance line — a mirror does not rewrite", () => {
    const e = parseRepoMemoryEntry(".ai/memory/0007-x.md", doc("0007", "gotcha", "the drift never self-repaired"))!;
    const body = memoryBody(e, REPO);
    expect(body).toContain(`From ${REPO} — .ai/memory/0007-x.md`);
    expect(body).toContain("kind: gotcha");
    expect(body).toContain("dated 2026-06-10");
    expect(body).toContain("the drift never self-repaired");
  });

  it("stamps the head sha it was read at", async () => {
    await mirrorRepoMemory({ orgSlug: "acme", repoFullName: REPO, headSha: "abc123", memoryFiles: [file("0001-a", doc("0001"))] });
    const [, , entries] = h.upsertMirrorEntries.mock.calls[0]!;
    expect((entries as { headSha: string | null }[])[0]!.headSha).toBe("abc123");
  });
});

describe("idempotency", () => {
  it("a second identical scan mirrors ZERO new rows", async () => {
    h.upsertMirrorEntries.mockImplementation(
      async (_o: string, _r: string, entries: { path: string; contentHash: string }[]) =>
        entries.map((e, i) => ({ id: `row_${i}`, path: e.path, contentHash: e.contentHash, entryId: null, mappedKind: "semantic", body: "", supersedes: null, isNew: false })),
    );
    const r = await mirrorRepoMemory({ orgSlug: "acme", repoFullName: REPO, memoryFiles: [file("0001-a", doc("0001"))] });
    expect(r?.mirrored).toBe(0);
    expect(h.writeMemoryCandidate).not.toHaveBeenCalled();
  });

  it("a new row the ingest door DEDUPED is counted as deduped and says so on the ledger", async () => {
    h.writeMemoryCandidate.mockResolvedValue(null);
    const r = await mirrorRepoMemory({ orgSlug: "acme", repoFullName: REPO, memoryFiles: [file("0001-a", doc("0001"))] });
    expect(r).toMatchObject({ mirrored: 0, deduped: 1 });
    expect(h.linkMirroredMemory).toHaveBeenCalledWith("row_0", { skipReason: "deduped" });
  });

  it("links a mirrored row to the OrgMemory row it fed", async () => {
    await mirrorRepoMemory({ orgSlug: "acme", repoFullName: REPO, memoryFiles: [file("0001-a", doc("0001"))] });
    expect(h.linkMirroredMemory).toHaveBeenCalledWith("row_0", { orgMemoryId: "mem_0" });
  });
});

describe("superseding", () => {
  it("archives the predecessor's memory rather than deleting it", async () => {
    h.markSuperseded.mockResolvedValue(["mem_old"]);
    const r = await mirrorRepoMemory({
      orgSlug: "acme",
      repoFullName: REPO,
      memoryFiles: [file("0009-x", doc("0009", "decision", "the new call", "0003"))],
    });
    expect(h.markSuperseded).toHaveBeenCalledWith("org_1", REPO, ["0003"]);
    expect(h.archiveOrgMemory).toHaveBeenCalledWith("mem_old");
    expect(r?.superseded).toBe(1);
  });

  it("claims nothing when no entry declares a supersedes", async () => {
    await mirrorRepoMemory({ orgSlug: "acme", repoFullName: REPO, memoryFiles: [file("0001-a", doc("0001"))] });
    expect(h.markSuperseded).toHaveBeenCalledWith("org_1", REPO, []);
    expect(h.archiveOrgMemory).not.toHaveBeenCalled();
  });
});

describe("malformed input and failure", () => {
  it("counts an unreadable entry as skipped and mirrors the readable one beside it", async () => {
    const r = await mirrorRepoMemory({
      orgSlug: "acme",
      repoFullName: REPO,
      memoryFiles: [file("0001-a", doc("0001")), file("0002-b", "no frontmatter at all")],
    });
    expect(r).toMatchObject({ mirrored: 1, skipped: 1 });
  });

  it("returns null (never throws) when the data layer fails", async () => {
    h.upsertMirrorEntries.mockRejectedValue(new Error("db is gone"));
    await expect(
      mirrorRepoMemory({ orgSlug: "acme", repoFullName: REPO, memoryFiles: [file("0001-a", doc("0001"))] }),
    ).resolves.toBeNull();
  });

  it("does nothing at all when the snapshot carried no memory channel", async () => {
    expect(await mirrorRepoMemory({ orgSlug: "acme", repoFullName: REPO, memoryFiles: [] })).toBeNull();
    expect(h.resolveMirrorTarget).not.toHaveBeenCalled();
  });
});

describe("self-hosted", () => {
  it("collapses the caps rather than changing any other behaviour", async () => {
    h.selfHosted.mockReturnValue(true);
    h.resolveMirrorTarget.mockResolvedValue({ ...TARGET, liveCount: MAX_LIVE_PER_REPO + 50 });
    const files = Array.from({ length: MAX_ENTRIES_PER_SCAN + 3 }, (_, i) =>
      file(`${String(i + 1).padStart(4, "0")}-e`, doc(String(i + 1).padStart(4, "0"))),
    );
    const r = await mirrorRepoMemory({ orgSlug: "acme", repoFullName: REPO, memoryFiles: files });
    expect(r?.mirrored).toBe(MAX_ENTRIES_PER_SCAN + 3);
    // Still the honest band — self-hosting removes a limit, not the provenance rule.
    const arg = h.writeMemoryCandidate.mock.calls[0]![0] as Record<string, unknown>;
    expect(arg.confidence).toBe(REPO_MEMORY_CONFIDENCE);
  });
});
