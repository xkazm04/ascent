// Integration test for the LLM markdown export route (GET /api/report/llm?repo=owner/name[@sha]) —
// the machine-readable twin of the report header's "Copy for LLM" chip (G5-17).
//
// Two things are load-bearing here:
//
//  1. ONE GENERATOR. The route body must be `reportLlmMarkdown(report)` byte-for-byte — the REAL
//     generator, not a mock. `reportLlmMarkdown` is the same function the header's CopyForLlm chip is
//     handed (asserted from the UI end in src/components/report/ReportHeader.test.tsx, which reads the
//     exact payload back out of the manual-copy textarea). Between the two assertions, the endpoint
//     and the button are proven identical: any format edit that reached only one of them fails one of
//     the two tests.
//  2. GATE BEFORE READ. A private report's briefing is as sensitive as the report (it carries the
//     headline, dimension scores, and gaps). When requireOrgRead returns a denial, the handler must
//     return exactly that Response and never read the report.
//
// Boundaries (auth/authz/db) are mocked so we can assert exactly when the read fires. The generator is
// deliberately NOT mocked — that is the whole point of assertion (1).

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ScanReport } from "@/lib/types";

vi.mock("next/server", () => ({
  // Extends Response so BOTH `NextResponse.json(...)` and `new NextResponse(body, { headers })` work.
  NextResponse: class extends Response {
    static json(body: unknown, init?: ResponseInit) {
      const headers = new Headers(init?.headers);
      if (!headers.has("content-type")) headers.set("content-type", "application/json");
      return new Response(JSON.stringify(body), { ...init, headers });
    }
  },
}));
vi.mock("@/lib/auth", () => ({ readableOrgForOwner: vi.fn() }));
vi.mock("@/lib/authz", () => ({ requireOrgRead: vi.fn() }));
vi.mock("@/lib/db", () => ({ isDbConfigured: vi.fn(), getScanReportByCommit: vi.fn() }));

import { GET } from "./route";
import { readableOrgForOwner } from "@/lib/auth";
import { requireOrgRead } from "@/lib/authz";
import { isDbConfigured, getScanReportByCommit } from "@/lib/db";
import { reportLlmMarkdown } from "@/lib/report/llm-markdown";

const mockReadableOrg = vi.mocked(readableOrgForOwner);
const mockRequireOrgRead = vi.mocked(requireOrgRead);
const mockIsDbConfigured = vi.mocked(isDbConfigured);
const mockGetReport = vi.mocked(getScanReportByCommit);

/** A report complete enough for the real generator to render every section. */
function makeReport(over: Partial<ScanReport> = {}): ScanReport {
  return {
    repo: {
      owner: "acme",
      name: "api",
      url: "https://github.com/acme/api",
      stars: 12,
      forks: 1,
      defaultBranch: "main",
      headSha: "cafebabe0000",
      primaryLanguage: "TypeScript",
    },
    overallScore: 61,
    level: { id: "L3", name: "Practicing", band: [50, 69], tagline: "t", description: "d" },
    archetype: "team",
    adoptionScore: 58,
    rigorScore: 64,
    posture: { id: "ai-native", label: "AI-native", blurb: "b" },
    aiUsage: { detected: true, commitFraction: 0.3, signals: [] },
    contributors: [],
    dimensions: [
      {
        id: "D1",
        name: "Context Engineering",
        weight: 0.15,
        score: 70,
        signalScore: 66,
        llmScore: 74,
        summary: "Solid AGENTS.md\nwith a | pipe in it",
        evidence: [],
        strengths: ["docs"],
        gaps: ["no per-package context"],
      },
    ],
    headline: "SECRET_HEADLINE",
    strengths: ["CI is fast"],
    risks: ["thin tests"],
    roadmap: [
      {
        title: "Add eval harness",
        dimension: "D5",
        impact: "high",
        effort: "medium",
        rationale: "no regression signal",
        explore: ["what would you measure first?"],
        levelUnlock: "L3->L4",
      },
    ],
    discrepancies: [],
    confidence: 0.82,
    scannedAt: "2026-07-01T00:00:00.000Z",
    engine: { provider: "bedrock", model: "claude-sonnet-4-6", rubricVersion: "r3" },
    ...over,
  } as unknown as ScanReport;
}

const REPORT = makeReport();

const get = (repo?: string) =>
  GET(new Request(`https://x.test/api/report/llm${repo === undefined ? "" : `?repo=${encodeURIComponent(repo)}`}`));

beforeEach(() => {
  vi.clearAllMocks();
  mockIsDbConfigured.mockReturnValue(true);
  mockReadableOrg.mockResolvedValue("acme");
  mockRequireOrgRead.mockResolvedValue(null);
  mockGetReport.mockResolvedValue(REPORT);
});

