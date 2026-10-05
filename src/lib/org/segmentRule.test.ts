// The pure half of declared segment membership: validating a rule, matching one repo against it, and
// computing drift between what the rule DECLARES and what the join table currently holds.
//
// Acceptance cases 3 and 4 of "Segments keep a rule, not a snapshot" live here, because the two rules
// that matter most are both pure:
//   - a rule may only ever reap a row it OWNS (source "rule"); a hand-tagged row is permanent
//     against it. Pinned both ways in one test so the ownership split cannot regress to
//     last-write-wins.
//   - "no rule" and "a rule with nothing to do" are DIFFERENT answers (null vs an empty drift), so
//     the Segments view can say nothing at all rather than claim a segment is in sync with a rule it
//     does not have.

import { describe, expect, it } from "vitest";
import {
  describeSegmentRule,
  matchesRule,
  normalizeSegmentRule,
  parseSegmentRule,
  segmentDrift,
  segmentRuleInputError,
  serializeSegmentRule,
  type RuleRepo,
  type SegmentMember,
} from "@/lib/org/segmentRule";

const repo = (fullName: string, language: string | null, teams: string[] = []): RuleRepo => ({
  fullName,
  language,
  teams,
});
const member = (fullName: string, source: "manual" | "rule"): SegmentMember => ({ fullName, source });

describe("segmentRuleInputError", () => {
  it("accepts a language rule and a team rule", () => {
    expect(segmentRuleInputError({ kind: "language", values: ["Python"] })).toBeNull();
    expect(segmentRuleInputError({ kind: "team", values: ["@acme/platform"] })).toBeNull();
  });
  it("rejects an unknown kind", () => {
    expect(segmentRuleInputError({ kind: "stars", values: ["x"] })).toMatch(/language|team/i);
  });
  it("rejects an empty or non-array value list instead of storing a rule that matches nothing", () => {
    expect(segmentRuleInputError({ kind: "language", values: [] })).toMatch(/at least one/i);
    expect(segmentRuleInputError({ kind: "language", values: "Python" })).toMatch(/list/i);
  });
  it("rejects a non-object body", () => {
    expect(segmentRuleInputError(null)).toMatch(/rule/i);
    expect(segmentRuleInputError("language")).toMatch(/rule/i);
  });
});

describe("normalizeSegmentRule / parseSegmentRule / serializeSegmentRule", () => {
  it("trims, de-duplicates and bounds the value list", () => {
    expect(normalizeSegmentRule({ kind: "language", values: [" Python ", "Python", "Go"] })).toEqual({
      kind: "language",
      values: ["Python", "Go"],
    });
  });
  it("returns null for input the validator rejects (never a half-built rule)", () => {
    expect(normalizeSegmentRule({ kind: "stars", values: ["x"] })).toBeNull();
    expect(normalizeSegmentRule({ kind: "language", values: ["  "] })).toBeNull();
  });
  it("round-trips through the stored JSON column", () => {
    const rule = normalizeSegmentRule({ kind: "team", values: ["@acme/platform"] });
    expect(parseSegmentRule(serializeSegmentRule(rule))).toEqual(rule);
  });
  it("reads a null / empty / malformed ruleJson column as NO rule rather than throwing", () => {
    expect(parseSegmentRule(null)).toBeNull();
    expect(parseSegmentRule("")).toBeNull();
    expect(parseSegmentRule("{not json")).toBeNull();
    expect(parseSegmentRule('{"kind":"stars","values":["x"]}')).toBeNull();
  });
});

