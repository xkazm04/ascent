// Skill ranking — pure, so every assertion is a fixed number rather than a moving target.
//
// The load-bearing one is the LAST describe: `dimensionBasis` must be `null` for an unscanned repo
// and never `[]`. "We looked and this repo is fine" and "we could not look" are different facts, and
// the whole product is an argument that collapsing them is the mistake worth preventing.

import { describe, expect, it } from "vitest";
import { CATEGORY_DIMENSIONS, queryTerms, rankSkills, weakDimensionsFor, type RankableSkill } from "./skill-match";
import { SKILL_CATEGORIES } from "@/lib/org/skill-categories";
import { DIMENSIONS } from "@/lib/maturity/model";

const skill = (over: Partial<RankableSkill> = {}): RankableSkill => ({
  id: "s1",
  name: "release-checklist",
  description: "How we cut a release here.",
  category: "ci-cd",
  tags: [],
  adoptionCount: 0,
  downloadCount: 0,
  registryPath: null,
  registryVersion: null,
  ...over,
});

describe("CATEGORY_DIMENSIONS", () => {
  it("covers every category in the closed set — a new category cannot be silently unmapped", () => {
    for (const c of SKILL_CATEGORIES) expect(CATEGORY_DIMENSIONS[c]).toBeDefined();
  });

  it("names only dimensions the maturity model actually has", () => {
    const known = new Set(DIMENSIONS.map((d) => d.id));
    for (const dims of Object.values(CATEGORY_DIMENSIONS)) {
      for (const d of dims) expect(known.has(d)).toBe(true);
    }
  });

  // "This category tells us nothing" is a real answer. Inventing an affinity for the catch-all
  // bucket would spray the boost across every uncategorized skill in the library.
  it("maps the catch-all category to nothing rather than to something plausible", () => {
    expect(CATEGORY_DIMENSIONS.other).toEqual([]);
  });
});

describe("queryTerms", () => {
  it("drops stop words and one/two-character noise", () => {
    expect(queryTerms("How should we do the release?")).toEqual(["release"]);
  });

  it("keeps path-shaped terms whole", () => {
    expect(queryTerms("editing src/lib/db/client.ts")).toContain("src/lib/db/client.ts");
  });
});

describe("rankSkills", () => {
  it("ranks a name match above a description-only match", () => {
    const ranked = rankSkills(
      "release",
      [skill({ id: "a", name: "release-checklist" }), skill({ id: "b", name: "tidy", description: "run before a release" })],
      { weakDims: null },
    );
    expect(ranked.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("returns nothing rather than everything when no skill matches", () => {
    // An unmatched query answered with the whole library would be worse than useless: the agent
    // would follow the first thing returned, and nothing returned actually bears on its task.
    expect(rankSkills("kubernetes", [skill()], { weakDims: null })).toEqual([]);
  });

  it("explains every result it returns", () => {
    const ranked = rankSkills("release", [skill()], { weakDims: null });
    expect(ranked[0]!.why.length).toBeGreaterThan(0);
  });

  it("is deterministic and tie-breaks stably", () => {
    const a = skill({ id: "a", name: "release-a" });
    const b = skill({ id: "b", name: "release-b" });
    const first = rankSkills("release", [a, b], { weakDims: null }).map((r) => r.id);
    const second = rankSkills("release", [b, a], { weakDims: null }).map((r) => r.id);
    expect(first).toEqual(second);
  });

  it("boosts a category whose declared dimensions the repo is weak in, and names why", () => {
    const sec = skill({ id: "sec", name: "release-hardening", category: "security" });
    const doc = skill({ id: "doc", name: "release-hardening-notes", category: "docs" });

    const neutral = rankSkills("release hardening", [sec, doc], { weakDims: null });
    const weakD9 = rankSkills("release hardening", [sec, doc], { weakDims: ["D9"] });

    expect(weakD9[0]!.id).toBe("sec");
    expect(weakD9[0]!.score).toBeGreaterThan(neutral.find((r) => r.id === "sec")!.score);
    expect(weakD9[0]!.why.join(" ")).toContain("D9");
  });

  it("adds no dimension term at all when the basis is null", () => {
    const ranked = rankSkills("release", [skill({ category: "security" })], { weakDims: null });
    expect(ranked[0]!.why.join(" ")).not.toContain("level band");
  });

  it("caps the adoption tiebreak so a popular skill cannot outrank a relevant one", () => {
    const popular = skill({ id: "pop", name: "onboarding", adoptionCount: 10_000 });
    const relevant = skill({ id: "rel", name: "release-checklist" });
    expect(rankSkills("release", [popular, relevant], { weakDims: null })[0]!.id).toBe("rel");
  });

  it("carries the registry path and version so the agent can open the source of truth", () => {
    const ranked = rankSkills("release", [skill({ registryPath: "skills/release/SKILL.md", registryVersion: "2.1" })], {
      weakDims: null,
    });
    expect(ranked[0]).toMatchObject({ registryPath: "skills/release/SKILL.md", registryVersion: "2.1" });
  });
});

describe("weakDimensionsFor", () => {
  // Against the repo's OWN band, not a fixed threshold: a fixed 60 calls every dimension of an L2
  // repo weak (true and useless) and none of an L5 repo's (hiding the one thing dragging it).
  it("names the dimensions below the floor of the repo's own level band", () => {
    // overall 70 → L4 (65-84), floor 65.
    const weak = weakDimensionsFor(70, [
      { dimId: "D1", score: 90 },
      { dimId: "D9", score: 40 },
      { dimId: "D2", score: 64 },
    ]);
    expect(weak).toEqual(["D9", "D2"]);
  });

  it("returns an EMPTY list for a repo that is not below its band anywhere", () => {
    // Empty is a measured answer here and means something different from the `null` basis the
    // caller emits for an unscanned repo — that distinction is the point of both existing.
    expect(weakDimensionsFor(70, [{ dimId: "D1", score: 90 }])).toEqual([]);
  });

  it("orders weakest first, then by id, so the explanation is stable", () => {
    const weak = weakDimensionsFor(70, [
      { dimId: "D5", score: 10 },
      { dimId: "D3", score: 10 },
      { dimId: "D8", score: 5 },
    ]);
    expect(weak).toEqual(["D8", "D3", "D5"]);
  });
});
