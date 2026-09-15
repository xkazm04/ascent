// The fleet sweep's DEGRADE contract (#18) — the only thing this module adds over the pure parse,
// and the thing that decides whether the instrument is usable at fleet size.
//
// Three distinct facts must stay distinct, and each has a test:
//   no map        → the repo stopped claiming anything; its pairs are cleared and a HEADER ROW is
//                   written with `mapSha: null` carrying the foundation facts (knowledge base rebuild).
//   unreadable    → a warning; the previous conformance is KEPT (deleting a standing deviation
//                   backlog because GitHub timed out is the worst outcome available here).
//   read + parsed → ingested, idempotently, with the foundation beside the header.

import { describe, expect, it, vi, beforeEach } from "vitest";

const { mockTargets, mockRead, mockIngest, mockClear, mockListDispatches, mockMarkDispatch, mockAppFetch } = vi.hoisted(() => ({
  mockTargets: vi.fn(),
  mockRead: vi.fn(),
  mockIngest: vi.fn(),
  mockClear: vi.fn(),
  mockListDispatches: vi.fn(),
  mockMarkDispatch: vi.fn(),
  mockAppFetch: vi.fn(),
}));

vi.mock("./conformance-read", () => ({ readRepoStandardsFiles: mockRead }));
// The ONE GitHub read the sweep makes itself: `context-map.json` for its `revision`. Defaults to a
// 404 in beforeEach so every older test runs with the revision unknown, exactly as a repo without
// the file would.
vi.mock("@/lib/github/app", () => ({
  githubAppFetch: mockAppFetch,
  AppApiError: class AppApiError extends Error {
    constructor(
      readonly status: number,
      readonly path: string,
      readonly body: string,
    ) {
      super(`GitHub App API ${status} on ${path}: ${body}`);
    }
  },
}));
vi.mock("@/lib/db/org-registry-conformance", () => ({
  ingestRepoConformance: mockIngest,
  clearRepoConformance: mockClear,
  listSweepTargets: mockTargets,
}));
vi.mock("@/lib/db/org-registry-dispatch", () => ({
  OPEN_DISPATCH_STATUSES: ["handed_off", "running", "proposed"],
  listDispatches: mockListDispatches,
  markDispatch: mockMarkDispatch,
}));

import { foundationOf, sweepConformance } from "./conformance-sweep";
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
        governance: "weak",
        subjects: [{ subject: "quality-gates", bundle: "software-engineering", state: "deviation", score: 700 }],
      },
    ],
    ...over,
  });

const MANIFEST = `knowledge:
  domains: [software-engineering]
scope:
  out_of_scope_categories:
    - software-engineering/llm-agent/companion
  out_of_scope_subjects: [software-engineering/feed]
`;
const LEDGER = [
  JSON.stringify({ date: "2026-09-01", subject: "table", bundle: "software-engineering", decision: "deferred" }),
  JSON.stringify({ date: "2026-09-03", subject: "table", bundle: "software-engineering", decision: "declined" }),
].join("\n");

/** The reader's full shape; tests override the parts they are about. */
const files = (over: Record<string, unknown> = {}) => ({
  map: mapBody(),
  consults: null,
  mapSha: "sha-1",
  reason: null,
  manifest: null,
  ledger: null,
  hasContextMap: true,
  warnings: [],
  ...over,
});

const repos = (...fullNames: string[]) =>
  fullNames.map((fullName, i) => ({ id: `repo-${i}`, fullName }));

beforeEach(() => {
  vi.clearAllMocks();
  mockIngest.mockResolvedValue({ pairs: 1, removed: 0 });
  mockTargets.mockResolvedValue({ orgId: "org-1", repos: repos("acme/api") });
  mockListDispatches.mockResolvedValue([]);
  mockMarkDispatch.mockResolvedValue(null);
  mockAppFetch.mockRejectedValue(Object.assign(new Error("GitHub App API 404"), { status: 404 }));
});

/** A Contents-API answer for `context-map.json` carrying the given body. */
const contentsFile = (body: string) => ({ type: "file", encoding: "base64", size: body.length, content: Buffer.from(body, "utf8").toString("base64") });