describe("matchesRule", () => {
  const langRule = { kind: "language" as const, values: ["Python"] };
  const teamRule = { kind: "team" as const, values: ["@acme/platform"] };

  it("matches a language case-insensitively and never matches a null language", () => {
    expect(matchesRule(repo("a/py", "Python"), langRule)).toBe(true);
    expect(matchesRule(repo("a/py", "python"), langRule)).toBe(true);
    expect(matchesRule(repo("a/go", "Go"), langRule)).toBe(false);
    expect(matchesRule(repo("a/none", null), langRule)).toBe(false);
  });
  it("matches a team when the repo carries it, and not when its team list is empty", () => {
    expect(matchesRule(repo("a/x", "Go", ["@acme/platform"]), teamRule)).toBe(true);
    expect(matchesRule(repo("a/x", "Go", ["@acme/mobile"]), teamRule)).toBe(false);
    expect(matchesRule(repo("a/x", "Go", []), teamRule)).toBe(false);
  });
  it("matches ANY of several declared values (a rule is a set, not a single value)", () => {
    const multi = { kind: "language" as const, values: ["Python", "Go"] };
    expect(matchesRule(repo("a/go", "Go"), multi)).toBe(true);
  });
});

describe("segmentDrift — PURE, no DB", () => {
  // Acceptance case 4: 7 taggable repos, a rule matching 4, 2 of those already tagged.
  const repos: RuleRepo[] = [
    repo("a/py1", "Python"),
    repo("a/py2", "Python"),
    repo("a/py3", "Python"),
    repo("a/py4", "Python"),
    repo("a/go1", "Go"),
    repo("a/ts1", "TypeScript"),
    repo("a/none", null),
  ];
  const rule = { kind: "language" as const, values: ["Python"] };

  it("counts the matching-but-untagged repos as toAdd and nothing as toRemove", () => {
    const drift = segmentDrift({
      rule,
      repos,
      membership: [member("a/py1", "rule"), member("a/py2", "rule")],
    });
    expect(drift).not.toBeNull();
    expect({ toAdd: drift!.toAdd.length, toRemove: drift!.toRemove.length }).toEqual({ toAdd: 2, toRemove: 0 });
    expect(drift!.toAdd.sort()).toEqual(["a/py3", "a/py4"]);
  });

  it("returns null for a segment with NO rule — distinguishable from a rule with nothing to do", () => {
    expect(segmentDrift({ rule: null, repos, membership: [] })).toBeNull();
    // A rule whose work is done is an EMPTY drift, not null: the screen must be able to tell
    // "this segment is declared and in sync" from "this segment has no declaration at all".
    const inSync = segmentDrift({
      rule,
      repos,
      membership: ["a/py1", "a/py2", "a/py3", "a/py4"].map((f) => member(f, "rule")),
    });
    expect(inSync).toEqual({ toAdd: [], toRemove: [] });
  });

  // ── Acceptance case 3, the destructive one ──────────────────────────────────────────────────────
  // A rule may only ever reap a row it OWNS. Both halves in ONE test so a refactor cannot keep the
  // reaping half green while losing the protection half.
  it("reaps a rule-OWNED non-matching row and KEEPS a hand-tagged non-matching row", () => {
    const after: RuleRepo[] = [
      repo("a/py1", "Python"),
      repo("a/was-python", "Go"), // rule-owned, language has since flipped to Go
      repo("a/by-hand", "Ruby"), // tagged by a human, never matched the rule
    ];
    const drift = segmentDrift({
      rule,
      repos: after,
      membership: [member("a/py1", "rule"), member("a/was-python", "rule"), member("a/by-hand", "manual")],
    });
    expect(drift!.toRemove).toEqual(["a/was-python"]);
    expect(drift!.toRemove).not.toContain("a/by-hand");
    expect(drift!.toAdd).toEqual([]);
  });

  it("never reaps a rule-owned row whose repo has left the taggable universe (absence is not a mismatch)", () => {
    const drift = segmentDrift({
      rule,
      repos: [repo("a/py1", "Python")],
      membership: [member("a/py1", "rule"), member("a/archived", "rule")],
    });
    expect(drift!.toRemove).toEqual([]);
  });
});

describe("describeSegmentRule", () => {
  it("renders a short human phrase for the card, and nothing for no rule", () => {
    expect(describeSegmentRule({ kind: "language", values: ["Python"] })).toBe("language is Python");
    expect(describeSegmentRule({ kind: "team", values: ["@acme/platform", "@acme/mobile"] })).toBe(
      "team is @acme/platform or @acme/mobile",
    );
    expect(describeSegmentRule(null)).toBeNull();
  });
});
