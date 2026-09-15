import { describe, expect, it } from "vitest";

import {
  CLAIM_QUOTE_MIN,
  COMMITS_PATH,
  D4_FACETS,
  D4_FACET_IDS,
  facetContract,
  applyVerifiedClaims,
  facetPoints,
  verifyClaims,
  type Claim,
} from "@/lib/scoring/claims";
import type { RepoSnapshot } from "@/lib/types";

function snap(files: { path: string; content: string }[], commits: string[] = []): RepoSnapshot {
  return {
    meta: { owner: "o", name: "r", url: "", stars: 0, forks: 0, defaultBranch: "main" },
    tree: files.map((f) => ({ path: f.path, type: "blob" as const })),
    files,
    commits: commits.map((message) => ({ message })),
    truncated: false,
    coverage: 1,
  };
}

const REVIEW_WF = `name: review
on:
  pull_request:
jobs:
  review:
    steps:
      - run: ./scripts/review.sh "$GITHUB_SHA"
`;

const claim = (over: Partial<Claim>): Claim => ({
  dimension: "D4",
  facet: "automated_review",
  path: ".github/workflows/review.yml",
  quote: "run: ./scripts/review.sh",
  ...over,
});

describe("the facet table — one authority", () => {
  it("sums to exactly 100, so a fully-realised practice is the ceiling", () => {
    expect(D4_FACETS.reduce((n, f) => n + f.points, 0)).toBe(100);
  });

  it("ranks the team's own review judgment above everything but the review existing at all", () => {
    // The rubric's claim in numbers: a versioned custom prompt is worth more than any single
    // operational facet other than the review itself — and a vendor config alone cannot reach green.
    const pts = Object.fromEntries(D4_FACETS.map((f) => [f.id, f.points]));
    expect(pts.custom_judgment).toBeGreaterThan(pts.review_teeth);
    expect(pts.custom_judgment).toBeGreaterThan(pts.observed);
    expect(pts.automated_review).toBeLessThan(85);
    expect(pts.automated_review + pts.dependency_automation + pts.autofix + pts.agent_dispatch).toBeLessThan(85);
  });

  it("derives the prompt contract from the table, naming every facet and no vendor", () => {
    const text = facetContract("D4");
    for (const id of D4_FACET_IDS) expect(text).toContain(id);
    expect(text).not.toMatch(/coderabbit|greptile|copilot|sweep|dependabot|renovate/i);
  });

  it("answers 0 points for a facet it does not know", () => {
    expect(facetPoints("nope")).toBe(0);
  });
});

