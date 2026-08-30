// `compare_against_exemplar` — the door's rules on top of #34's engine.
//
// The engine's own arithmetic is tested in `src/lib/report/exemplar.test.ts`; nothing here re-tests a
// gap number. What IS tested is the three things this wrapper is responsible for: the org comes from
// the token and never from an argument, a cohort is refused for a private subject, and every non-`ok`
// resolution surfaces as a sentence with no substituted exemplar.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  getOrgRollup: vi.fn(),
  getScanComparison: vi.fn(),
}));
vi.mock("@/lib/report/exemplar-load", () => ({
  resolveExemplar: vi.fn(),
  isScanEligible: vi.fn(async () => true),
  listExemplarOptions: vi.fn(async () => [{ value: "org:best", label: "best in org overall", group: "Org best", scannedAt: null }]),
  loadSubjectFacets: vi.fn(async () => ({ primaryLanguage: "TypeScript", archetype: "team" })),
}));

import { getOrgRollup, getScanComparison } from "@/lib/db";
import { resolveExemplar } from "@/lib/report/exemplar-load";
import { compareAgainstExemplar } from "./exemplar-tool";
import type { ExemplarProfile } from "@/lib/report/exemplar";

const mockRollup = vi.mocked(getOrgRollup);
const mockComparison = vi.mocked(getScanComparison);
const mockResolve = vi.mocked(resolveExemplar);

const repoRow = (over: Record<string, unknown> = {}) => ({
  fullName: "acme/api",
  owner: "acme",
  name: "api",
  isPrivate: false,
  latest: { overall: 60 },
  ...over,
});

const dim = (dimId: string, over: Record<string, unknown> = {}) => ({
  dimId,
  name: `dim ${dimId}`,
  score: 50,
  signalScore: 50,
  evidence: [] as string[],
  gaps: [] as string[],
  ...over,
});

const subjectScan = {
  id: "scan_1",
  scannedAt: "2026-08-01T00:00:00.000Z",
  overallScore: 60,
  dimensions: [dim("D3", { evidence: ["has CI"] })],
  recommendations: [],
};

const profile: ExemplarProfile = {
  key: "repo:acme/web",
  kind: "repo",
  label: "acme/web",
  repoFullName: "acme/web",
  scannedAt: "2026-08-02T00:00:00.000Z",
  overallScore: 80,
  dimensions: [dim("D3", { score: 90, signalScore: 90, evidence: ["has CI", "required checks"] })],
  population: null,
  basis: { rubric: "r11", excludesMockEngine: true, minSupport: null },
};

const text = (r: { text?: string; structuredContent: unknown }) => r.text ?? JSON.stringify(r.structuredContent);

beforeEach(() => {
  vi.clearAllMocks();
  mockRollup.mockResolvedValue({ repos: [repoRow()] } as never);
  mockComparison.mockResolvedValue({ after: subjectScan } as never);
  mockResolve.mockResolvedValue({ kind: "ok", profile });
});

describe("tenancy — the org comes from the token", () => {
  it("passes the token's org into every resolution, ignoring any org-shaped argument", async () => {
    await compareAgainstExemplar("acme", { repo: "acme/api", against: "acme/web", org: "victim-corp" });

    expect(mockResolve).toHaveBeenCalledWith(
      { kind: "repo", owner: "acme", name: "web" },
      { orgSlug: "acme", subjectFullName: "acme/api" },
    );
    // …and the subject scan is loaded org-scoped too, so a repo name shared across tenants resolves
    // inside the caller's own org or not at all.
    expect(mockComparison).toHaveBeenCalledWith("acme", "api", { orgSlug: "acme" });
  });

  it("refuses a repository that is not in the token's fleet", async () => {
    const res = await compareAgainstExemplar("acme", { repo: "other/repo", against: "org:best" });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/not in this organization's fleet/);
    expect(mockResolve).not.toHaveBeenCalled();
  });
});

