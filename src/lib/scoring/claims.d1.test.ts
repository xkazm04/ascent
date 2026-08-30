// The D1 half of the claim suite (rubric r11). Split from claims.test.ts so neither file grows past
// the point where a reader stops reading; that file remains the r9/D4 regression pin.

import { describe, expect, it } from "vitest";
import {
  ALL_FACET_IDS,
  CLAIM_SCORED_DIMENSIONS,
  D1_FACETS,
  FACETS_BY_DIMENSION,
  applyVerifiedClaims,
  facetContract,
  facetSpec,
  verifyClaims,
  type Claim,
} from "@/lib/scoring/claims";
import type { RepoSnapshot } from "@/lib/types";

const AGENTS = "# Agents\n\nRun the suite with npm test before pushing.\nNever commit generated files.\n";
const CURSOR = "Tests: npm test. Read AGENTS.md for the real conventions.\n";
const DESIGN = "# Design notes\n\nRun the suite with npm test before pushing.\n";

const snap = (): RepoSnapshot =>
  ({
    meta: {},
    tree: [],
    files: [
      { path: "AGENTS.md", content: AGENTS, bytes: AGENTS.length },
      { path: ".cursorrules", content: CURSOR, bytes: CURSOR.length },
      { path: "docs/DESIGN.md", content: DESIGN, bytes: DESIGN.length },
    ],
    commits: [],
    truncated: false,
    coverage: 1,
  }) as unknown as RepoSnapshot;

const GUIDANCE = new Set(["AGENTS.md", ".cursorrules"]);

const claim = (over: Partial<Claim>): Claim => ({
  dimension: "D1",
  facet: "commands_agree",
  path: "AGENTS.md",
  quote: "Run the suite with npm test before pushing",
  path2: ".cursorrules",
  quote2: "Tests: npm test. Read AGENTS.md",
  ...over,
});

describe("the D1 facet table", () => {
  it("is registered for D1 and reachable through the flat enum", () => {
    expect(CLAIM_SCORED_DIMENSIONS).toContain("D1");
    expect(FACETS_BY_DIMENSION.D1).toBe(D1_FACETS);
    for (const f of D1_FACETS) expect(ALL_FACET_IDS).toContain(f.id);
  });

  it("uses NO facet id twice across dimensions — the flat lookup depends on it", () => {
    expect(new Set(ALL_FACET_IDS).size).toBe(ALL_FACET_IDS.length);
  });

  it("scores `contradiction` at zero — evidence, never a penalty (G4/G5)", () => {
    expect(facetSpec("D1", "contradiction")!.points).toBe(0);
    // And nothing in D1's table is negative: a contradiction WITHHOLDS points, it never subtracts.
    for (const f of D1_FACETS) expect(f.points).toBeGreaterThanOrEqual(0);
  });

  it("teaches the contract from the table, naming every D1 facet and no vendor product", () => {
    const text = facetContract("D1");
    for (const f of D1_FACETS) expect(text).toContain(f.id);
    expect(text).toContain("CITE TWO FILES");
    expect(text).not.toMatch(/coderabbit|greptile|sweep/i);
  });
});

describe("verifyClaims — the guidance-file allowlist", () => {
  it("verifies a two-citation claim across two guidance files", () => {
    const { verified, rejected } = verifyClaims([claim({})], snap(), "D1", { allowedPaths: GUIDANCE });
    expect(rejected).toEqual([]);
    expect(verified).toHaveLength(1);
    expect(verified[0]!.points).toBe(6);
  });

  it("rejects a claim citing a non-guidance markdown file, even though the quote is really there", () => {
    const out = verifyClaims([claim({ path: "docs/DESIGN.md" })], snap(), "D1", { allowedPaths: GUIDANCE });
    expect(out.verified).toEqual([]);
    expect(out.rejected[0]!.reason).toBe("not-guidance-file");
  });

  it("rejects a two-citation facet that arrived with one citation", () => {
    const out = verifyClaims([claim({ path2: undefined, quote2: undefined })], snap(), "D1", { allowedPaths: GUIDANCE });
    expect(out.rejected[0]!.reason).toBe("missing-second-citation");
  });

  it("rejects two citations that name the SAME file — one document cannot evidence agreement", () => {
    const out = verifyClaims(
      [claim({ path2: "AGENTS.md", quote2: "Never commit generated files" })],
      snap(),
      "D1",
      { allowedPaths: GUIDANCE },
    );
    expect(out.rejected[0]!.reason).toBe("missing-second-citation");
  });

  it("rejects a second quote that is not in its file", () => {
    const out = verifyClaims([claim({ quote2: "Tests are run by a small committee" })], snap(), "D1", {
      allowedPaths: GUIDANCE,
    });
    expect(out.rejected[0]!.reason).toBe("quote-not-found");
  });

  it("an EMPTY allowlist rejects everything rather than opening the door", () => {
    const out = verifyClaims([claim({})], snap(), "D1", { allowedPaths: new Set<string>() });
    expect(out.rejected[0]!.reason).toBe("not-guidance-file");
  });
});

describe("multi — four contradictions survive, the fifth does not", () => {
  const contradiction = (quote: string): Claim =>
    claim({ facet: "contradiction", quote2: "Tests: npm test. Read AGENTS.md", quote });

  it("keeps up to `multi` claims and rejects the surplus as duplicate-facet", () => {
    const quotes = [
      "Run the suite with npm test before pushing",
      "Never commit generated files",
      "# Agents\n\nRun the suite with npm test",
      "npm test before pushing.\nNever commit",
      "Run the suite with npm test before",
    ];
    const out = verifyClaims(quotes.map(contradiction), snap(), "D1", { allowedPaths: GUIDANCE });
    expect(facetSpec("D1", "contradiction")!.multi).toBe(4);
    expect(out.verified).toHaveLength(4);
    expect(out.rejected.map((r) => r.reason)).toEqual(["duplicate-facet"]);
  });

  it("a verified contradiction is applied as evidence and awards nothing", () => {
    const { verified } = verifyClaims([contradiction("Never commit generated files")], snap(), "D1", {
      allowedPaths: GUIDANCE,
    });
    const applied = applyVerifiedClaims(verified, [], "D1");
    expect(applied.awarded).toHaveLength(1);
    expect(applied.points).toBe(0);
  });
});
