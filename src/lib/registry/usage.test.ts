// The usage lane, from ascent's side: what it reads, and what it must not destroy.
//
// Ascent does NOT count invocations. The installations that run skills count
// locally and contribute an aggregate (one `usage/<contributor>.json` each);
// ascent sums what they published. Two writers for one number is the failure the
// per-contributor files exist to prevent, so every assertion here is about
// reading faithfully and writing nothing it does not own.

import { describe, expect, it } from "vitest";

import { buildCatalog, type RegistryCatalog } from "./catalog";
import { aggregateUsage } from "./index-registry";
import { isUsageFile } from "./index-walk";

const file = (path: string, doc: unknown) => ({ path, text: JSON.stringify(doc) });

const contribution = (contributor: string, skills: Record<string, number>) => ({
  schema: "rkb-usage/1",
  contributor,
  app: "personas",
  generatedAt: "2026-08-19T12:00:00Z",
  windowDays: 30,
  skills: Object.fromEntries(Object.entries(skills).map(([k, v]) => [k, { invokes: v }])),
});

describe("isUsageFile", () => {
  it("takes usage/<contributor>.json and nothing else", () => {
    expect(isUsageFile("usage/dev-box.json")).toBe(true);
    // A README or a nested stray in the lane is not a contribution.
    expect(isUsageFile("usage/README.md")).toBe(false);
    expect(isUsageFile("usage/nested/dev-box.json")).toBe(false);
    expect(isUsageFile("usage")).toBe(false);
    expect(isUsageFile("skills/x/SKILL.md")).toBe(false);
  });
});

describe("aggregateUsage", () => {
  it("sums across contributors, per skill and in total", () => {
    const warnings: string[] = [];
    const usage = aggregateUsage(
      [
        file("usage/dev-box.json", contribution("dev-box", { perfect: 10, uat: 2 })),
        file("usage/team-a.json", contribution("team-a", { perfect: 5 })),
      ],
      warnings,
    );
    expect(usage.bySkill).toEqual({ perfect: 15, uat: 2 });
    expect(usage.invokes30d).toBe(17);
    expect(usage.contributors).toBe(2);
    expect(warnings).toEqual([]);
  });

  it("reports nobody-reporting as zero contributors, not zero usage", () => {
    // The distinction the UI depends on: an empty lane means no witness, which
    // is a different fact from a fleet that runs nothing.
    const usage = aggregateUsage([], []);
    expect(usage).toEqual({ invokes30d: 0, contributors: 0, bySkill: {} });
  });

  it("degrades ONE malformed contribution, never the pass", () => {
    const warnings: string[] = [];
    const usage = aggregateUsage(
      [
        { path: "usage/broken.json", text: "{not json" },
        file("usage/dev-box.json", contribution("dev-box", { perfect: 4 })),
      ],
      warnings,
    );
    expect(usage.bySkill).toEqual({ perfect: 4 });
    expect(usage.contributors).toBe(1);
    expect(warnings.some((w) => w.includes("usage/broken.json"))).toBe(true);
  });

  it("ignores a non-count without dropping the rest of that contributor", () => {
    const warnings: string[] = [];
    const usage = aggregateUsage(
      [
        file("usage/dev-box.json", {
          ...contribution("dev-box", { perfect: 3 }),
          skills: { perfect: { invokes: 3 }, bogus: { invokes: "many" }, negative: { invokes: -2 } },
        }),
      ],
      warnings,
    );
    expect(usage.bySkill).toEqual({ perfect: 3 });
    expect(usage.invokes30d).toBe(3);
    expect(warnings).toHaveLength(2);
  });

  it("skips an unreadable blob without counting it as a contributor", () => {
    const usage = aggregateUsage([{ path: "usage/x.json", text: null }], []);
    expect(usage.contributors).toBe(0);
  });
});

describe("buildCatalog — foreign keys", () => {
  const base = { fullName: "acme/ai-registry", defaultBranch: "main", canonical: true, mode: "git-native", telemetry: "off" };

  it("carries forward keys it does not own", () => {
    // `bundles` belongs to the registry's OWN generator (scripts/build-catalog.mjs)
    // for the knowledge lane. Rebuilding the envelope and committing it without
    // this would erase 105 subjects' worth of index.
    const previous = {
      schema: "ascent-registry-catalog",
      bundles: [{ name: "software-engineering", subjects: 105 }],
      somethingFuture: { any: "shape" },
    } as unknown as RegistryCatalog;

    const next = buildCatalog({ ...base, previous });
    expect(next.bundles).toEqual([{ name: "software-engineering", subjects: 105 }]);
    expect(next.somethingFuture).toEqual({ any: "shape" });
  });

  it("never lets a foreign key shadow one it owns", () => {
    const previous = {
      schema: "hijacked",
      counts: { skills: 999, practices: 999, memory: 999, lessons: 999 },
      skills: [{ name: "ghost" }],
    } as unknown as RegistryCatalog;

    const next = buildCatalog({ ...base, previous, skills: [] });
    expect(next.schema).toBe("ascent-registry-catalog");
    expect(next.counts.skills).toBe(0);
    expect(next.skills).toEqual([]);
  });

  it("is unchanged when there is no previous catalog", () => {
    const next = buildCatalog({ ...base });
    expect(next.schema).toBe("ascent-registry-catalog");
    expect(next.bundles).toBeUndefined();
  });
});
