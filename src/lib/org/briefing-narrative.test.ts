// G5-03 — the ONE LLM-written paragraph in a board-facing document. The whole value of this module
// is its guarantees, so this file pins them rather than the prose:
//   1. OFF unless a deployment opts in — no network I/O by default.
//   2. NEVER a number the briefing doesn't already state (the load-bearing one).
//   3. ALWAYS degrades to deterministic copy: unconfigured, non-2xx, refusal, timeout, malformed,
//      markdown, or ungrounded — every path ends in a usable paragraph, never an error or an empty
//      string.
// A regression here puts an invented figure in front of a board.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// briefing.ts imports the @/lib/db barrel at module load; stub it so this stays hermetic. Only the
// pure serializer (briefingMarkdown) is exercised through it.
vi.mock("@/lib/db", () => ({
  getOrgRollup: vi.fn(),
  getOrgBenchmark: vi.fn(),
  getOrgMovers: vi.fn(),
  getOrgRecommendations: vi.fn(),
  listGoals: vi.fn(),
}));
vi.mock("@/lib/db/org", () => ({
  getOrgEngineMix: vi.fn(async () => []),
  getOrgRecsActioned: vi.fn(async () => ({ engaged: 0, actioned: 0 })),
}));

import type { ExecBriefing } from "./briefing";
import {
  allowedNumbers,
  attachBriefingNarrative,
  briefingNarrativeEnabled,
  deterministicNarrative,
  figuresByReferent,
  isGrounded,
  referentGrounded,
  isWellFormedNarrative,
  narrativeFacts,
  numericTokens,
  writeBriefingNarrative,
} from "./briefing-narrative";

const briefing: ExecBriefing = {
  org: "acme",
  periodTitle: "last 90 days",
  generatedOn: "2026-07-28",
  maturity: { overall: 62, levelId: "L3", levelName: "Managed", adoption: 58, rigor: 66 },
  coverage: { scanned: 8, total: 12 },
  periodDelta: 4,
  priorPeriod: null,
  forecastHeadline: "On track to reach L4 in 6 weeks.",
  forecastConfidence: 80,
  engineMix: [],
  adoptionRate: 58,
  movement: { up: 5, down: 2, compared: 8 },
  valueRealized: { recsEngaged: 0, recsActioned: 0, pointsMoved: 4, reposPromoted: 0 },
  benchmark: { percentile: 71, corpusRepos: 240, corpusAvgOverall: 54, cohort: null },
  strengths: [{ dimId: "D2", label: "Testing", avg: 80 }],
  risks: [{ dimId: "D9", label: "Security", avg: 41 }],
  security: { dimId: "D9", label: "Security", avg: 41 },
  topGainers: [],
  topRegressions: [],
  goals: [],
  regressionCount: 0,
  recommendations: [
    {
      title: "Add a dependency-scanning workflow",
      dimId: "D9",
      impact: "high",
      rationale: "",
      explore: [],
      repoCount: 6,
      repos: ["api"],
      leverage: 9.9,
      projectedPoints: 7,
      liftsRepos: 2,
    },
  ],
  narrative: null,
};

/** A response body in the provider's success shape. */
function ok(text: string) {
  return {
    ok: true,
    json: async () => ({ stop_reason: "end_turn", content: [{ type: "text", text }] }),
  } as unknown as Response;
}

const ENV_KEYS = ["BRIEFING_NARRATIVE", "ANTHROPIC_API_KEY", "BRIEFING_NARRATIVE_TIMEOUT_MS"] as const;
const savedEnv: Record<string, string | undefined> = {};

function enable() {
  process.env.BRIEFING_NARRATIVE = "1";
  process.env.ANTHROPIC_API_KEY = "test-key";
}

beforeEach(() => {
  for (const k of ENV_KEYS) {
    savedEnv[k] = process.env[k];
    delete process.env[k];
  }
  vi.restoreAllMocks();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.restoreAllMocks();
});

// ── The kill switch ────────────────────────────────────────────────────────────────────────────

describe("briefingNarrativeEnabled — opt-in, and only with a key", () => {
  it("is false with no configuration at all (the default everywhere, including CI)", () => {
    expect(briefingNarrativeEnabled()).toBe(false);
  });

  it("is false with the flag but no key, and with a key but no flag", () => {
    process.env.BRIEFING_NARRATIVE = "1";
    expect(briefingNarrativeEnabled()).toBe(false);
    delete process.env.BRIEFING_NARRATIVE;
    process.env.ANTHROPIC_API_KEY = "test-key";
    expect(briefingNarrativeEnabled()).toBe(false);
  });

  it("is true only when both are set", () => {
    enable();
    expect(briefingNarrativeEnabled()).toBe(true);
  });
});

