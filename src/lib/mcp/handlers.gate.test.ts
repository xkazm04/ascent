// get_gate_verdict PARITY WITH THE CHECK RUN. "An agent must never be told it would pass a bar that
// CI then blocks" - so the verdict folds the repo's admission layer exactly as the merge-blocking
// check does, and a bar the rollup cannot measure is reported as skipped, never as a silent pass.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RepoAdmissionRow } from "@/lib/org/admission";

const latest = (over: Record<string, unknown> = {}) => ({
  level: "L3",
  overall: 70,
  posture: "governed",
  scannedAt: "2026-09-01T00:00:00.000Z",
  dims: [{ dimId: "D1", score: 70 }],
  protected: true,
  govReadable: true,
  aiGovernedRate: 80,
  aiPrSample: 10,
  ...over,
});
const rollup = {
  repos: [
    { fullName: "acme/a", latest: latest() },
    { fullName: "acme/c", latest: latest() },
    { fullName: "acme/plain", latest: latest() },
  ],
};

const { mockList } = vi.hoisted(() => ({ mockList: vi.fn() }));
vi.mock("@/lib/db", () => ({
  getOrgRollup: vi.fn(async () => rollup),
  getOrgRecommendations: vi.fn(),
  recallPopulation: vi.fn(),
  bumpMemoryAccessCounts: vi.fn(),
}));
vi.mock("@/lib/db/org-gate", () => ({ getOrgGatePolicy: vi.fn(async () => ({ minLevel: "L2" })) }));
vi.mock("@/lib/db/org-stance", () => ({ getActiveOrgStance: vi.fn(async () => null), getStanceRepoFacts: vi.fn(async () => []) }));
vi.mock("@/lib/db/org-admission", () => ({ getRepoAdmission: vi.fn(async () => null), listOrgAdmissions: mockList }));

const { runTool } = await import("@/lib/mcp/handlers");

const admission = (repoFullName: string, over: Partial<RepoAdmissionRow>): RepoAdmissionRow => ({
  id: "",
  repoFullName,
  stanceVersion: 0,
  derivedTier: "T3",
  grantedTier: "T3",
  mode: "assisted-only",
  decidedBy: null,
  decidedAt: null,
  rationale: "",
  rulesetId: null,
  createdAt: "",
  updatedAt: "",
  ...over,
});

type Verdict = { pass: boolean; failures: { code: string }[]; policy: string[]; skipped: { code: string; why: string }[] };
const verdict = async (repo: string) => (await runTool("get_gate_verdict", "acme", { repo })).structuredContent as Verdict;

beforeEach(() => {
  mockList.mockReset();
  mockList.mockResolvedValue([
    admission("acme/a", { derivedTier: "T2", grantedTier: "T2" }),
    admission("acme/c", { mode: "blocked" }),
  ]);
});

describe("get_gate_verdict folds admission", () => {
  it("a T2 repo at 80% AI-governed fails provenance, and the policy names the 90% row", async () => {
    const out = await verdict("acme/a");
    expect(out.pass).toBe(false);
    expect(out.failures.map((f) => f.code)).toContain("provenance");
    expect(out.policy.some((t) => t.includes("90% of AI-attributed merged PRs"))).toBe(true);
  });

  it("a blocked repo reports the unmeasurable admission bar as skipped, not a silent pass", async () => {
    const out = await verdict("acme/c");
    expect(out.skipped.map((s) => s.code)).toContain("admission");
  });

  it("a repo with no admission row is held to the org bar alone, with an empty skipped list", async () => {
    const out = await verdict("acme/plain");
    expect(out.pass).toBe(true);
    expect(out.skipped).toEqual([]);
  });

  it("an unreadable admission list refuses rather than answering against the org bar alone", async () => {
    mockList.mockRejectedValue(new Error("db down"));
    const res = await runTool("get_gate_verdict", "acme", { repo: "acme/a" });
    expect(res.isError).toBe(true);
    expect(res.text).not.toContain("—");
  });
});