describe("a private subject may not be compared against a public cohort", () => {
  it("refuses a cohort ref and never reads the corpus", async () => {
    mockRollup.mockResolvedValue({ repos: [repoRow({ isPrivate: true })] } as never);

    const res = await compareAgainstExemplar("acme", { repo: "acme/api", against: "cohort:lang:TypeScript" });

    // FAIL-BEFORE: delete the `ref.kind === "cohort" && subjectRow.isPrivate` guard in
    // exemplar-tool.ts and this flips — the tool then states a private repository's per-dimension
    // position inside a cross-tenant public distribution, which is a measurement of that repo
    // published into a frame its owner never opted into.
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/private repository/);
    expect(res.text).toMatch(/public cohort/);
    // Checked BEFORE any cohort read, so the private scores are never even placed beside the corpus.
    expect(mockResolve).not.toHaveBeenCalled();
    // The refusal is actionable: it names the two exemplars that ARE available to a private repo.
    expect(res.text).toMatch(/org:best/);
  });

  it("allows a cohort ref for a PUBLIC subject", async () => {
    mockResolve.mockResolvedValue({ kind: "ok", profile: { ...profile, kind: "cohort", repoFullName: null, population: 12 } });
    const res = await compareAgainstExemplar("acme", { repo: "acme/api", against: "cohort:lang:TypeScript" });
    expect(res.isError).toBeUndefined();
    expect(mockResolve).toHaveBeenCalled();
  });

  it("allows a repo ref for a PRIVATE subject — the rule is about the cohort, not about comparing", async () => {
    mockRollup.mockResolvedValue({ repos: [repoRow({ isPrivate: true })] } as never);
    const res = await compareAgainstExemplar("acme", { repo: "acme/api", against: "acme/web" });
    expect(res.isError).toBeUndefined();
  });
});

describe("every non-ok resolution is a stated reason, never a substitution", () => {
  it.each([
    ["not-found", /No exemplar matched/],
    ["forbidden", /not its own exemplar/],
    ["unavailable", /temporary read failure/],
  ] as const)("states %s", async (kind, pattern) => {
    mockResolve.mockResolvedValue({ kind } as never);
    const res = await compareAgainstExemplar("acme", { repo: "acme/api", against: "acme/web" });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(pattern);
    // The words that matter: nothing else was compared in its place.
    expect(text(res)).not.toContain("overallGap");
  });

  it("names the cohort floor it fell below, with the population it actually had", async () => {
    mockResolve.mockResolvedValue({ kind: "below-floor", population: 3, min: 5 });
    const res = await compareAgainstExemplar("acme", { repo: "acme/api", against: "cohort:archetype:team" });
    expect(res.text).toMatch(/3 eligible public repositories/);
    expect(res.text).toMatch(/floor of 5/);
    expect(res.text).toMatch(/no broader slice was quietly used/);
  });

  it("offers the real options on an unparseable ref instead of guessing one", async () => {
    const res = await compareAgainstExemplar("acme", { repo: "acme/api", against: "the best one" });
    expect(res.isError).toBe(true);
    expect(res.text).toMatch(/nothing was compared/);
    expect(res.text).toMatch(/org:best/);
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it("says an unscanned repository was never measured rather than scoring it zero", async () => {
    mockComparison.mockResolvedValue({ after: null } as never);
    const res = await compareAgainstExemplar("acme", { repo: "acme/api", against: "org:best" });
    expect(res.text).toMatch(/Absence of a scan is not a score/);
  });
});

describe("the answer", () => {
  it("projects the engine's diff, including the transfer list", async () => {
    const res = await compareAgainstExemplar("acme", { repo: "acme/api", against: "acme/web" });
    const sc = res.structuredContent as {
      overallGap: number;
      dimensions: { id: string; absentSignals: string[] }[];
      transfer: { dimension: string; absentSignals: string[] }[];
    };
    expect(sc.overallGap).toBe(20);
    expect(sc.dimensions[0]!.absentSignals).toEqual(["required checks"]);
    expect(sc.transfer[0]).toMatchObject({ dimension: "D3", absentSignals: ["required checks"] });
  });

  it("says so when the two sides were measured by different instruments", async () => {
    const { isScanEligible } = await import("@/lib/report/exemplar-load");
    vi.mocked(isScanEligible).mockResolvedValue(false);
    const res = await compareAgainstExemplar("acme", { repo: "acme/api", against: "acme/web" });
    // Hiding the comparison would answer a question nobody asked; hiding the MISMATCH would be the
    // dishonest half. J1's engine renders it, and the door must not drop the caveat on the way out.
    expect(text(res)).toMatch(/different instruments/);
  });
});
