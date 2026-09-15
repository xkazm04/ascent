// The loader's contract: the corpus half from the registry view, the fleet half from the sweep
// rows, dense cells, honest empties, and capabilities that come from the viewer's role. Every
// server dependency is mocked at the module boundary; the pure fold has its own test
// (knowledge-fleet.test.ts).

import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  registryView: vi.fn(),
  orgId: vi.fn(),
  subjects: vi.fn(),
  maps: vi.fn(),
  pairs: vi.fn(),
  dispatches: vi.fn(),
  hasRole: vi.fn(),
  selfHosted: vi.fn(),
  autopilot: vi.fn(),
}));

vi.mock("./registry-view", () => ({ getRegistryView: m.registryView, CONFORMANCE_PAIR_CAP: 3000 }));
vi.mock("@/lib/db/org-rollup", () => ({ getOrgId: m.orgId }));
vi.mock("@/lib/db/org-registry-subjects", () => ({ listOrgKnowledgeSubjects: m.subjects }));
vi.mock("@/lib/db/org-registry-conformance", () => ({ listConformanceMaps: m.maps, listConformance: m.pairs }));
vi.mock("@/lib/db/org-registry-dispatch", () => ({ listDispatches: m.dispatches }));
vi.mock("@/lib/authz", () => ({ hasOrgRole: m.hasRole }));
vi.mock("@/lib/env", () => ({ selfHosted: m.selfHosted }));
vi.mock("@/lib/local/agent", () => ({ autopilotEnabled: m.autopilot }));

import { getKnowledgeView } from "./knowledge-view";

const registry = (over: Record<string, unknown> = {}) => ({
  status: "indexed",
  registry: { fullName: "acme/ai-registry", url: "https://github.com/acme/ai-registry", lastIndexedAt: "2026-09-05T00:00:00.000Z" },
  bundles: [
    { name: "software-engineering", subjects: 2, techniques: 10, applications: 4, laws: 3, categories: ["ui-surfaces"], useWhenCoverage: "10/10", taxonomy: [{ id: "ui-surfaces", title: "UI surfaces", order: 0, subjects: ["table"], subcategories: [] }] },
    { name: "media-craft", subjects: 1, techniques: 2, applications: 0, laws: 0, categories: [], useWhenCoverage: null },
  ],
  capabilities: { canWrite: true },
  conformance: {
    pairs: [
      { repositoryId: "r-api", repoFullName: "acme/api", contextName: "A/B", contextGroup: "A", bundle: "software-engineering", subjectSlug: "table", state: "deviation", confidence: "strong", score: 700, evidence: "src/x.ts:1", evaluatedAt: null, evaluatedAgainst: "sha256:old", mapSha: "m1", ingestedAt: "2026-09-04T00:00:00.000Z" },
    ],
    truncated: false,
  },
  signals: { contributors: 1, subjects: [{ bundle: "software-engineering", subjectSlug: "table", contributors: 1, consults: 3, deviations: 1, citResolved: null, citMoved: null, citGone: null }] },
  ...over,
});

const subjectRow = (slug: string, digest: string) => ({
  bundle: "software-engineering", slug, category: "ui-surfaces", subcategory: null, status: "forged", file: `k/${slug}.md`, techniqueCount: 1, useWhen: [], laws: [], digest, indexedAt: "2026-09-05T00:00:00.000Z",
});

const mapRow = (repositoryId: string, repoFullName: string, over: Record<string, unknown> = {}) => ({
  repositoryId, repoFullName, mapSha: "m1", schema: "rkb-registry-map/1", generatedAt: "2026-09-01T00:00:00.000Z", contexts: 1, pairs: 1, judged: 1, deviations: 1, weaklyGoverned: 0, weaklyGovernedContexts: [], unmatched: 0,
  domains: ["software-engineering"], consults30d: null, hasContextMap: true, hasManifest: true, scope: { outOfScopeCategories: [], outOfScopeSubjects: [] }, directions: [], warnings: [], ingestedAt: "2026-09-04T00:00:00.000Z", ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  m.registryView.mockResolvedValue(registry());
  m.orgId.mockResolvedValue("org-1");
  m.subjects.mockResolvedValue([subjectRow("table", "sha256:new"), subjectRow("feed", "sha256:feed")]);
  m.maps.mockResolvedValue([mapRow("r-api", "acme/api"), mapRow("r-web", "acme/web", { mapSha: null, hasContextMap: false, pairs: 0, judged: 0, deviations: 0, warnings: ["context-map.json: presence could not be probed"] })]);
  m.pairs.mockResolvedValue([]);
  m.dispatches.mockResolvedValue([{ id: "d-1", repositoryId: "r-api", repoFullName: "acme/api", stage: "conform", mode: "brief", status: "handed_off" }]);
  m.hasRole.mockImplementation(async (_slug: string, min: string) => min === "admin");
  m.selfHosted.mockReturnValue(false);
  m.autopilot.mockReturnValue(false);
});