describe("GET /api/report/llm — one generator (G5-17)", () => {
  it("serves EXACTLY reportLlmMarkdown(report) — the copy button's payload, byte for byte", async () => {
    const res = await get("acme/api");
    expect(res.status).toBe(200);
    // Byte equality against the real generator. The header chip is handed the same function, so this
    // is the endpoint half of the "one generator" proof (ReportHeader.test.tsx is the UI half).
    expect(await res.text()).toBe(reportLlmMarkdown(REPORT));
  });

  it("is content-typed as markdown, inline, and never cached", async () => {
    const res = await get("acme/api@cafebabe0000");
    expect(res.headers.get("content-type")).toBe("text/markdown; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe('inline; filename="ascent-acme-api-cafebab.md"');
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("sanitizes a hostile @sha before it reaches the Content-Disposition header", async () => {
    const res = await get('acme/api@a"b/../x');
    const cd = res.headers.get("content-disposition")!;
    // The whole header is one well-formed inline disposition: the sha contributed no quote, slash,
    // backslash, or newline that could close the filename or inject a second header.
    expect(cd).toMatch(/^inline; filename="ascent-acme-api-[A-Za-z0-9._-]*\.md"$/);
    const injected = cd.slice('inline; filename="ascent-acme-api-'.length, -'.md"'.length);
    expect(injected).not.toMatch(/["/\\\r\n]/);
  });
});

describe("GET /api/report/llm — access", () => {
  it("threads the gated org from readableOrgForOwner into the read", async () => {
    await get("acme/api@deadbee");
    expect(mockReadableOrg).toHaveBeenCalledWith("acme");
    expect(mockRequireOrgRead).toHaveBeenCalledWith("acme");
    const [owner, name, opts] = mockGetReport.mock.calls[0];
    expect(owner).toBe("acme");
    expect(name).toBe("api");
    expect((opts as { orgSlug?: string }).orgSlug).toBe("acme");
    expect((opts as { headSha?: string }).headSha).toBe("deadbee");
  });

  it("returns the gate's denial verbatim and NEVER reads the report", async () => {
    const denial = new Response(JSON.stringify({ error: "no access" }), { status: 403 });
    mockRequireOrgRead.mockResolvedValue(denial as never);

    const res = await get("acme/private");

    expect(res).toBe(denial);
    expect(mockGetReport).not.toHaveBeenCalled();
  });

  it("a non-member is scoped to the public org, so a private report simply isn't found", async () => {
    mockReadableOrg.mockResolvedValue("public");
    mockGetReport.mockResolvedValue(null);

    const res = await get("acme/private");

    const [, , opts] = mockGetReport.mock.calls[0];
    expect((opts as { orgSlug?: string }).orgSlug).toBe("public");
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("SECRET_HEADLINE");
  });

  it("is NOT plan-gated: it never consults credits/plan (see the route header for why)", async () => {
    // A regression that adds an entitlement check would have to import getCreditState — which is not
    // in this file's @/lib/db mock, so the module would fail to resolve it and this 200 would break.
    const res = await get("acme/api");
    expect(res.status).toBe(200);
  });
});

describe("GET /api/report/llm — failure modes", () => {
  it("503 when the DB is not configured, before anything else", async () => {
    mockIsDbConfigured.mockReturnValue(false);
    const res = await get("acme/api");
    expect(res.status).toBe(503);
    expect(mockReadableOrg).not.toHaveBeenCalled();
  });

  it("400 on a missing or malformed ?repo", async () => {
    expect((await get()).status).toBe(400);
    expect((await get("noslash")).status).toBe(400);
    expect(mockGetReport).not.toHaveBeenCalled();
  });

  it("404 (not a leak) when the repo has no saved scan", async () => {
    mockGetReport.mockResolvedValue(null);
    const res = await get("acme/api");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: "No saved scan for this repository yet. Scan it first, then export.",
    });
  });

  it("503 (not 404) when the lookup THROWS — a transient error must not read as 'never scanned'", async () => {
    mockGetReport.mockRejectedValue(new Error("token expired"));
    const res = await get("acme/api");
    expect(res.status).toBe(503);
  });
});

// The markdown is read by a model that will act on it, and it travels without the chips the page
// draws around the number — so the caveats must be IN the text.
describe("reportLlmMarkdown honesty contract", () => {
  it("declares mock provenance: no model contributed", () => {
    const md = reportLlmMarkdown(makeReport({ engine: { provider: "mock", model: "deterministic" } }));
    expect(md).toMatch(/no language model contributed/i);
    expect(md).toMatch(/deterministic signal rubric/i);
  });

  it("says nothing about demo scoring on a real LLM-scored report", () => {
    expect(reportLlmMarkdown(REPORT)).not.toMatch(/no language model contributed/i);
  });

  it("leads with an INCOMPLETE warning and tells the model not to plan from the score", () => {
    const md = reportLlmMarkdown(makeReport({ incomplete: true, dimensions: [], overallScore: 0 }));
    expect(md).toMatch(/INCOMPLETE SCAN/);
    // The caveat precedes the number it qualifies.
    expect(md.indexOf("INCOMPLETE SCAN")).toBeLessThan(md.indexOf("Overall 0/100"));
    expect(md).toMatch(/Do not plan work from the scores above/);
  });

  it("carries the scan's own warnings", () => {
    const md = reportLlmMarkdown(makeReport({ warnings: ["Coverage was low (12% of files read)."] }));
    expect(md).toContain("Coverage was low (12% of files read).");
  });

  it("renders dimensions, gaps and roadmap, escaping pipes/newlines out of table cells", () => {
    const md = reportLlmMarkdown(REPORT);
    expect(md).toContain("| D1 | Context Engineering | 70 | 15% | Solid AGENTS.md with a \\| pipe in it |");
    expect(md).toContain("- no per-package context");
    expect(md).toContain("**Add eval harness** · D5 · impact: high · effort: medium · unlocks: L3->L4");
  });

  it("is deterministic — the same report renders the same bytes (what makes the equality test mean anything)", () => {
    expect(reportLlmMarkdown(REPORT)).toBe(reportLlmMarkdown(makeReport()));
  });
});
