// The contract that makes the lane-routing table worth trusting (llm-provider-abstraction#B,
// challenge-2026-09-23). LANE_ROUTING is a DECLARED table, which is what lets the Settings card show
// "if switched on" without switching anything on. A declared table is only as good as its agreement
// with the code, so this drives the REAL resolvers under a mocked active BYOM and a real platform
// provider (openai), and requires each to answer with the engine the table declares: openrouter for a
// lane that honours BYOM, openai for one that does not.
//
// Two ways a lane can drift, two checks:
//   1. The lane's own resolver changes seam (memory or lane summary switched to the org seam): the
//      behavioural check fails, because the resolver IS the lane's call path.
//   2. A call site elsewhere stops using the resolver the table names (briefing-narrative.ts calling
//      the platform-only resolveTextRunner): the call-site scan fails. It reads CODE, not prose:
//      comments and string literals are stripped first, and a seeded violation proves it still bites.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const { mockResolveState } = vi.hoisted(() => ({ mockResolveState: vi.fn() }));
vi.mock("@/lib/db/org-llm", () => ({ resolveByomState: mockResolveState }));

import { LANE_IDS, LANE_ROUTING, routeLanes, type LaneId } from "@/lib/llm/lane-routes";
import { loadLaneRouting } from "@/lib/llm/lane-routes-load";
import { getProviderForOrg } from "@/lib/llm";
import { resolveLegRunnerForOrg, resolveTextRunnerForOrg } from "@/lib/llm/text-org";
import { resolveMemoryRunner } from "@/lib/memory/consolidation-engine";
import { resolveLaneSummaryTextRunner } from "@/lib/local/lane-summary";

const SLUG = "acme";

/** Each lane's REAL resolver, total over LaneId: a sixth lane without one fails `tsc`. */
const RESOLVER: Record<LaneId, () => Promise<string | null>> = {
  scans: async () => (await getProviderForOrg(SLUG)).provider.name,
  athena: async () => (await resolveLegRunnerForOrg(SLUG, { legKind: LANE_ROUTING.athena.legKind }))?.engine ?? null,
  briefing: async () => (await resolveTextRunnerForOrg(SLUG, { legKind: LANE_ROUTING.briefing.legKind }))?.engine ?? null,
  memory: async () => (await resolveMemoryRunner(SLUG))?.engine ?? null,
  laneSummary: async () => (await resolveLaneSummaryTextRunner(SLUG))?.engine ?? null,
};

/** Where each lane's traffic is actually resolved in production, and by which resolver. */
const ORG_SEAM = ["getProviderForOrg", "resolveLegRunnerForOrg", "resolveTextRunnerForOrg", "resolveLegRunnerWithProvenance"];
const PLATFORM_SEAM = ["resolveTextRunner", "resolveLegRunner"];
const CALL_SITES: Record<LaneId, { file: string; resolver: string }[]> = {
  scans: [{ file: "src/lib/scan.ts", resolver: "getProviderForOrg" }],
  athena: [
    { file: "src/app/api/athena/gate.ts", resolver: "resolveLegRunnerForOrg" },
    { file: "src/lib/llm/tool-loop.ts", resolver: "resolveLegRunnerWithProvenance" },
  ],
  briefing: [{ file: "src/lib/org/briefing-narrative.ts", resolver: "resolveTextRunnerForOrg" }],
  memory: [{ file: "src/lib/memory/consolidation-engine.ts", resolver: "resolveTextRunner" }],
  laneSummary: [{ file: "src/lib/local/lane-summary.ts", resolver: "resolveTextRunner" }],
};

function stripCommentsAndStrings(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:\\])\/\/.*$/gm, "$1")
    .replace(/`(?:\\[\s\S]|[^`\\])*`/g, "``")
    .replace(/"(?:\\.|[^"\\\n])*"/g, '""')
    .replace(/'(?:\\.|[^'\\\n])*'/g, "''");
}

const calls = (code: string, name: string) => new RegExp(`\\b${name}\\s*\\(`).test(code);

/** True when `src` calls the declared resolver and no resolver from the OTHER seam. */
function callSiteMatches(src: string, resolver: string, honorsByom: boolean): boolean {
  const code = stripCommentsAndStrings(src);
  const forbidden = honorsByom ? PLATFORM_SEAM : ORG_SEAM;
  return calls(code, resolver) && !forbidden.some((name) => calls(code, name));
}

describe("LANE_ROUTING agrees with the real resolvers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockResolveState.mockResolvedValue({
      state: "active",
      params: { kind: "openrouter", model: "anthropic/claude-sonnet-4", apiKey: "sk-or-org" },
    });
    vi.stubEnv("LLM_PROVIDER", "openai");
    vi.stubEnv("OPENAI_API_KEY", "sk-platform-test");
    vi.stubEnv("BRIEFING_NARRATIVE", "1");
  });
  afterEach(() => vi.unstubAllEnvs());

  it.each([...LANE_IDS])("%s answers on the engine the table declares", async (lane) => {
    const expected = LANE_ROUTING[lane].honorsByom ? "openrouter" : "openai";
    expect(await RESOLVER[lane]()).toBe(expected);
  });

  it("the loader's rows name the same engine each real resolver returns, BYOM on and off", async () => {
    for (const state of ["active", "inactive"] as const) {
      if (state === "inactive") mockResolveState.mockResolvedValue({ state: "inactive" });
      const rows = (await loadLaneRouting(SLUG, null))!.current;
      for (const row of rows) expect(row.engine).toBe(await RESOLVER[row.lane]());
    }
  });

  it("routeLanes marks exactly the non-BYOM lanes as bypassing an active BYOM", () => {
    const rows = routeLanes({
      byom: { state: "active", kind: "openrouter", model: "m" },
      platform: { scan: { engine: "openai", model: "g" }, text: { engine: "openai", model: "g" } },
      briefingEnabled: true,
    });
    expect(rows.filter((r) => r.bypassesByom).map((r) => r.lane)).toEqual(LANE_IDS.filter((l) => !LANE_ROUTING[l].honorsByom));
  });
});

describe("each lane's call site uses the resolver the table declares", () => {
  it.each([...LANE_IDS])("%s", (lane) => {
    for (const site of CALL_SITES[lane]) {
      const src = readFileSync(join(process.cwd(), site.file), "utf8");
      expect(callSiteMatches(src, site.resolver, LANE_ROUTING[lane].honorsByom), site.file).toBe(true);
    }
  });

  it("seeded violations fail the check (a matcher that stops matching must not read as clean)", () => {
    const org = "runner = await resolveTextRunnerForOrg(orgSlug, { legKind: \"briefing\" });";
    expect(callSiteMatches(org, "resolveTextRunnerForOrg", true)).toBe(true);
    // The call site switched to the platform seam: the org lane now leaks to the platform vendor.
    expect(callSiteMatches(org.replace("ForOrg", ""), "resolveTextRunnerForOrg", true)).toBe(false);
    // Only prose names the org resolver: comments and strings are stripped, nothing is left to match.
    expect(callSiteMatches(`// ${org}\nconst s = "resolveTextRunnerForOrg(x)";`, "resolveTextRunnerForOrg", true)).toBe(false);
    // A platform-only lane that quietly started honouring BYOM.
    expect(callSiteMatches("await resolveTextRunnerForOrg(slug, o);", "resolveTextRunner", false)).toBe(false);
  });
});
