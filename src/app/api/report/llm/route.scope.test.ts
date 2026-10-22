// export-1 (challenge-2026-10-22d): GET /api/report/llm?dims= and measured lifts. The route composes
// the briefing through composeBriefing (the composer's own call), so the endpoint and the chip cannot
// disagree about a scope; lifts are read only under the org the door gated, never more.

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DimensionId, ScanReport } from "@/lib/types";
import type { LiftDistribution } from "@/lib/outcomes/aggregate";

vi.mock("next/server", () => ({
  NextResponse: class extends Response {
    static json(body: unknown, init?: ResponseInit) {
      return new Response(JSON.stringify(body), { ...init, headers: { "content-type": "application/json" } });
    }
  },
}));
vi.mock("@/lib/api/respond", () => ({ reportHandledError: vi.fn() }));
vi.mock("@/lib/auth", () => ({ readableOrgForOwner: vi.fn(async () => "acme") }));
vi.mock("@/lib/authz", () => ({ requireOrgRead: vi.fn(async () => null), canReadOrg: vi.fn(async () => false) }));
vi.mock("@/lib/db", () => ({ isDbConfigured: () => true, getScanReportByCommit: vi.fn() }));
vi.mock("@/lib/outcomes/expected-lift-load", () => ({ EMPTY_LIFTS: new Map(), getOrgExpectedLifts: vi.fn() }));

import { GET } from "./route";
import { requireOrgRead } from "@/lib/authz";
import { readableOrgForOwner } from "@/lib/auth";
import { getScanReportByCommit } from "@/lib/db";
import { getOrgExpectedLifts } from "@/lib/outcomes/expected-lift-load";
import { reportLlmMarkdown } from "@/lib/report/llm-markdown";
import { recommendationMatchKey } from "@/lib/report/rec-identity";
import { composeBriefing } from "@/lib/report/briefing-scope";

const IDS = ["D1", "D3", "D9"] as DimensionId[];
const REPORT = {
  repo: { owner: "acme", name: "app", url: "https://github.com/acme/app", stars: 1, forks: 0, defaultBranch: "main", headSha: "sha" },
  overallScore: 55,
  level: { id: "L3", name: "Practicing", band: [50, 69], tagline: "t", description: "d" },
  archetype: "team",
  adoptionScore: 50,
  rigorScore: 60,
  posture: { id: "ai-native", label: "AI-native", blurb: "b" },
  aiUsage: { detected: false, commitFraction: 0, signals: [] },
  contributors: [],
  dimensions: IDS.map((id) => ({ id, name: `Dim ${id}`, weight: 0.3, score: 40, summary: `s-${id}`, evidence: [], strengths: [], gaps: [`gap-${id}`] })),
  headline: "h",
  strengths: [],
  risks: [],
  roadmap: IDS.map((id) => ({ title: `Fix ${id}`, dimension: id, impact: "high", effort: "low", rationale: `why-${id}` })),
  discrepancies: [],
  confidence: 0.8,
  scannedAt: "2026-10-01T00:00:00.000Z",
  engine: { provider: "bedrock", model: "m" },
} as unknown as ScanReport;

const key = recommendationMatchKey("D3", "Fix D3");
const LIFTS = new Map<string, LiftDistribution>([[key, {
  identityKey: key, dimId: "D3", n: 12, orgs: 1, medianDim: 6, p25: 3, p75: 9, medianOverall: 2,
  instrument: { rubricVersion: "r10", engineProvider: "bedrock" },
}]]);

const get = (qs: string) => GET(new Request(`https://x.test/api/report/llm?repo=${encodeURIComponent("acme/app@sha")}${qs}`));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireOrgRead).mockResolvedValue(null);
  vi.mocked(readableOrgForOwner).mockResolvedValue("acme");
  vi.mocked(getScanReportByCommit).mockResolvedValue(REPORT);
  vi.mocked(getOrgExpectedLifts).mockResolvedValue(new Map());
});

describe("GET /api/report/llm?dims=", () => {
  it("serves the scoped briefing the composer copies for the same selection", async () => {
    const res = await get("&dims=D3");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toBe(composeBriefing(REPORT, ["D3"], new Map()));
    expect(body).toContain("> Scoped briefing: 1 of 3 dimensions (D3).");
    expect(body).not.toContain("gap-D9");
  });

  it("an unknown dimension is a 400, never a silent whole-report widening", async () => {
    const res = await get("&dims=D99");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Unknown dimension: D99" });
  });

  it("guard: no ?dims and no lifts is byte-identical to reportLlmMarkdown(report)", async () => {
    expect(await (await get("")).text()).toBe(reportLlmMarkdown(REPORT));
  });
});

describe("GET /api/report/llm - measured lifts under the gated org", () => {
  it("a roadmap item the org's ledger measured carries the measured clause", async () => {
    vi.mocked(getOrgExpectedLifts).mockResolvedValue(LIFTS);
    const body = await (await get("")).text();
    expect(getOrgExpectedLifts).toHaveBeenCalledWith("acme");
    expect(body).toContain("   - _measured:_ D3 +6 median");
    expect(body).toBe(reportLlmMarkdown(REPORT, { lifts: LIFTS }));
  });

  it("a ?org hint that moved the read elsewhere carries no lifts (the page never showed them)", async () => {
    const { canReadOrg } = await import("@/lib/authz");
    vi.mocked(canReadOrg).mockResolvedValueOnce(true);
    vi.mocked(getOrgExpectedLifts).mockResolvedValue(LIFTS);
    const body = await (await get("&org=rebrand")).text();
    expect(getOrgExpectedLifts).not.toHaveBeenCalled();
    expect(body).toBe(reportLlmMarkdown(REPORT));
  });

  it("a failed lift read degrades to the unmeasured briefing", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.mocked(getOrgExpectedLifts).mockRejectedValue(new Error("ledger down"));
    const res = await get("");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe(reportLlmMarkdown(REPORT));
  });

  it("guard: a denied private repo issues no lift read", async () => {
    const denial = new Response("{}", { status: 401 });
    vi.mocked(requireOrgRead).mockResolvedValue(denial as never);
    const res = await get("&dims=D3");
    expect(res).toBe(denial);
    expect(getOrgExpectedLifts).not.toHaveBeenCalled();
    expect(getScanReportByCommit).not.toHaveBeenCalled();
  });
});