// ── The deterministic floor ────────────────────────────────────────────────────────────────────

describe("deterministicNarrative — a usable paragraph with no model involved", () => {
  it("states the standing, benchmark, movement and widest gap from the briefing's own fields", () => {
    const text = deterministicNarrative(briefing);
    expect(text).toContain("8 of 12 repositories scanned");
    expect(text).toContain("62/100 overall (L3 Managed)");
    expect(text).toContain("up 4 points over the period");
    expect(text).toContain("71th percentile");
    expect(text).toContain("5 improved and 2 regressed");
    expect(text).toContain("Add a dependency-scanning workflow");
  });

  it("is itself grounded — it can never be the source of an invented figure", () => {
    expect(isGrounded(deterministicNarrative(briefing), allowedNumbers(briefing))).toBe(true);
  });

  it("survives a sparse briefing (no benchmark, no movement, no forecast, no recommendations)", () => {
    const sparse: ExecBriefing = {
      ...briefing,
      benchmark: null,
      forecastHeadline: null,
      movement: { up: 0, down: 0, compared: 0 },
      periodDelta: null,
      recommendations: [],
    };
    const text = deterministicNarrative(sparse);
    expect(text.length).toBeGreaterThan(0);
    expect(text).not.toContain("undefined");
    expect(text).not.toContain("NaN");
    expect(text).not.toContain("null");
    expect(isGrounded(text, allowedNumbers(sparse))).toBe(true);
  });
});

// ── The grounding gate ─────────────────────────────────────────────────────────────────────────

describe("isGrounded — no number the briefing doesn't already state", () => {
  const facts = narrativeFacts(briefing);
  const allowed = allowedNumbers(briefing);

  it("accepts prose that reuses the briefing's figures", () => {
    expect(isGrounded("Overall maturity is 62 of 100, across 8 of 12 repositories.", allowed)).toBe(true);
  });

  it("accepts prose with no numbers at all", () => {
    expect(isGrounded("The fleet is holding steady and security remains the widest gap.", allowed)).toBe(true);
  });

  it("rejects an invented figure — the exact hallucination that must never reach a board", () => {
    expect(isGrounded("Maturity rose to 62, roughly 19% above last year.", allowed)).toBe(false);
  });

  it("rejects a DERIVED figure the model computed itself (a ratio the briefing never states)", () => {
    // 8/12 is in the data; "67%" is arithmetic the model did, and is exactly the kind of plausible
    // number that reads as authoritative and can be subtly wrong.
    expect(isGrounded("Coverage stands at 67% of the fleet.", allowed)).toBe(false);
  });

  it("compares tokens, not values — 4 does not license 4.5", () => {
    expect(isGrounded("The fleet moved 4.5 points.", allowed)).toBe(false);
  });

  it("`narrativeFacts` excludes the trailing Ask (an instruction, not a fact)", () => {
    expect(facts).toContain("## Standing");
    expect(facts).not.toContain("## Ask");
  });

  it("numericTokens picks up decimals and bare integers", () => {
    expect(numericTokens("62/100 and 4.5 and none")).toEqual(["62", "100", "4.5"]);
  });
});

describe("isWellFormedNarrative — shape and safety before grounding", () => {
  const body = "a".repeat(200);
  it("accepts plain prose of a sane length", () => {
    expect(isWellFormedNarrative(body)).toBe(true);
  });
  it("rejects empty / too-short and runaway output", () => {
    expect(isWellFormedNarrative("")).toBe(false);
    expect(isWellFormedNarrative("Short.")).toBe(false);
    expect(isWellFormedNarrative("a".repeat(5_000))).toBe(false);
  });
  it("rejects angle brackets (leaked internal tags / injected markup)", () => {
    expect(isWellFormedNarrative(`<thinking>${body}`)).toBe(false);
  });
  it("rejects markdown structure — the renderers print plain prose", () => {
    expect(isWellFormedNarrative(`## Summary\n${body}`)).toBe(false);
    expect(isWellFormedNarrative(`- point one\n${body}`)).toBe(false);
    expect(isWellFormedNarrative(`1. point one\n${body}`)).toBe(false);
  });
});

