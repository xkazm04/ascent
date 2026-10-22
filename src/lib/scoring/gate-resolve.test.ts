// The effective-policy resolver: the fold order, the fleet batch, and the structural guard that keeps
// it the ONLY fold (tightenGatePolicy called only in gate.ts and gate-resolve.ts).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { stripCommentsAndStrings } from "@/app/api/org/id-routes-gated.test";
import type { RepoAdmissionRow } from "@/lib/org/admission";

const { mockList, mockLayer } = vi.hoisted(() => ({ mockList: vi.fn(), mockLayer: vi.fn() }));
vi.mock("@/lib/db/org-admission", () => ({ listOrgAdmissions: mockList }));
vi.mock("@/lib/scoring/gate-admission", () => ({ resolveAdmissionLayer: mockLayer }));

import { fleetFromRows, foldGatePolicy, resolveFleetGatePolicies, resolveRepoGatePolicy } from "./gate-resolve";
import { defaultGatePolicy, explicitPolicyFromParams, policyFromParams, tightenGatePolicy } from "./gate";

const row = (repoFullName: string, over: Partial<RepoAdmissionRow> = {}): RepoAdmissionRow => ({
  id: "",
  repoFullName,
  stanceVersion: 0,
  derivedTier: "T2",
  grantedTier: "T2",
  mode: "assisted-only",
  decidedBy: null,
  decidedAt: null,
  rationale: "",
  rulesetId: null,
  createdAt: "",
  updatedAt: "",
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe("foldGatePolicy", () => {
  it("org bar: tighten(tighten(org, admission), params) and names each layer", () => {
    const params = new URLSearchParams("min_overall=60");
    const out = foldGatePolicy({
      orgPolicy: { minLevel: "L2" },
      archetype: "org",
      overlay: { minAiGovernedRate: 90 },
      params: { explicit: explicitPolicyFromParams(params), padded: () => policyFromParams(params, "org") },
    });
    expect(out.policy).toEqual({ minLevel: "L2", minOverall: 60, minAiGovernedRate: 90 });
    expect(out.layers).toEqual(["org", "admission", "params"]);
  });

  it("no org bar + params: the endpoint's historical padded branch, byte-for-byte", () => {
    const params = new URLSearchParams("min_overall=60");
    const padded = policyFromParams(params, "solo");
    const out = foldGatePolicy({ orgPolicy: null, archetype: "solo", overlay: {}, params: { explicit: explicitPolicyFromParams(params), padded: () => padded } });
    expect(out.policy).toEqual(tightenGatePolicy(padded, {}));
    expect(out.layers).toEqual(["archetype", "params"]);
  });

  it("no params: tighten(org ?? archetype, admission)", () => {
    expect(foldGatePolicy({ orgPolicy: undefined, archetype: "org", overlay: {} }).policy).toEqual(
      tightenGatePolicy(defaultGatePolicy("org"), {}),
    );
  });
});

describe("resolveRepoGatePolicy", () => {
  it("reads the admission seam and folds it, and rethrows a read failure (fail closed)", async () => {
    mockLayer.mockResolvedValueOnce({ overlay: { minAiGovernedRate: 100 }, admission: { mode: "assisted-only", tier: "T1", source: "granted" } });
    const out = await resolveRepoGatePolicy({ orgSlug: "acme", repoFullName: "acme/a", orgPolicy: { minLevel: "L2" }, archetype: "org" });
    expect(out.policy.minAiGovernedRate).toBe(100);
    expect(out.layers).toEqual(["org", "admission"]);
    expect(out.admission?.tier).toBe("T1");
    mockLayer.mockRejectedValueOnce(new Error("db down"));
    await expect(resolveRepoGatePolicy({ orgSlug: "acme", repoFullName: "acme/a", orgPolicy: null, archetype: "org" })).rejects.toThrow("db down");
  });
});

describe("fleet resolver", () => {
  it("one list read; per-repo overlay by granted tier; unassessed and T3 rows add nothing", async () => {
    mockList.mockResolvedValueOnce([
      row("acme/A"),
      row("acme/b", { derivedTier: null, grantedTier: "T0" }),
      row("acme/c", { mode: "blocked", derivedTier: null }),
    ]);
    const f = await resolveFleetGatePolicies("acme", { minLevel: "L2" }, "org");
    expect(mockList).toHaveBeenCalledTimes(1);
    expect(f.policyFor("acme/a").minAiGovernedRate).toBe(90);
    expect(f.layersFor("acme/a")).toEqual(["org", "admission"]);
    expect(f.policyFor("acme/b")).toEqual(f.base);
    expect(f.policyFor("acme/c").forbidAiAuthorship).toBe(true);
    expect(f.policyFor("acme/unknown")).toEqual({ minLevel: "L2" });
    expect(f.layersFor("acme/unknown")).toEqual(["org"]);
  });

  it("a list read failure throws (the caller decides how loud)", async () => {
    mockList.mockRejectedValueOnce(new Error("db down"));
    await expect(resolveFleetGatePolicies("acme", null, "org")).rejects.toThrow("db down");
    expect(fleetFromRows(null, "org", []).base).toEqual(tightenGatePolicy(defaultGatePolicy("org"), {}));
  });
});

// --- structural guard: this module is the only fold --------------------------------------------
const SRC = join(process.cwd(), "src");
const ALLOWED = new Set(["lib/scoring/gate.ts", "lib/scoring/gate-resolve.ts"]);
const CALL = /\btightenGatePolicy\s*\(/;
const callsFold = (src: string) => CALL.test(stripCommentsAndStrings(src));

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}

describe("resolveRepoGatePolicy is the only fold (structural guard)", () => {
  it("the matcher flags a seeded code call and ignores the same text in prose", () => {
    expect(callsFold("const p = tightenGatePolicy(base, overlay);")).toBe(true);
    expect(callsFold("// const p = tightenGatePolicy(base, overlay);\nconst x = 1;")).toBe(false);
    expect(callsFold('const s = "tightenGatePolicy(a, b)";')).toBe(false);
  });

  it("finds tightenGatePolicy( only in gate.ts and gate-resolve.ts", () => {
    const hits = sourceFiles(SRC)
      .filter((f) => callsFold(readFileSync(f, "utf8")))
      .map((f) => relative(SRC, f).split(sep).join("/"))
      .sort();
    expect(hits.filter((h) => !ALLOWED.has(h))).toEqual([]);
    expect(hits).toEqual([...ALLOWED].sort());
  });
});
