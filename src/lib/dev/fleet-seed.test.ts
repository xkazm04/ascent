import { describe, it, expect } from "vitest";
import { curatedPublicSpecs, fleetSpecs, reportsForRepo } from "./fleet-seed";
import { isDimensionId } from "@/lib/maturity/model";

describe("fleet-seed generator", () => {
  it("reportsForRepo builds a valid, strictly-chronological, deduppable history", () => {
    const spec = fleetSpecs("acme", 1)[0]!;
    const reports = reportsForRepo(spec, 8, 12, Date.UTC(2026, 5, 25));
    expect(reports).toHaveLength(8);

    // Strictly oldest → newest so persistScanReport's head pointer lands on the latest scan.
    const times = reports.map((r) => new Date(r.scannedAt).getTime());
    for (let i = 1; i < times.length; i++) expect(times[i]!).toBeGreaterThan(times[i - 1]!);

    // Distinct head SHAs → persistScanReport keeps them as separate scans (not deduped together).
    expect(new Set(reports.map((r) => r.repo.headSha)).size).toBe(8);

    // Spans multiple calendar days, which the Trajectory forecast requires.
    expect(new Set(reports.map((r) => r.scannedAt.slice(0, 10))).size).toBeGreaterThan(1);

    for (const r of reports) {
      expect(r.overallScore).toBeGreaterThanOrEqual(0);
      expect(r.overallScore).toBeLessThanOrEqual(100);
      expect(r.dimensions).toHaveLength(9);
      expect(r.dimensions.every((d) => isDimensionId(d.id))).toBe(true);
      expect(r.dimensions.every((d) => d.score >= 0 && d.score <= 100)).toBe(true);
      expect(r.level.id).toMatch(/^L[1-5]$/);
      expect(["ai-native", "ungoverned", "manual", "early"]).toContain(r.posture.id);
      expect(r.contributors.length).toBeGreaterThanOrEqual(5);
      expect(r.roadmap.length).toBeGreaterThan(0);
      expect(r.engine.provider).toBe("mock");
      expect(r.repo.isPrivate).toBe(false);
    }
  });

  it("is deterministic (same SHAs on a re-run) so seeding is idempotent", () => {
    const spec = fleetSpecs("acme", 1)[0]!;
    const a = reportsForRepo(spec, 4, 8, 1_700_000_000_000);
    const b = reportsForRepo(spec, 4, 8, 1_700_000_000_000);
    expect(a.map((r) => r.repo.headSha)).toEqual(b.map((r) => r.repo.headSha));
  });

  it("fleetSpecs yields the requested count with unique repo names", () => {
    const specs = fleetSpecs("acme", 120);
    expect(specs).toHaveLength(120);
    expect(new Set(specs.map((s) => s.name)).size).toBe(120);
    expect(specs.every((s) => s.owner === "acme")).toBe(true);
  });

  it("curatedPublicSpecs includes the sample hero repo for the landing register", () => {
    const names = curatedPublicSpecs().map((s) => `${s.owner}/${s.name}`);
    expect(names).toContain("vercel/next.js");
  });
});