// ── The provider path ──────────────────────────────────────────────────────────────────────────

describe("writeBriefingNarrative — provider path and its fallbacks", () => {
  it("makes NO network call and returns the deterministic paragraph when disabled", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    expect(await writeBriefingNarrative(briefing)).toBe(deterministicNarrative(briefing));
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns the model's prose when it is well-formed and grounded", async () => {
    enable();
    const prose =
      "Acme stands at 62 out of 100 overall, with 8 of the 12 repositories scanned. " +
      "Adoption is 58 and rigor is 66, and the fleet sits in the 71th percentile of the benchmark corpus. " +
      "The widest shared gap is dependency scanning, present across 6 repositories.";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(ok(prose));

    expect(await writeBriefingNarrative(briefing)).toBe(prose);
  });

  it("sends ONLY the briefing's own figures as context (no other data reaches the provider)", async () => {
    enable();
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(ok("x".repeat(200)));
    await writeBriefingNarrative(briefing);

    const body = JSON.parse((fetchSpy.mock.calls[0]![1] as { body: string }).body) as {
      model: string;
      temperature?: number;
      top_p?: number;
      messages: { content: string }[];
    };
    expect(body.messages[0]!.content).toContain(narrativeFacts(briefing));
    // Sampling params are rejected on this model family — they must never be sent.
    expect(body.temperature).toBeUndefined();
    expect(body.top_p).toBeUndefined();
  });

  // Every failure mode lands on the same floor.
  const failures: [string, () => void][] = [
    ["the request rejects (network/timeout/abort)", () => void vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("boom"))],
    [
      "the provider returns a non-2xx",
      () => void vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: false, json: async () => ({}) } as unknown as Response),
    ],
    [
      "the provider refuses (200 with stop_reason: refusal)",
      () =>
        void vi.spyOn(globalThis, "fetch").mockResolvedValue({
          ok: true,
          json: async () => ({ stop_reason: "refusal", content: [] }),
        } as unknown as Response),
    ],
    [
      "the body is malformed (no content blocks)",
      () => void vi.spyOn(globalThis, "fetch").mockResolvedValue({ ok: true, json: async () => ({}) } as unknown as Response),
    ],
    ["the text is empty", () => void vi.spyOn(globalThis, "fetch").mockResolvedValue(ok("   "))],
    ["the output is markdown-structured", () => void vi.spyOn(globalThis, "fetch").mockResolvedValue(ok(`## Summary\n${"a".repeat(200)}`))],
    ["the output leaks tags", () => void vi.spyOn(globalThis, "fetch").mockResolvedValue(ok(`<thinking>${"a".repeat(200)}`))],
  ];

  for (const [label, arrange] of failures) {
    it(`falls back to deterministic copy when ${label}`, async () => {
      enable();
      arrange();
      expect(await writeBriefingNarrative(briefing)).toBe(deterministicNarrative(briefing));
    });
  }

  it("DISCARDS an otherwise-perfect narrative that invents a number", async () => {
    enable();
    // Fluent, confident, board-ready — and "19%" appears nowhere in the briefing. This is the case
    // the whole module exists to prevent.
    const hallucinated =
      "Acme stands at 62 out of 100 overall, an improvement of 19% year over year that puts it " +
      "comfortably ahead of its peer group and on a clear path to the next maturity level.";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(ok(hallucinated));

    const out = await writeBriefingNarrative(briefing);
    expect(out).not.toContain("19%");
    expect(out).toBe(deterministicNarrative(briefing));
  });

  it("whatever it returns is grounded — the invariant, asserted over every outcome", async () => {
    enable();
    const allowed = allowedNumbers(briefing);
    for (const text of ["The fleet holds at 62 out of 100 across 8 repositories, with security the widest gap remaining today.", "Maturity climbed 31 points this quarter, a 44% gain over the prior period, which is a strong result overall."]) {
      vi.spyOn(globalThis, "fetch").mockResolvedValue(ok(text));
      expect(isGrounded(await writeBriefingNarrative(briefing), allowed)).toBe(true);
    }
  });
});

describe("attachBriefingNarrative — the deliverable opt-in", () => {
  it("returns a copy with the narrative set, leaving the source briefing untouched", async () => {
    const attached = await attachBriefingNarrative(briefing);
    expect(attached.narrative).toBe(deterministicNarrative(briefing));
    expect(briefing.narrative).toBeNull();
    expect(attached.maturity).toEqual(briefing.maturity);
  });

  it("never throws and never yields an empty narrative, even when the provider explodes", async () => {
    enable();
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("provider down"));
    const attached = await attachBriefingNarrative(briefing);
    expect(attached.narrative).toBeTruthy();
  });
});