describe("getKnowledgeView", () => {
  it("is honestly unmapped with an empty fleet when no registry is mapped", async () => {
    m.registryView.mockResolvedValue({ status: "unmapped", bundles: [], capabilities: { canWrite: false } });
    const view = await getKnowledgeView("acme");
    expect(view.status).toBe("unmapped");
    expect(view.cells).toEqual([]);
    expect(view.sweep.lastAt).toBeNull();
    expect(m.subjects).not.toHaveBeenCalled();
  });

  it("mirrors the bundles with their taxonomy, heaviest first, and falls back to [] for an old row", async () => {
    const view = await getKnowledgeView("acme");
    expect(view.status).toBe("indexed");
    expect(view.domains.map((d) => d.name)).toEqual(["software-engineering", "media-craft"]);
    expect(view.domains[0]!.taxonomy[0]!.title).toBe("UI surfaces");
    expect(view.domains[1]!.taxonomy).toEqual([]);
    expect(view.domains[0]!.useWhenCoverage).toEqual({ written: 10, total: 10 });
    expect(view.totals).toEqual({ domains: 2, subjects: 3, techniques: 12, applications: 4 });
  });

  it("fills the fleet half: dense cells, stale flag, stages, signals, dispatches, sweep", async () => {
    const view = await getKnowledgeView("acme");
    expect(view.subjects.map((s) => s.slug)).toEqual(["table", "feed"]);
    expect(view.repos.map((r) => [r.fullName, r.stage, r.hasMap])).toEqual([
      ["acme/api", "conform", true],
      ["acme/web", "populate", false],
    ]);
    // 2 subjects × 2 swept repos.
    expect(view.cells).toHaveLength(4);
    const at = (s: string, r: string) => view.cells.find((c) => c.subject === s && c.repositoryId === r)!;
    expect(at("table", "r-api")).toMatchObject({ state: "deviation", stale: true, contexts: 1, evidence: "src/x.ts:1" });
    expect(at("feed", "r-api").state).toBe("candidate");
    expect(at("table", "r-web").state).toBe("no-map");
    expect(view.signals).toHaveLength(1);
    expect(view.dispatches[0]!.id).toBe("d-1");
    expect(view.sweep).toEqual({ lastAt: "2026-09-04T00:00:00.000Z", warnings: ["acme/web: context-map.json: presence could not be probed"], truncated: false });
    // The pairs came from the registry view's capped list — no second read.
    expect(m.pairs).not.toHaveBeenCalled();
  });

  it("reads the pairs itself when the registry view carries no conformance block", async () => {
    m.registryView.mockResolvedValue(registry({ conformance: undefined }));
    await getKnowledgeView("acme");
    expect(m.pairs).toHaveBeenCalledWith("org-1", { limit: 3001 });
  });

  it("derives capabilities from the viewer's role, the deployment and operator consent", async () => {
    let view = await getKnowledgeView("acme");
    expect(view.capabilities).toEqual({ canSweep: true, canBrief: true, canRunLocal: false });

    m.hasRole.mockResolvedValue(true); // owner
    m.selfHosted.mockReturnValue(true);
    m.autopilot.mockReturnValue(true);
    view = await getKnowledgeView("acme");
    expect(view.capabilities.canRunLocal).toBe(true);

    // An owner on a managed deployment never gets the local runner, whatever the env says.
    m.selfHosted.mockReturnValue(false);
    view = await getKnowledgeView("acme");
    expect(view.capabilities.canRunLocal).toBe(false);

    // A member: no sweep, no brief.
    m.hasRole.mockResolvedValue(false);
    m.registryView.mockResolvedValue(registry({ capabilities: { canWrite: false } }));
    view = await getKnowledgeView("acme");
    expect(view.capabilities).toEqual({ canSweep: false, canBrief: false, canRunLocal: false });
  });

  it("degrades a failed fleet read to an empty lane, never a thrown view", async () => {
    m.maps.mockRejectedValue(new Error("db down"));
    m.dispatches.mockRejectedValue(new Error("db down"));
    const view = await getKnowledgeView("acme");
    expect(view.status).toBe("indexed");
    expect(view.repos).toEqual([]);
    expect(view.cells).toEqual([]);
    expect(view.dispatches).toEqual([]);
  });

  it("reports an index error with the header and an empty fleet", async () => {
    m.registryView.mockResolvedValue(registry({ status: "error", error: { message: "boom", at: "2026-09-05T00:00:00.000Z" } }));
    const view = await getKnowledgeView("acme");
    expect(view.status).toBe("error");
    expect(view.error?.message).toBe("boom");
    expect(view.registry?.fullName).toBe("acme/ai-registry");
    expect(view.cells).toEqual([]);
  });
});
