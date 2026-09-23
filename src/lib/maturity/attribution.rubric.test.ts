// @vitest-environment node
//
// THE SIXTH WAY A NUMBER MOVES: the ruler changed. A rubric bump re-scores every repository, so a
// before/after pair scored under two different rubric versions measures the bump, not the repository.
// attribution.ts is the one place the loop decides whether a movement may be called a lift; these
// cases pin that it refuses a provably cross-rubric pair, that an UNKNOWN rubric refuses nothing (the
// same rule the base check applies), and that the three modules which used to hand-roll their own
// rubric equality now all ask the one predicate.
//
// The source guard at the bottom strips comments and string literals before matching, and a seeded
// violation proves it still bites.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  attributeDelivered,
  attributeDimension,
  attributeScores,
  attributionChip,
  attributionLabel,
  MOCK_ENGINE,
  sameRuler,
} from "./attribution";

const end = (rubricVersion: string | null, overallScore = 60, engineProvider = "claude-cli") => ({
  engineProvider,
  rubricVersion,
  overallScore,
});

describe("attribution refuses a cross-rubric pair", () => {
  it("attributeScores: r17 -> r18, +10 is not a lift, it is the rubric", () => {
    expect(attributeScores(end("r17", 60), end("r18", 70))).toEqual({ kind: "unmeasured", reason: "rubric" });
  });

  it("attributeDelivered: the same pair with 3 commits is still refused (the lane lift adds nothing)", () => {
    expect(attributeDelivered(end("r17", 60), end("r18", 70), 3)).toEqual({ kind: "unmeasured", reason: "rubric" });
  });

  it("attributeDimension: a D4 movement across r12 -> r13 is refused", () => {
    expect(
      attributeDimension("D4", 15, { engineProvider: "claude-cli", rubricVersion: "r12" }, { engineProvider: "claude-cli", rubricVersion: "r13" }),
    ).toEqual({ kind: "unmeasured", reason: "rubric" });
  });

  it("labels and chips name the rubric, not a missing scan", () => {
    const v = { kind: "unmeasured", reason: "rubric" } as const;
    expect(attributionLabel(v)).toBe("not comparable: the two scans were scored under different rubrics");
    expect(attributionChip(v)).toBe("different rubrics");
  });

  it("sameRuler: equal is true, different is false, unknown is null", () => {
    expect(sameRuler("r18", "r18")).toBe(true);
    expect(sameRuler("r17", "r18")).toBe(false);
    expect(sameRuler(null, "r18")).toBeNull();
    expect(sameRuler("r18", undefined)).toBeNull();
  });
});

describe("guards: what the rubric rule must NOT refuse or reorder", () => {
  it("guard: a same-rubric real pair past the band is attributable, unchanged", () => {
    expect(attributeScores(end("r18", 60), end("r18", 70))).toEqual({ kind: "attributable", delta: 10 });
  });

  it("guard: an unknown rubric on one end refuses nothing (unknown is not different)", () => {
    expect(attributeScores(end(null, 60), end("r18", 70))).toEqual({ kind: "attributable", delta: 10 });
    expect(attributeScores({ engineProvider: "claude-cli", overallScore: 60 }, end("r18", 70))).toEqual({ kind: "attributable", delta: 10 });
  });

  it("guard: a diverged base still wins over a rubric difference", () => {
    expect(attributeScores(end("r17", 60), end("r18", 70), "diverged")).toEqual({ kind: "unmeasured", reason: "base" });
  });

  it("guard: a same-rubric mock pair is still a mock-scan verdict with its degraded flag", () => {
    const before = { ...end("r18", 60, MOCK_ENGINE), engineDegraded: true };
    expect(attributeScores(before, end("r18", 70))).toEqual({ kind: "mock-scan", delta: 10, degraded: true });
  });
});

// ── The source guard: one rubric predicate, not three copies ──────────────────────────────────────

/** Drop comments and string/template literals (same scanner shape as alert-door.contract.test.ts). */
function stripCommentsAndStrings(src: string): string {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i]!;
    const next = src[i + 1];
    if (c === "/" && next === "/") {
      while (i < n && src[i] !== "\n") i++;
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      i++;
      while (i < n && src[i] !== quote) {
        if (src[i] === "\\") i++;
        i++;
      }
      i++;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

/** A rubric compared by `===`/`!==` (either operand naming a rubric), after stripping. */
const RUBRIC_EQUALITY = /rubric[\w?.]*\s*[!=]==?(?!=)|[!=]==?\s*[\w?.]*rubric/i;

function rubricVerdict(src: string): { callsSameRuler: boolean; inlineEquality: boolean } {
  const code = stripCommentsAndStrings(src);
  return { callsSameRuler: /\bsameRuler\s*\(/.test(code), inlineEquality: RUBRIC_EQUALITY.test(code) };
}

const THREE = ["src/lib/db/outcomes.ts", "src/lib/org/skill-outcomes.ts", "src/lib/scan-alerts.ts"];

describe("the three rubric checks ask sameRuler", () => {
  it.each(THREE)("%s calls sameRuler and compares no rubric inline", (path) => {
    const v = rubricVerdict(readFileSync(join(process.cwd(), path), "utf8"));
    expect(v).toEqual({ callsSameRuler: true, inlineEquality: false });
  });

  it("guard: the matcher still bites on a seeded violation, and ignores prose and strings", () => {
    expect(rubricVerdict("if (prevRubric && prevRubric !== freshRubric) return;").inlineEquality).toBe(true);
    expect(rubricVerdict("if (before.rubricVersion !== after.rubricVersion) return null;").inlineEquality).toBe(true);
    expect(rubricVerdict("const ok = x === before.rubricVersion;").inlineEquality).toBe(true);
    expect(rubricVerdict("// prevRubric !== freshRubric\nconst s = 'a.rubricVersion === b';").inlineEquality).toBe(false);
    expect(rubricVerdict("if (!before.rubricVersion) return null; sameRuler(a, b);")).toEqual({ callsSameRuler: true, inlineEquality: false });
  });
});
