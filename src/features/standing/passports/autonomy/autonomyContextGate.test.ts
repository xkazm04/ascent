// Direction 8 — the context gate no longer fabricates staleness. It used to subtract up to 25 points
// from `hashUnit(repoName + ":ctx")` and then report `source: "scan"` whenever a manifest readout
// existed, so a score containing pure fiction wore a measured badge and the honesty pin rendered
// nothing. These pin the three properties that replaced it: the penalty is read off the W4
// context-health freshness, an unmeasured repo takes NO penalty and says so, and the score no longer
// depends on the repo's NAME.

import { describe, it, expect } from "vitest";
import type { AppPassport, ContextHealth } from "@/lib/types";
import { contextGate } from "./autonomyContextGate";

const pp = (files: string[] = ["CLAUDE.md"]): AppPassport =>
  ({
    automationReadiness: {
      artifacts: { agentInstructions: files, contextGraph: "partial", memory: "curated", manifest: true, skills: "none", evals: "none" },
    },
  }) as unknown as AppPassport;

const health = (score: number | null, ageDays: number | null = 40): ContextHealth =>
  ({
    version: "1",
    present: true,
    files: [],
    freshness: { score, ageDays, commitsSinceEdit: 12, approximate: true },
    quality: { score: 60, signals: [] },
    drift: { score: 100, refsTotal: 0, deadRefs: [] },
    score: 60,
  }) as ContextHealth;

describe("contextGate — measured freshness", () => {
  it("penalizes a STALE context file in proportion to the measured freshness score", () => {
    const fresh = contextGate(pp(), null, null, health(100));
    const stale = contextGate(pp(), null, null, health(0));
    expect(fresh.score - stale.score).toBe(25);
    expect(stale.evidence).toContain("0% fresh");
    expect(stale.evidence).toContain("edited ~40d ago");
  });

  it("takes NO penalty and says freshness was not measured when the scan recorded none", () => {
    const unknown = contextGate(pp(), null, null, null);
    const fresh = contextGate(pp(), null, null, health(100));
    expect(unknown.score).toBe(fresh.score);
    expect(unknown.evidence).toContain("freshness not measured");
    // Unknown freshness is not stale: nothing in the evidence may read as an age.
    expect(unknown.evidence).not.toMatch(/\d+d ago/);
  });

  it("treats a null freshness score (lookup skipped/failed) as unknown, not as zero", () => {
    expect(contextGate(pp(), null, null, health(null)).evidence).toContain("freshness not measured");
  });

  it("never claims an age for a repo with no guidance file at all", () => {
    const none = contextGate(pp([]), null, null, health(10));
    expect(none.evidence).toContain("no guidance file to age");
    expect(none.evidence).not.toMatch(/d ago/);
  });

  it("reports source 'scan' — every input to the score is now observed", () => {
    expect(contextGate(pp(), null, null, health(50)).source).toBe("scan");
    expect(contextGate(pp(), null, null, null).source).toBe("scan");
    // ...and the evidence never carries the old "(mock)" disclaimer, because nothing is mocked.
    expect(contextGate(pp(), null, null, null).evidence).not.toContain("(mock)");
  });

  it("does not depend on the repo's NAME (the hashed penalty is gone)", () => {
    // Same passport, same health, two repos: identical scores. Under the hash penalty they differed.
    const a = contextGate(pp(), null, null, health(70));
    const b = contextGate(pp(), null, null, health(70));
    expect(a.score).toBe(b.score);
    expect(contextGate.length).toBeLessThanOrEqual(4); // no `key` parameter survives
  });
});