describe("verifyClaims — existence, not interpretation", () => {
  const s = snap([{ path: ".github/workflows/review.yml", content: REVIEW_WF }]);

  it("verifies a claim whose quote is found verbatim in the sampled file", () => {
    const { verified, rejected } = verifyClaims([claim({})], s, "D4");
    expect(rejected).toEqual([]);
    expect(verified).toHaveLength(1);
    expect(verified[0]!.points).toBe(facetPoints("automated_review"));
  });

  it("is whitespace- and case-insensitive: transport is not content", () => {
    const { verified } = verifyClaims([claim({ quote: "RUN:   ./scripts/review.sh" })], s, "D4");
    expect(verified).toHaveLength(1);
  });

  it("rejects a quote that is not in the file — the fabrication this exists for", () => {
    const { verified, rejected } = verifyClaims([claim({ quote: "uses: coderabbitai/review@v2" })], s, "D4");
    expect(verified).toEqual([]);
    expect(rejected[0]!.reason).toBe("quote-not-found");
  });

  it("rejects a path the model was never shown", () => {
    const { rejected } = verifyClaims([claim({ path: ".github/workflows/other.yml" })], s, "D4");
    expect(rejected[0]!.reason).toBe("path-not-sampled");
  });

  it("rejects a quote too short to be evidence of anything", () => {
    const { rejected } = verifyClaims([claim({ quote: "on:" })], s, "D4");
    expect(rejected[0]!.reason).toBe("quote-too-short");
    expect("on:".length).toBeLessThan(CLAIM_QUOTE_MIN);
  });

  it("refuses prose as evidence of an OPERATIONAL facet", () => {
    // A README that says "we run AI review on every PR" proves nothing ran.
    const prose = snap([{ path: "README.md", content: "We run an AI review on every pull request before merge." }]);
    const { rejected } = verifyClaims([claim({ path: "README.md", quote: "We run an AI review on every pull request" })], prose, "D4");
    expect(rejected[0]!.reason).toBe("prose-evidence");
  });

  it("accepts a markdown prompt file for the JUDGMENT facet, but never the front matter", () => {
    const withRubric = snap([
      { path: "prompts/review-rubric.md", content: "# Review rubric\n\nFlag any change that widens a public API without a test." },
      { path: "README.md", content: "Flag any change that widens a public API without a test." },
    ]);
    const ok = verifyClaims(
      [claim({ facet: "custom_judgment", path: "prompts/review-rubric.md", quote: "Flag any change that widens a public API" })],
      withRubric,
      "D4",
    );
    expect(ok.verified).toHaveLength(1);
    const bad = verifyClaims(
      [claim({ facet: "custom_judgment", path: "README.md", quote: "Flag any change that widens a public API" })],
      withRubric,
      "D4",
    );
    expect(bad.rejected[0]!.reason).toBe("prose-evidence");
  });

  it("cites a BEHAVIORAL facet from the commit sample only", () => {
    const withTrail = snap([], ["fix: address review-bot findings on the auth handler", "chore: bump deps"]);
    const ok = verifyClaims(
      [claim({ facet: "observed", path: COMMITS_PATH, quote: "address review-bot findings" })],
      withTrail,
      "D4",
    );
    expect(ok.verified).toHaveLength(1);
    // A file cannot evidence that something RAN.
    const fromFile = verifyClaims(
      [claim({ facet: "observed", path: ".github/workflows/review.yml", quote: "run: ./scripts/review.sh" })],
      s,
      "D4",
    );
    expect(fromFile.rejected[0]!.reason).toBe("path-not-sampled");
  });

  it("awards a facet once — the second claim for it is a duplicate, whichever came first", () => {
    const { verified, rejected } = verifyClaims([claim({}), claim({ quote: "on:\n  pull_request:" })], s, "D4");
    expect(verified).toHaveLength(1);
    expect(rejected[0]!.reason).toBe("duplicate-facet");
  });

  it("ignores claims for another dimension and for a facet it does not know", () => {
    const { rejected } = verifyClaims([claim({ dimension: "D1" }), claim({ facet: "vibes" })], s, "D4");
    expect(rejected.map((r) => r.reason)).toEqual(["not-this-dimension", "unknown-facet"]);
  });

  it("never throws on garbage", () => {
    const junk = [{}, null, { dimension: "D4" }, { dimension: "D4", facet: "observed", path: 1, quote: [] }] as unknown as Claim[];
    expect(() => verifyClaims(junk, s, "D4")).not.toThrow();
  });
});

describe("applyVerifiedClaims — a trail is a trail OF something", () => {
  const v = (facet: string, points = facetPoints(facet)) =>
    ({ dimension: "D4" as const, facet, path: "x", quote: "quote long enough", points });

  it("refuses an observed trail when no mechanism is evidenced anywhere", () => {
    // The first live r9 run: one tagged commit subject, in a repo with no review, no fix step and
    // no dispatch. A real quote, and still not evidence that automation ran.
    const out = applyVerifiedClaims([v("observed")], [], "D4");
    expect(out.points).toBe(0);
    expect(out.unsupported.map((u) => u.reason)).toEqual(["unsupported-trail"]);
  });

  it("awards the trail once the mechanism is evidenced by the detector", () => {
    const out = applyVerifiedClaims([v("observed")], ["automated_review"], "D4");
    expect(out.points).toBe(facetPoints("observed"));
  });

  it("awards the trail when the mechanism arrives as a verified claim in the SAME assessment", () => {
    // Table order is dependency order: automated_review settles before observed is judged.
    const out = applyVerifiedClaims([v("observed"), v("automated_review")], [], "D4");
    expect(out.awarded.map((a) => a.facet)).toEqual(["automated_review", "observed"]);
    expect(out.points).toBe(facetPoints("automated_review") + facetPoints("observed"));
  });

  it("treats a claim on a detected facet as confirmation, not points", () => {
    const out = applyVerifiedClaims([v("dependency_automation")], ["dependency_automation"], "D4");
    expect(out.points).toBe(0);
    expect(out.confirmed).toHaveLength(1);
  });
});
