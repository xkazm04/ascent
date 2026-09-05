// `buildScanWarnings` is the scan pipeline's ONE honesty channel: the single place that decides what
// a reader is told about how trustworthy a score is, and (via `warningsJson`) the only part of that
// judgement which survives persistence. Every other surface — the report UI, the LLM export, the CI
// gate — reads the list it returns.
//
// It was, until this file, untested. These pin EVERY branch, in order, because the ORDER is part of
// the contract (a truncated assessment is announced before the caveats that describe the report it
// truncated; the scope caveat frames the whole report and therefore comes last).

import { describe, it, expect } from "vitest";
import { buildScanWarnings, type ScanWarningsInput } from "./scan-compose";
import type { OutputBudget } from "@/lib/llm/output-budget";
import type { StackFit } from "@/lib/analyze/stack-fit";

/** The healthy scan: a token, a real provider, a whole tree, nothing failed. Zero warnings. */
function clean(over: Partial<ScanWarningsInput> = {}): ScanWarningsInput {
  return {
    detectorWarnings: [],
    hasToken: true,
    llmFailed: false,
    providerName: "gemini",
    explicitMock: false,
    snapshotTruncated: false,
    snapshotCoverage: 1,
    stackFit: null,
    prPartial: false,
    prFetchFailed: false,
    ...over,
  };
}

const has = (ws: string[], needle: string) => ws.some((w) => w.includes(needle));

describe("buildScanWarnings — the clean baseline", () => {
  it("says nothing about a scan with nothing to caveat", () => {
    expect(buildScanWarnings(clean())).toEqual([]);
  });

  it("is pure: same facts in, same ordered list out", () => {
    const input = clean({ prPartial: true, llmFailed: true, snapshotTruncated: true });
    expect(buildScanWarnings(input)).toEqual(buildScanWarnings(input));
  });

  it("puts the detectors' own caveats first, ahead of every reliability caveat", () => {
    const ws = buildScanWarnings(clean({ detectorWarnings: ["detector said so"], llmFailed: true }));
    expect(ws[0]).toBe("detector said so");
    expect(ws).toHaveLength(2);
  });
});

describe("buildScanWarnings — the output budget (the god-scan indicator)", () => {
  const budget = (over: Partial<OutputBudget> = {}): OutputBudget => ({
    outputTokens: 60_000,
    cap: 64_000,
    usedPct: 94,
    level: "at-risk",
    capIsAssumed: false,
    ...over,
  });

  it("announces a near-ceiling assessment BEFORE any other reliability caveat", () => {
    // Ordering is the claim: truncation drops dimensions silently, so every caveat below it is
    // describing a report that may also be missing dimensions.
    const ws = buildScanWarnings(clean({ outputBudget: budget(), snapshotTruncated: true }));
    expect(ws).toHaveLength(2);
    expect(ws[1]).toContain("file tree was truncated");
    expect(ws[0]).not.toContain("file tree");
  });

  it("says nothing when the budget was not measured (null) — unmeasured is not 'comfortably small'", () => {
    expect(buildScanWarnings(clean({ outputBudget: null }))).toEqual([]);
    expect(buildScanWarnings(clean({ outputBudget: undefined }))).toEqual([]);
  });
});

describe("buildScanWarnings — the PR sensor: skipped vs FAILED vs truncated", () => {
  it("a tokenless scan says PR signals were SKIPPED (they need GraphQL auth)", () => {
    const ws = buildScanWarnings(clean({ hasToken: false }));
    expect(has(ws, "Pull-request signals were skipped")).toBe(true);
  });

  it("a token + a thrown read says the sensor FAILED — never 'this repo has no pull requests'", () => {
    const ws = buildScanWarnings(clean({ prFetchFailed: true }));
    expect(has(ws, "Pull-request ingestion FAILED")).toBe(true);
    expect(has(ws, "not a repository without pull requests")).toBe(true);
  });

  it("the keyless skip wins over the failure flag — without a token nothing was even attempted", () => {
    const ws = buildScanWarnings(clean({ hasToken: false, prFetchFailed: true }));
    expect(ws).toHaveLength(1);
    expect(has(ws, "skipped")).toBe(true);
  });

  it("a TRUNCATED PR page is its own caveat, and names the un-cached consequence", () => {
    const ws = buildScanWarnings(clean({ prPartial: true }));
    expect(has(ws, "truncated page")).toBe(true);
    expect(has(ws, "This scan was not cached.")).toBe(true);
  });

  it("failed and truncated are different facts and both get said", () => {
    const ws = buildScanWarnings(clean({ prFetchFailed: true, prPartial: true }));
    expect(ws).toHaveLength(2);
  });
});