describe("sweepConformance", () => {
  it("ingests a repo whose map parses", async () => {
    mockRead.mockResolvedValue(files());
    const r = await sweepConformance("acme", "tok");
    expect(r).toMatchObject({ scanned: 1, withMap: 1, withoutMap: 0, pairs: 1, warnings: [] });
    expect(mockIngest).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-1", repositoryId: "repo-0", mapSha: "sha-1", consults30d: null }),
    );
  });

  it("leaves consults30d NULL when the consults lane is absent", async () => {
    mockRead.mockResolvedValue(files({ mapSha: "s" }));
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
    mockRead.mockResolvedValue(files({ consults }));
    await sweepConformance("acme", "tok", { now });
    expect(mockIngest.mock.calls[0]![0].consults30d).toBe(1);
  });

  it("carries the foundation beside a parsed map: manifest domains + scope, latest ledger decision, weak contexts", async () => {
    mockRead.mockResolvedValue(files({ manifest: MANIFEST, ledger: LEDGER, hasContextMap: true }));
    await sweepConformance("acme", "tok");
    const input = mockIngest.mock.calls[0]![0];
    expect(input.foundation).toEqual({
      hasContextMap: true,
      hasManifest: true,
      domains: ["software-engineering"],
      scope: { outOfScopeCategories: ["software-engineering/llm-agent/companion"], outOfScopeSubjects: ["software-engineering/feed"] },
      directions: [{ subject: "table", bundle: "software-engineering", decision: "declined" }],
    });
    expect(input.header.weaklyGovernedContexts).toEqual(["A/B"]);
  });

  it("writes a HEADER ROW for a repo without a map — mapSha null, honest hasContextMap, manifest facts", async () => {
    mockRead.mockResolvedValue(files({ map: null, mapSha: null, reason: "no .ai/registry-map.json", manifest: MANIFEST, hasContextMap: false }));
    const r = await sweepConformance("acme", "tok", { now: new Date("2026-09-05T00:00:00Z") });
    expect(r).toMatchObject({ withMap: 0, withoutMap: 1, pairs: 0 });
    expect(mockIngest).not.toHaveBeenCalled();
    expect(mockClear).toHaveBeenCalledWith({
      orgId: "org-1",
      repositoryId: "repo-0",
      foundation: expect.objectContaining({ hasContextMap: false, hasManifest: true, domains: ["software-engineering"] }),
      warnings: [],
      now: new Date("2026-09-05T00:00:00Z"),
      // No context map at the root → no request made, revision unknown.
      repoContextMapRevision: null,
    });
  });

  it("a repo with neither map nor manifest gets an empty foundation, not a guessed one", async () => {
    mockRead.mockResolvedValue(files({ map: null, mapSha: null, reason: "no .ai/registry-map.json", hasContextMap: false }));
    await sweepConformance("acme", "tok");
    expect(mockClear.mock.calls[0]![0].foundation).toEqual({
      hasContextMap: false,
      hasManifest: false,
      domains: [],
      scope: { outOfScopeCategories: [], outOfScopeSubjects: [] },
      directions: [],
    });
  });

  it("KEEPS the previous conformance when a map is unreadable", async () => {
    mockRead.mockResolvedValue(files({ map: "{truncated" }));
    const r = await sweepConformance("acme", "tok");
    expect(mockClear).not.toHaveBeenCalled();
    expect(mockIngest).not.toHaveBeenCalled();
    expect(r.warnings[0]).toContain("previous conformance kept");
  });

  it("degrades ONE repo's transport failure and sweeps the rest", async () => {
    mockTargets.mockResolvedValue({ orgId: "org-1", repos: repos("acme/api", "acme/web") });
    mockRead.mockImplementation(async (_t: string, _o: string, repo: string) => {
      if (repo === "api") throw new Error("GitHub App API 502");
      return files();
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
    mockRead.mockResolvedValue(files());
    await sweepConformance("acme", "tok", { repositoryIds: ["repo-0", "someone-elses-repo"] });
    expect(mockTargets).toHaveBeenCalledWith("acme", ["repo-0", "someone-elses-repo"]);
  });

  it("accepts the one-repo form and the indexer's { orgId } form", async () => {
    mockRead.mockResolvedValue(files());
    await sweepConformance("acme", "tok", { repositoryId: "repo-0" });
    expect(mockTargets).toHaveBeenCalledWith("acme", ["repo-0"]);
    await sweepConformance({ orgId: "org-1" }, "tok");
    expect(mockTargets).toHaveBeenCalledWith({ orgId: "org-1" }, undefined);
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

/** A dispatch row as the ledger returns it; tests override what they are about. */
const dispatch = (over: Record<string, unknown> = {}) => ({
  id: "d-1",
  repositoryId: "repo-0",
  repoFullName: "acme/api",
  stage: "map",
  mode: "brief",
  status: "handed_off",
  subjects: [],
  briefDigest: "sha256:x",
  actor: "octocat",
  branch: null,
  prUrl: null,
  mapShaBefore: "sha-0",
  mapShaAfter: null,
  model: null,
  costMicros: null,
  turns: null,
  agentDurationMs: null,
  summary: null,
  error: null,
  createdAt: "2026-09-05T00:00:00.000Z",
  startedAt: null,
  endedAt: null,
  ...over,
});

describe("sweepConformance closes dispatches (WP2)", () => {
  const now = new Date("2026-09-06T00:00:00Z");

  it("marks an open dispatch done when the swept mapSha differs from mapShaBefore", async () => {
    mockRead.mockResolvedValue(files({ mapSha: "sha-1" }));
    mockListDispatches.mockResolvedValue([dispatch({ mapShaBefore: "sha-0" })]);
    const r = await sweepConformance("acme", "tok", { now });
    expect(r.warnings).toEqual([]);
    expect(mockListDispatches).toHaveBeenCalledWith("org-1", { repositoryId: "repo-0" });
    expect(mockMarkDispatch).toHaveBeenCalledWith("org-1", "d-1", { status: "done", mapShaAfter: "sha-1", endedAt: now });
  });

  it("leaves a dispatch open when the map has not moved", async () => {
    mockRead.mockResolvedValue(files({ mapSha: "sha-0" }));
    mockListDispatches.mockResolvedValue([dispatch({ mapShaBefore: "sha-0" })]);
    await sweepConformance("acme", "tok");
    expect(mockMarkDispatch).not.toHaveBeenCalled();
  });

  it("treats a null mapShaBefore as 'any map counts' (a populate / map dispatch on a map-less repo)", async () => {
    mockRead.mockResolvedValue(files({ mapSha: "sha-1" }));
    mockListDispatches.mockResolvedValue([dispatch({ stage: "populate", mapShaBefore: null })]);
    await sweepConformance("acme", "tok");
    expect(mockMarkDispatch).toHaveBeenCalledWith("org-1", "d-1", expect.objectContaining({ status: "done", mapShaAfter: "sha-1" }));
  });

  it("keeps a conform dispatch open while a named subject still has an unjudged pair", async () => {
    const map = mapBody({
      contexts: [
        {
          context: "A/B",
          group: "A",
          governance: "weak",
          subjects: [
            { subject: "quality-gates", bundle: "software-engineering", state: "conformant", score: 700 },
            { subject: "feature-flags", bundle: "software-engineering", state: "unknown", score: 600 },
          ],
        },
      ],
    });
    mockRead.mockResolvedValue(files({ map, mapSha: "sha-1" }));
    mockListDispatches.mockResolvedValue([dispatch({ stage: "conform", subjects: ["quality-gates", "feature-flags"] })]);
    await sweepConformance("acme", "tok");
    expect(mockMarkDispatch).not.toHaveBeenCalled();
  });

  it("closes a conform dispatch once every named subject is judged (a subject with no pair at all counts as judged)", async () => {
    mockRead.mockResolvedValue(files({ mapSha: "sha-1" }));
    mockListDispatches.mockResolvedValue([dispatch({ stage: "conform", subjects: ["quality-gates", "never-matched"] })]);
    await sweepConformance("acme", "tok");
    expect(mockMarkDispatch).toHaveBeenCalledTimes(1);
  });

  it("ignores terminal rows — the ledger's history is never rewritten", async () => {
    mockRead.mockResolvedValue(files({ mapSha: "sha-1" }));
    mockListDispatches.mockResolvedValue([dispatch({ status: "done" }), dispatch({ id: "d-2", status: "superseded" }), dispatch({ id: "d-3", status: "failed" })]);
    await sweepConformance("acme", "tok");
    expect(mockMarkDispatch).not.toHaveBeenCalled();
  });

  it("consults no dispatch for a repo without a map — nothing can have moved", async () => {
    mockRead.mockResolvedValue(files({ map: null, mapSha: null, reason: "no .ai/registry-map.json" }));
    await sweepConformance("acme", "tok");
    expect(mockListDispatches).not.toHaveBeenCalled();
  });

  it("degrades a ledger read failure into a warning and keeps the ingest", async () => {
    mockRead.mockResolvedValue(files({ mapSha: "sha-1" }));
    mockListDispatches.mockRejectedValue(new Error("ledger down"));
    const r = await sweepConformance("acme", "tok");
    expect(r).toMatchObject({ withMap: 1, pairs: 1 });
    expect(r.warnings[0]).toContain("dispatches not read (ledger down)");
  });

  it("degrades a ledger write failure into a warning naming the dispatch", async () => {
    mockRead.mockResolvedValue(files({ mapSha: "sha-1" }));
    mockListDispatches.mockResolvedValue([dispatch()]);
    mockMarkDispatch.mockRejectedValue(new Error("write refused"));
    const r = await sweepConformance("acme", "tok");
    expect(r.withMap).toBe(1);
    expect(r.warnings[0]).toContain("dispatch d-1 not closed (write refused)");
  });
});

describe("foundationOf", () => {
  it("tolerates a reader that returned the pre-rebuild shape", () => {
    expect(foundationOf({} as never)).toEqual({
      hasContextMap: false,
      hasManifest: false,
      domains: [],
      scope: { outOfScopeCategories: [], outOfScopeSubjects: [] },
      directions: [],
    });
  });
  it("reads a manifest with no scope block as an EMPTY scope, so every in-domain absence is a candidate", () => {
    expect(foundationOf({ manifest: "knowledge:\n  domains: [a]\n", ledger: null, hasContextMap: true })).toMatchObject({
      hasManifest: true,
      domains: ["a"],
      scope: { outOfScopeCategories: [], outOfScopeSubjects: [] },
    });
  });
});

// ── knowledge-context-matrix: the repo's own context-map.json revision, read beside the map ──────
describe("sweepConformance — context-map.json revision", () => {
  it("reads the revision when the root listing saw the file, and hands it to the ingest", async () => {
    mockRead.mockResolvedValue(files({ hasContextMap: true }));
    mockAppFetch.mockResolvedValue(contentsFile(JSON.stringify({ version: "1", revision: "ecad2b58ad5f", groups: [] })));
    const r = await sweepConformance("acme", "tok");
    expect(r.warnings).toEqual([]);
    expect(mockAppFetch).toHaveBeenCalledWith("/repos/acme/api/contents/context-map.json", "tok");
    expect(mockIngest.mock.calls[0]![0].repoContextMapRevision).toBe("ecad2b58ad5f");
  });

  it("hands the revision to the map-less header row too — a repo at stage `map` still has a context map", async () => {
    mockRead.mockResolvedValue(files({ map: null, mapSha: null, reason: "no .ai/registry-map.json", hasContextMap: true }));
    mockAppFetch.mockResolvedValue(contentsFile(JSON.stringify({ revision: "abc123" })));
    await sweepConformance("acme", "tok");
    expect(mockClear).toHaveBeenCalledWith(expect.objectContaining({ repositoryId: "repo-0", repoContextMapRevision: "abc123" }));
  });

  it("spends no request when the root listing said there is no context map", async () => {
    mockRead.mockResolvedValue(files({ hasContextMap: false }));
    await sweepConformance("acme", "tok");
    expect(mockAppFetch).not.toHaveBeenCalled();
    expect(mockIngest.mock.calls[0]![0].repoContextMapRevision).toBeNull();
  });

  it("a 404 / 403 / transport failure / torn body reads as NULL and never fails the sweep or costs the map", async () => {
    for (const failure of [
      () => mockAppFetch.mockRejectedValue(Object.assign(new Error("404"), { status: 404 })),
      () => mockAppFetch.mockRejectedValue(Object.assign(new Error("403"), { status: 403 })),
      () => mockAppFetch.mockRejectedValue(new Error("socket hang up")),
      () => mockAppFetch.mockResolvedValue(contentsFile('{"revision": "abc"')),
      () => mockAppFetch.mockResolvedValue({ type: "dir" }),
    ]) {
      vi.clearAllMocks();
      mockIngest.mockResolvedValue({ pairs: 1, removed: 0 });
      mockTargets.mockResolvedValue({ orgId: "org-1", repos: repos("acme/api") });
      mockListDispatches.mockResolvedValue([]);
      mockRead.mockResolvedValue(files({ hasContextMap: true }));
      failure();
      const r = await sweepConformance("acme", "tok");
      expect(r).toMatchObject({ withMap: 1, pairs: 1, warnings: [] });
      expect(mockIngest.mock.calls[0]![0].repoContextMapRevision).toBeNull();
    }
  });
});
