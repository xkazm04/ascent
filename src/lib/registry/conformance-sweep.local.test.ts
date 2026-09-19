// The sweep over PAIRED checkouts (self-hosted, no token): a paired repo is read from its folder and
// ingested exactly like a GitHub read; an unpaired one is SKIPPED — counted once in the warnings and
// never cleared, because "this sweep cannot reach it" is not "it has no map".

import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  targets: vi.fn(),
  ingest: vi.fn(),
  clear: vi.fn(),
  localFiles: vi.fn(),
  localRevision: vi.fn(),
  githubRead: vi.fn(),
}));

vi.mock("./conformance-read", () => ({ readRepoStandardsFiles: h.githubRead }));
vi.mock("./conformance-read-local", () => ({ readLocalStandardsFiles: h.localFiles, readLocalContextMapRevision: h.localRevision }));
vi.mock("@/lib/github/app", () => ({ githubAppFetch: vi.fn(), AppApiError: class extends Error {} }));
vi.mock("@/lib/db/org-registry-conformance", () => ({ ingestRepoConformance: h.ingest, clearRepoConformance: h.clear, listSweepTargets: h.targets }));
vi.mock("@/lib/db/org-registry-dispatch", () => ({ OPEN_DISPATCH_STATUSES: [], listDispatches: vi.fn(async () => []), markDispatch: vi.fn() }));

import { localStandardsReader, sweepConformance } from "./conformance-sweep";
import { MAP_SCHEMA } from "./conformance-map";

const map = JSON.stringify({
  schema: MAP_SCHEMA,
  generatedAt: "2026-09-16T00:00:00Z",
  domains: ["software-engineering"],
  stats: { contexts: 1, pairs: 1, judged: 1, deviations: 0, weaklyGoverned: 0, unmatched: 0 },
  contexts: [{ context: "A/B", group: "A", subjects: [{ subject: "table", bundle: "software-engineering", state: "conformant", score: 1 }] }],
});

beforeEach(() => {
  vi.clearAllMocks();
  h.targets.mockResolvedValue({
    orgId: "org-1",
    repos: [
      { id: "r1", fullName: "acme/api", localPath: "C:/code/api" },
      { id: "r2", fullName: "acme/web", localPath: null },
    ],
  });
  h.ingest.mockResolvedValue({ pairs: 1, removed: 0 });
  h.localFiles.mockResolvedValue({ map, consults: null, mapSha: "blob-1", reason: null, manifest: null, ledger: null, hasContextMap: true, warnings: [] });
  h.localRevision.mockResolvedValue("rev-7");
});

describe("sweepConformance over paired checkouts", () => {
  it("reads the paired folder, skips the unpaired repo without clearing it, and touches GitHub not at all", async () => {
    const r = await sweepConformance("acme", localStandardsReader());
    expect(h.localFiles).toHaveBeenCalledWith("C:/code/api");
    expect(h.localFiles).toHaveBeenCalledTimes(1);
    expect(h.ingest).toHaveBeenCalledWith(expect.objectContaining({ repositoryId: "r1", mapSha: "blob-1", repoContextMapRevision: "rev-7" }));
    expect(h.clear).not.toHaveBeenCalled();
    expect(h.githubRead).not.toHaveBeenCalled();
    expect(r).toMatchObject({ scanned: 1, withMap: 1 });
    expect(r.warnings[0]).toMatch(/1 repo not reachable/);
  });
});