describe("buildScanWarnings — the sensor-failure caveat (Direction 1)", () => {
  it("names every failed sensor in ONE line, in reader-facing words", () => {
    const ws = buildScanWarnings(clean({ sensorFailures: ["governance", "appInventory"] }));
    expect(ws).toHaveLength(1);
    expect(ws[0]).toContain("branch governance");
    expect(ws[0]).toContain("installed-App inventory");
    expect(ws[0]).toContain("failed reads, not controls the repository lacks");
  });

  it("covers every sensor id with a label (no raw camelCase leaks into the caveat)", () => {
    const ws = buildScanWarnings(
      clean({ sensorFailures: ["governance", "securityPosture", "securityExposure", "appInventory", "ciHealth", "deployments"] }),
    );
    expect(ws).toHaveLength(1);
    for (const raw of ["securityPosture", "securityExposure", "appInventory", "ciHealth"]) {
      expect(ws[0]).not.toContain(raw);
    }
    expect(ws[0]).toContain("deployments");
  });

  it("never double-reports the PR sensor — that one has its own dedicated caveat", () => {
    const ws = buildScanWarnings(clean({ prFetchFailed: true, sensorFailures: ["pullRequests"] }));
    expect(ws).toHaveLength(1);
    expect(has(ws, "Pull-request ingestion FAILED")).toBe(true);
  });

  it("says nothing when no sensor failed", () => {
    expect(buildScanWarnings(clean({ sensorFailures: [] }))).toEqual([]);
    expect(buildScanWarnings(clean())).toEqual([]);
  });

  it("sits after the PR caveat and before the LLM one", () => {
    const ws = buildScanWarnings(clean({ prFetchFailed: true, sensorFailures: ["ciHealth"], llmFailed: true }));
    expect(ws).toHaveLength(3);
    expect(ws[0]).toContain("Pull-request ingestion FAILED");
    expect(ws[1]).toContain("CI health");
    expect(ws[2]).toContain("AI analysis was unavailable");
  });
});

describe("buildScanWarnings — the LLM branches", () => {
  it("a runtime degrade says the AI was UNAVAILABLE", () => {
    const ws = buildScanWarnings(clean({ llmFailed: true, providerName: "mock" }));
    expect(ws).toHaveLength(1);
    expect(has(ws, "AI analysis was unavailable")).toBe(true);
  });

  it("a keyless deploy that never had a model says so plainly (not as a failure)", () => {
    const ws = buildScanWarnings(clean({ providerName: "mock" }));
    expect(has(ws, "No AI model is configured")).toBe(true);
  });

  it("an EXPLICIT mock (a demo scan) is not caveated — the caller asked for it", () => {
    expect(buildScanWarnings(clean({ providerName: "mock", explicitMock: true }))).toEqual([]);
  });

  it("a real provider that answered gets no LLM caveat at all", () => {
    expect(buildScanWarnings(clean({ providerName: "bedrock" }))).toEqual([]);
  });
});

describe("buildScanWarnings — snapshot coverage", () => {
  it("a truncated tree is announced, and SUPPRESSES the coverage line (same fact, once)", () => {
    const ws = buildScanWarnings(clean({ snapshotTruncated: true, snapshotCoverage: 0.1 }));
    expect(ws).toHaveLength(1);
    expect(has(ws, "file tree was truncated")).toBe(true);
  });

  it("thin coverage on an untruncated tree reports the percentage", () => {
    const ws = buildScanWarnings(clean({ snapshotCoverage: 0.31 }));
    expect(has(ws, "~31% coverage")).toBe(true);
  });

  it("exactly 0.5 coverage is NOT a caveat — the threshold is strict", () => {
    expect(buildScanWarnings(clean({ snapshotCoverage: 0.5 }))).toEqual([]);
  });
});

describe("buildScanWarnings — stack fit and the scope caveat", () => {
  const fit: StackFit = { stack: "ml", caveat: "This is an ML/notebook repository; the rubric under-reads it." };

  it("passes the detected stack-fit caveat through verbatim", () => {
    expect(buildScanWarnings(clean({ stackFit: fit }))).toEqual([fit.caveat]);
  });

  it("the scope caveat is emitted LAST — it frames what was scored, not how reliably", () => {
    const ws = buildScanWarnings(
      clean({ stackFit: fit, prPartial: true, llmFailed: true, scopeCaveat: "Scoped to packages/api." }),
    );
    expect(ws[ws.length - 1]).toBe("Scoped to packages/api.");
  });

  it("null / omitted scope caveat adds nothing", () => {
    expect(buildScanWarnings(clean({ scopeCaveat: null }))).toEqual([]);
    expect(buildScanWarnings(clean({ scopeCaveat: undefined }))).toEqual([]);
  });
});

describe("buildScanWarnings — every branch at once", () => {
  it("emits each caveat exactly once, in the documented order", () => {
    const ws = buildScanWarnings({
      detectorWarnings: ["detector caveat"],
      hasToken: true,
      llmFailed: true,
      providerName: "mock",
      explicitMock: false,
      snapshotTruncated: true,
      snapshotCoverage: 0.2,
      stackFit: { stack: "mobile", caveat: "mobile caveat" },
      prPartial: true,
      prFetchFailed: true,
      sensorFailures: ["governance"],
      scopeCaveat: "scope caveat",
      outputBudget: { outputTokens: 63_000, cap: 64_000, usedPct: 98, level: "at-risk", capIsAssumed: false },
    });
    // detector · budget · pr-failed · sensors · llm · truncated · stackFit · prPartial · scope
    expect(ws).toHaveLength(9);
    expect(ws[0]).toBe("detector caveat");
    expect(ws[2]).toContain("Pull-request ingestion FAILED");
    expect(ws[3]).toContain("branch governance");
    expect(ws[4]).toContain("AI analysis was unavailable");
    expect(ws[5]).toContain("file tree was truncated");
    expect(ws[6]).toBe("mobile caveat");
    expect(ws[7]).toContain("truncated page");
    expect(ws[8]).toBe("scope caveat");
  });
});