// ── Referent integrity (grounded-number-referent #16) ──────────────────────────────────────────
// Membership in the allowed set was the WHOLE gate: a figure that genuinely appears in the briefing
// but is attached to the wrong dimension passed it. Overall is 62 and Security is 41 in this fixture,
// so "security scored 62" is the exact defect — every number true, the sentence false.

describe("referentGrounded — a figure must belong to the subject it stands next to", () => {
  const pad = (s: string) => `${s} ${"The fleet continues to be reviewed by its platform group. ".repeat(2)}`;

  it("rejects one dimension's prose carrying another subject's figure (the #16 defect)", () => {
    const swapped = "Security scored 62 across the fleet this period.";
    // It passes the old gate — which is precisely why the old gate was not enough.
    expect(isGrounded(swapped, allowedNumbers(briefing))).toBe(true);
    expect(referentGrounded(swapped, briefing)).toBe(false);
  });

  it("rejects the swap in either direction and at either side of the figure", () => {
    expect(referentGrounded("Security fell to 62 this period.", briefing)).toBe(false);
    expect(referentGrounded("A reading of 62 on security is the fleet's weakest.", briefing)).toBe(false);
    expect(referentGrounded("Adoption stands at 66 for the period.", briefing)).toBe(false); // 66 is rigor
  });

  it("accepts the same sentences with each figure on its own subject", () => {
    expect(referentGrounded("Security scored 41 across the fleet this period.", briefing)).toBe(true);
    expect(referentGrounded("The fleet stands at 62/100 overall, with AI Adoption at 58 and Engineering Rigor at 66.", briefing)).toBe(true);
    expect(referentGrounded("Testing leads the fleet at 80/100.", briefing)).toBe(true);
    expect(referentGrounded("That is the 71th percentile against 240 benchmarked repositories.", briefing)).toBe(true);
  });

  it("leaves un-homed figures (repo counts, corpus size, forecast horizon) to the membership gate", () => {
    // 240 and 12 belong to no subject in figuresByReferent, so the referent gate says nothing about
    // them — isGrounded is what vouches for those.
    expect(referentGrounded("Across 8 of 12 repositories the corpus average is 54.", briefing)).toBe(true);
    expect(figuresByReferent(briefing).has("security")).toBe(true);
    expect([...(figuresByReferent(briefing).get("overall") ?? [])]).toContain("62");
  });

  it("does not read a level or dimension id as a quantity", () => {
    // "L3" beside "overall" must not bind a stray 3 to the overall score, and D9 likewise.
    expect(referentGrounded("The fleet is L3 Managed on overall standing.", briefing)).toBe(true);
    expect(referentGrounded("D9 Security sits at 41 this period.", briefing)).toBe(true);
  });

  it("does not bind a figure across a sentence boundary", () => {
    expect(referentGrounded("Nothing changed for security. 62 repositories remain in scope.", briefing)).toBe(true);
  });

  it("keeps the deterministic fallback clean — the safe path must clear the new gate", () => {
    expect(referentGrounded(deterministicNarrative(briefing), briefing)).toBe(true);
  });

  it("says nothing about a subject the briefing does not report on", () => {
    // Drop every dimension: "security" is no longer a known subject, so the gate has no opinion about
    // a figure standing beside it. Silence, not a guess — the same posture as an un-homed figure.
    const noDims = { ...briefing, strengths: [], risks: [], security: null } as ExecBriefing;
    expect(figuresByReferent(noDims).has("security")).toBe(false);
    expect(referentGrounded("Security scored 62.", noDims)).toBe(true);
  });

  it("falls back when the model returns a referent-swapped narrative, and keeps a correct one", async () => {
    enable();
    const swapped = pad("Security scored 62 across the fleet, its weakest reading of the period.");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(ok(swapped));
    expect(await writeBriefingNarrative(briefing)).toBe(deterministicNarrative(briefing));

    vi.restoreAllMocks();
    const correct = pad("Security scored 41 across the fleet, its weakest reading of the period.");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(ok(correct));
    expect(await writeBriefingNarrative(briefing)).toBe(correct.trim());
  });
});
