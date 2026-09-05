// The fleet sweep's DEGRADE contract (#18) — the only thing this module adds over the pure parse,
// and the thing that decides whether the instrument is usable at fleet size.
//
// Three distinct facts must stay distinct, and each has a test:
//   no map        → the repo stopped claiming anything; its old rows are cleared.
//   unreadable    → a warning; the previous conformance is KEPT (deleting a standing deviation
//                   backlog because GitHub timed out is the worst outcome available here).
//   read + parsed → ingested, idempotently.

import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockTargets, mockRead, mockIngest, mockClear } = vi.hoisted(() => ({
  mockTargets: vi.fn(),
  mockRead: vi.fn(),
  mockIngest: vi.fn(),
  mockClear: vi.fn(),
}));

vi.mock("./conformance-read", () => ({ readRepoStandardsFiles: mockRead }));
vi.mock("@/lib/db/org-registry-conformance", () => ({
  ingestRepoConformance: mockIngest,
  clearRepoConformance: mockClear,
  listSweepTargets: mockTargets,
}));

import { sweepConformance } from "./conformance-sweep";
import { MAP_SCHEMA } from "./conformance-map";

const mapBody = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    schema: MAP_SCHEMA,
    generatedAt: "2026-08-23T14:01:43Z",
    domains: ["software-engineering"],
    stats: { contexts: 1, pairs: 1, judged: 1, deviations: 1, weaklyGoverned: 0, unmatched: 0 },
    contexts: [
      {
        context: "A/B",
        group: "A",
        governance: "governed",
        subjects: [{ subject: "quality-gates", bundle: "software-engineering", state: "deviation", score: 700 }],
      },
    ],
    ...over,
  });

const repos = (...fullNames: string[]) =>
  fullNames.map((fullName, i) => ({ id: `repo-${i}`, fullName }));

beforeEach(() => {
  vi.clearAllMocks();
  mockIngest.mockResolvedValue({ pairs: 1, removed: 0 });
  mockTargets.mockResolvedValue({ orgId: "org-1", repos: repos("acme/api") });
});

describe("sweepConformance", () => {
  it("ingests a repo whose map parses", async () => {
    mockRead.mockResolvedValue({ map: mapBody(), consults: null, mapSha: "sha-1", reason: null });
    const r = await sweepConformance("acme", "tok");
    expect(r).toMatchObject({ scanned: 1, withMap: 1, withoutMap: 0, pairs: 1, warnings: [] });
    expect(mockIngest).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-1", repositoryId: "repo-0", mapSha: "sha-1", consults30d: null }),
    );
  });

  it("leaves consults30d NULL when the consults lane is absent", async () => {
    mockRead.mockResolvedValue({ map: mapBody(), consults: null, mapSha: "s", reason: null });
    await sweepConformance("acme", "tok");
    // NOT 0. "The lane was never written" and "nobody consulted" are different claims.
    expect(mockIngest.mock.calls[0]![0].consults30d).toBeNull();
  });

  it("counts consults inside the window when the lane exists", async () => {
    const now = new Date("2026-08-29T00:00:00Z");
    const consults = [
      JSON.stringify({ ts: "2026-08-25T00:00:00Z", subjects: ["a"] }),
      JSON.stringify({ ts: "2025-01-01T00:00:00Z", subjects: ["a"] }),
    ].join("\n");
    mockRead.mockResolvedValue({ map: mapBody(), consults, mapSha: "s", reason: null });
    await sweepConformance("acme", "tok", { now });
    expect(mockIngest.mock.calls[0]![0].consults30d).toBe(1);
  });

  it("clears a repo whose map went away — it no longer claims those verdicts", async () => {
    mockRead.mockResolvedValue({ map: null, consults: null, mapSha: null, reason: "no .ai/registry-map.json" });
    const r = await sweepConformance("acme", "tok");
    expect(r).toMatchObject({ withMap: 0, withoutMap: 1, pairs: 0 });
    expect(mockClear).toHaveBeenCalledWith("repo-0");
    expect(mockIngest).not.toHaveBeenCalled();
  });

  it("KEEPS the previous conformance when a map is unreadable", async () => {
    mockRead.mockResolvedValue({ map: "{truncated", consults: null, mapSha: "s", reason: null });
    const r = await sweepConformance("acme", "tok");
    expect(mockClear).not.toHaveBeenCalled();
    expect(mockIngest).not.toHaveBeenCalled();
    expect(r.warnings[0]).toContain("previous conformance kept");
  });

  it("degrades ONE repo's transport failure and sweeps the rest", async () => {
    mockTargets.mockResolvedValue({ orgId: "org-1", repos: repos("acme/api", "acme/web") });
    mockRead.mockImplementation(async (_t: string, _o: string, repo: string) => {
      if (repo === "api") throw new Error("GitHub App API 502");
      return { map: mapBody(), consults: null, mapSha: "s", reason: null };
    });
    const r = await sweepConformance("acme", "tok");
    expect(r).toMatchObject({ scanned: 2, withMap: 1 });
    expect(r.warnings[0]).toContain("acme/api: GitHub App API 502");
  });

  it("skips a malformed full name without touching GitHub", async () => {
    mockTargets.mockResolvedValue({ orgId: "org-1", repos: repos("not-a-full-name") });
    const r = await sweepConformance("acme", "tok");
    expect(mockRead).not.toHaveBeenCalled();
    expect(r.warnings[0]).toContain("not a well-formed owner/name");
  });

  it("hands the caller's id list to the org-constrained query, never to GitHub", async () => {
    // The ids are a caller's claim; `listSweepTargets` resolves the org and puts both into ONE
    // query, so a repo belonging to someone else is not found rather than separately refused.
    mockRead.mockResolvedValue({ map: mapBody(), consults: null, mapSha: "s", reason: null });
    await sweepConformance("acme", "tok", { repositoryIds: ["repo-0", "someone-elses-repo"] });
    expect(mockTargets).toHaveBeenCalledWith("acme", ["repo-0", "someone-elses-repo"]);
  });

  it("returns an empty result for an unknown org (or persistence off) rather than throwing", async () => {
    mockTargets.mockResolvedValue(null);
    expect(await sweepConformance("nobody", "tok")).toMatchObject({ scanned: 0, warnings: [] });
  });

  it("returns an empty result for an org with no repositories", async () => {
    mockTargets.mockResolvedValue({ orgId: "org-1", repos: [] });
    expect(await sweepConformance("acme", "tok")).toMatchObject({ scanned: 0 });
  });
});
