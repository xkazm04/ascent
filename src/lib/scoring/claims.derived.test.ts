// A citation that resolves to a DERIVED document verifies nothing (D1 commands_agree).
//
// commands_agree pays for two guidance files that state the same command, because an agent gets one
// answer whichever file it opened. When one of the two files is a generated projection of the other,
// the agreement is a property of the generator, not evidence about the repository: both quotes
// resolve, both are verbatim, and the pair proves only that the copy step ran once. These tests pin
// that a derived pair awards nothing on either path (model claim or deterministic detector), while
// two independently written files still do.

import { describe, expect, it } from "vitest";
import { analyzeSignals } from "@/lib/analyze";
import { renderProjection } from "@/lib/analyze/guidance-projection";
import { applyVerifiedClaims, verifyClaims, type Claim } from "@/lib/scoring/claims";
import type { RepoSnapshot } from "@/lib/types";

const CANON = "# Conventions\n\nRun `npm test` before pushing.\nKeep modules small.\n";
const PROJECTED = renderProjection({ sourcePath: "CLAUDE.md", sourceBody: CANON });
// A projection whose body moved on from its source (hand-edited or stale) but still carries the
// command it inherited from the generator.
const DRIFTED = PROJECTED.replace("Keep modules small.", "Keep modules small and typed.");
const INDEPENDENT = "Tests: run `npm test` locally first. Prefer small pull requests.\n";

const snapOf = (files: Record<string, string>): RepoSnapshot =>
  ({
    meta: {},
    tree: Object.keys(files).map((path) => ({ path, type: "blob" })),
    files: Object.entries(files).map(([path, content]) => ({ path, content, bytes: content.length })),
    commits: [],
    truncated: false,
    coverage: 1,
  }) as unknown as RepoSnapshot;

const claim = (path2: string, quote2: string): Claim => ({
  dimension: "D1",
  facet: "commands_agree",
  path: "CLAUDE.md",
  quote: "Run `npm test` before pushing.",
  path2,
  quote2,
});

const claimPoints = (snap: RepoSnapshot, c: Claim): number => {
  const allowed = new Set(snap.files.map((f) => f.path));
  const { verified } = verifyClaims([c], snap, "D1", { allowedPaths: allowed });
  return applyVerifiedClaims(verified, [], "D1").points;
};

const d1Facets = (snap: RepoSnapshot): string[] =>
  analyzeSignals(snap, "2026-09-16T00:00:00Z").find((s) => s.id === "D1")?.facets ?? [];

describe("commands_agree over a derived pair", () => {
  it("POSITIVE CONTROL: two independently written files agreeing award the facet on both paths", () => {
    const snap = snapOf({ "CLAUDE.md": CANON, ".cursorrules": INDEPENDENT });
    expect(claimPoints(snap, claim(".cursorrules", "Tests: run `npm test` locally first."))).toBe(6);
    expect(d1Facets(snapOf({ "CLAUDE.md": CANON, ".cursorrules": INDEPENDENT }))).toContain("commands_agree");
  });

  it("a model claim citing a source and its in-sync projection awards nothing", () => {
    const snap = snapOf({ "CLAUDE.md": CANON, "AGENTS.md": PROJECTED });
    expect(claimPoints(snap, claim("AGENTS.md", "Run `npm test` before pushing."))).toBe(0);
  });

  it("a model claim citing a source and its drifted projection awards nothing", () => {
    const snap = snapOf({ "CLAUDE.md": CANON, "AGENTS.md": DRIFTED });
    expect(claimPoints(snap, claim("AGENTS.md", "Run `npm test` before pushing."))).toBe(0);
  });

  it("the detector does not count a drifted projection as an independent agreeing document", () => {
    expect(d1Facets(snapOf({ "CLAUDE.md": CANON, "AGENTS.md": DRIFTED }))).not.toContain("commands_agree");
  });
});
