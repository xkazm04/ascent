// Regression tests for the assessment-validation honesty fix (scan-and-decide idea 3f8ac320):
// a dimension that arrives without a real numeric score must be SKIPPED, not coerced to 0, so
// the isAssessmentUsable coverage gate can't be fooled by a model that returns ids but no scores.
//
// Also (test-mastery-2026-06-18, llm-provider-abstraction finding #2 — PROVIDER layer): each
// provider must attribute usage for the result IT actually produced, mapping its OWN native token
// field names onto the canonical TokenUsage { inputTokens, outputTokens } metering shape — and the
// keyless/degraded MockProvider must attribute NO real tokens. scan.test.ts pins the orchestration
// (report.usage == the *used* provider's tokens); this file pins the layer beneath it that the
// orchestration trusts. See the usage-attribution describe blocks at the bottom of this file.

import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { validateAssessment, isAssessmentUsable } from "./provider";
import type { AssessOptions, LLMProvider, LlmScoreInput } from "@/lib/llm/provider";
import type { TokenUsage } from "@/lib/types";

// @google/genai mock for the Gemini usage-attribution suite. Mirrors what GeminiProvider reads:
// response.text + response.usageMetadata (promptTokenCount / candidatesTokenCount = Gemini's NATIVE
// field names). vi.mock is hoisted, so this governs the dynamic import("./gemini") below.
const genai = vi.hoisted(() => ({
  generateContent: vi.fn<(args: unknown) => Promise<unknown>>(),
}));
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: genai.generateContent };
  },
}));

describe("validateAssessment — score coercion (#1)", () => {
  it("keeps a genuine 0 score", () => {
    const a = validateAssessment({ dimensions: [{ id: "D1", score: 0 }] });
    expect(a.dimensions).toHaveLength(1);
    expect(a.dimensions[0]).toMatchObject({ id: "D1", score: 0 });
  });

  it("skips a dimension whose score field is missing (was silently coerced to 0)", () => {
    const a = validateAssessment({ dimensions: [{ id: "D1", summary: "no score here" }] });
    expect(a.dimensions).toHaveLength(0);
  });

  it("skips a dimension with a non-numeric score", () => {
    expect(validateAssessment({ dimensions: [{ id: "D2", score: "n/a" }] }).dimensions).toHaveLength(0);
    expect(validateAssessment({ dimensions: [{ id: "D2", score: null }] }).dimensions).toHaveLength(0);
    expect(validateAssessment({ dimensions: [{ id: "D2", score: "" }] }).dimensions).toHaveLength(0);
  });

  it("accepts a numeric string score", () => {
    expect(validateAssessment({ dimensions: [{ id: "D3", score: "75" }] }).dimensions[0]).toMatchObject({
      id: "D3",
      score: 75,
    });
  });

  it("clamps an out-of-range numeric score", () => {
    expect(validateAssessment({ dimensions: [{ id: "D1", score: 250 }] }).dimensions[0].score).toBe(100);
    expect(validateAssessment({ dimensions: [{ id: "D1", score: -5 }] }).dimensions[0].score).toBe(0);
  });

  it("still drops unknown dimension ids", () => {
    expect(validateAssessment({ dimensions: [{ id: "D99", score: 50 }] }).dimensions).toHaveLength(0);
  });
});

describe("isAssessmentUsable — coverage gate honesty (#1)", () => {
  it("rejects an all-missing-score reply that previously slipped through as zeros", () => {
    // 9 valid ids, every one missing its score. Before the fix each became a real 0 and counted
    // toward coverage, so this passed the gate and rendered the deterministic floor as 'AI'.
    const raw = { dimensions: Array.from({ length: 9 }, (_, i) => ({ id: `D${i + 1}` })) };
    const a = validateAssessment(raw);
    expect(a.dimensions).toHaveLength(0);
    expect(isAssessmentUsable(a, 9)).toBe(false);
  });

  it("accepts a reply that scores at least half the requested dimensions", () => {
    const raw = { dimensions: Array.from({ length: 9 }, (_, i) => ({ id: `D${i + 1}`, score: 60 })) };
    const a = validateAssessment(raw);
    expect(a.dimensions).toHaveLength(9);
    expect(isAssessmentUsable(a, 9)).toBe(true);
  });

  it("treats genuine zeros as real coverage", () => {
    const raw = { dimensions: Array.from({ length: 9 }, (_, i) => ({ id: `D${i + 1}`, score: 0 })) };
    expect(isAssessmentUsable(validateAssessment(raw), 9)).toBe(true);
  });
});

// ===========================================================================
// Usage / token attribution at the PROVIDER layer (finding #2).
// Invariant: a provider attributes usage for the result IT produced, re-keying its native token
// fields onto the canonical { inputTokens, outputTokens } shape (the metering basis scan.ts
// persists on report.usage); a failed call attributes nothing; the mock provider attributes ZERO.
// ===========================================================================

// A parseable, usable assessment (9/9 dims) so validateAssessment accepts it — keeps the focus on
// usage attribution, not the coverage gate.
const USABLE_JSON = JSON.stringify({
  dimensions: ["D1", "D2", "D3", "D4", "D5", "D6", "D7", "D8", "D9"].map((id) => ({
    id,
    score: 70,
    summary: `${id} ok`,
  })),
  headline: "AI-written headline",
  strengths: [],
  risks: [],
  roadmap: [],
  discrepancies: [],
});

const usageInput: LlmScoreInput = {
  repo: {
    owner: "acme",
    name: "rocket",
    url: "https://github.com/acme/rocket",
    stars: 1,
    forks: 0,
    defaultBranch: "main",
    headSha: "sha-1",
  },
  signals: [
    { id: "D1", signalScore: 50, signals: [] },
    { id: "D2", signalScore: 60, signals: [] },
  ],
  files: [],
  commitSample: [],
  archetype: "team",
};

/** Capture every onUsage call so we can assert exactly one, with the right shape. */
function usageRecorder() {
  const calls: TokenUsage[] = [];
  const onUsage = (u: TokenUsage) => calls.push(u);
  return { calls, onUsage };
}

describe("provider usage attribution", () => {
  beforeEach(() => {
    vi.stubEnv("GEMINI_MODEL", "");
    vi.stubEnv("OPENAI_MODEL", "");
    vi.stubEnv("OPENAI_BASE_URL", "");
    vi.stubEnv("LLM_TIMEOUT_MS", "60000");
    genai.generateContent.mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe("GeminiProvider.assess — attributes its OWN usage in the canonical shape", () => {
    it("maps Gemini's promptTokenCount/candidatesTokenCount onto { inputTokens, outputTokens }", async () => {
      const { GeminiProvider } = await import("./gemini");
      genai.generateContent.mockResolvedValue({
        text: USABLE_JSON,
        usageMetadata: { promptTokenCount: 4096, candidatesTokenCount: 512 },
      });
      const provider: LLMProvider = new GeminiProvider("test-key");
      const { calls, onUsage } = usageRecorder();

      const a = await provider.assess(usageInput, { onUsage });

      expect(provider.name).toBe("gemini");
      expect(a.dimensions.length).toBeGreaterThan(0); // genuinely produced this result
      // ATTRIBUTION INVARIANT: exactly one usage report, carrying THIS provider's real tokens,
      // re-keyed onto the metering-basis field shape scan.ts persists on report.usage.
      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual({ inputTokens: 4096, outputTokens: 512 });
    });

    it("does NOT fabricate token counts when the model omits usage metadata", async () => {
      const { GeminiProvider } = await import("./gemini");
      genai.generateContent.mockResolvedValue({ text: USABLE_JSON }); // no usageMetadata
      const provider = new GeminiProvider("test-key");
      const { calls, onUsage } = usageRecorder();

      await provider.assess(usageInput, { onUsage });

      // Still attributed to THIS call's result, but with undefined counts — never invented numbers.
      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual({ inputTokens: undefined, outputTokens: undefined });
    });

    it("attributes NO usage when the call produces no result (empty response throws first)", async () => {
      const { GeminiProvider } = await import("./gemini");
      genai.generateContent.mockResolvedValue({ text: "", usageMetadata: { promptTokenCount: 9 } });
      const provider = new GeminiProvider("test-key");
      const { calls, onUsage } = usageRecorder();

      await expect(provider.assess(usageInput, { onUsage })).rejects.toThrow();
      // No result produced ⇒ no tokens billed (onUsage fires only after a non-empty response).
      expect(calls).toHaveLength(0);
    });
  });

  describe("OpenAiProvider.assess — attributes its OWN usage in the canonical shape", () => {
    it("maps OpenAI's prompt_tokens/completion_tokens onto { inputTokens, outputTokens }", async () => {
      const { OpenAiProvider } = await import("./openai");
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          choices: [{ message: { content: USABLE_JSON } }],
          usage: { prompt_tokens: 321, completion_tokens: 123 },
        }),
      });
      vi.stubGlobal("fetch", fetchMock);

      const provider: LLMProvider = new OpenAiProvider({ apiKey: "sk-test" });
      const { calls, onUsage } = usageRecorder();

      const a = await provider.assess(usageInput, { onUsage });

      expect(provider.name).toBe("openai");
      expect(a.dimensions.length).toBeGreaterThan(0);
      // ATTRIBUTION INVARIANT: this provider's native usage names re-keyed onto the metering basis.
      expect(calls).toHaveLength(1);
      expect(calls[0]).toEqual({ inputTokens: 321, outputTokens: 123 });
    });

    it("attributes NO usage when the request fails (non-ok response throws before onUsage)", async () => {
      const { OpenAiProvider } = await import("./openai");
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => "rate limited",
      });
      vi.stubGlobal("fetch", fetchMock);

      const provider = new OpenAiProvider({ apiKey: "sk-test" });
      const { calls, onUsage } = usageRecorder();

      await expect(provider.assess(usageInput, { onUsage })).rejects.toThrow();
      // A failed attempt produced no result ⇒ none of its (would-be) tokens are attributed.
      expect(calls).toHaveLength(0);
    });
  });

  describe("MockProvider.assess — a mock/degraded result attributes NO real tokens", () => {
    it("never calls onUsage, so a mock result can't carry a real provider's token counts", async () => {
      const { MockProvider } = await import("./mock");
      const provider: LLMProvider = new MockProvider();
      const onUsage = vi.fn<(u: TokenUsage) => void>();

      // Fresh repo identity so the mock's internal LRU cache can't short-circuit before onUsage.
      const a = await provider.assess(
        { ...usageInput, repo: { ...usageInput.repo, headSha: "mock-no-usage-1" } },
        { onUsage } satisfies AssessOptions,
      );

      expect(provider.name).toBe("mock");
      expect(a.dimensions.length).toBe(usageInput.signals.length); // it really produced this result
      // HONESTY INVARIANT: the keyless/degraded provider reports ZERO usage. Paired with scan.ts
      // stamping report.usage = { ...capturedUsage }, a mock scan therefore carries no input/output
      // tokens — a real provider's name can never sit atop mock tokens.
      expect(onUsage).not.toHaveBeenCalled();
    });
  });
});

// ===========================================================================
// Model-output HARDENING GUARDS in validateAssessment (test-mastery-2026-06-18,
// llm-provider-abstraction finding #3 — HIGH). validateAssessment is pure and NEVER throws, so it is
// the runtime safety net against a hallucinated / prompt-injected reply. These tests feed crafted,
// hostile model output and pin each guard the suite was previously blind to:
//   - cap()            : every model-supplied string is bounded to MAX_FIELD_LEN (2000) chars.
//   - asStringArray()  : an oversize array is capped (and pre-sliced so a hostile array can't force a
//                        million-element transient allocation); non-strings/blanks are dropped.
//   - dimension de-dupe: duplicate valid ids collapse to one (first score wins); input is bounded.
//   - validLevelUnlock : levelUnlock is ONLY ever a strict, in-range (L1..L5) ADVANCE — never a
//                        downgrade or an out-of-range / garbage value reaching the user-facing roadmap.
// Invariants: every string <= MAX_FIELD_LEN, every array <= its max, dimensions unique, a malformed
// payload yields the documented EMPTY-but-well-formed assessment (never a half-valid score-poisoner).
//
// MAX_FIELD_LEN / array caps mirror the source (provider.ts) — kept as local consts so a refactor that
// loosens the source bound makes these assertions FAIL rather than silently drift.
const MAX_FIELD_LEN = 2000;
const MAX_ARRAY = 6; // asStringArray default `max` for strengths/risks/dimension strengths/gaps
const MAX_EXPLORE = 3; // roadmap.explore uses asStringArray(_, 3)

describe("validateAssessment — string field caps (#3)", () => {
  it("caps a multi-megabyte headline at MAX_FIELD_LEN", () => {
    const a = validateAssessment({ headline: "x".repeat(50_000) });
    expect(a.headline.length).toBeLessThanOrEqual(MAX_FIELD_LEN);
    expect(a.headline.length).toBe(MAX_FIELD_LEN); // truncated, not dropped
  });

  it("caps a dimension's summary and trims before capping", () => {
    const a = validateAssessment({
      dimensions: [{ id: "D1", score: 50, summary: `   ${"y".repeat(5000)}   ` }],
    });
    expect(a.dimensions).toHaveLength(1);
    expect(a.dimensions[0].summary.length).toBeLessThanOrEqual(MAX_FIELD_LEN);
    expect(a.dimensions[0].summary.length).toBe(MAX_FIELD_LEN);
    expect(a.dimensions[0].summary.startsWith("y")).toBe(true); // surrounding whitespace trimmed first
  });

  it("caps every capped string field: dimension strengths/gaps, roadmap rationale, discrepancy claim", () => {
    const big = "z".repeat(9000);
    const a = validateAssessment({
      dimensions: [{ id: "D1", score: 50, strengths: [big], gaps: [big] }],
      roadmap: [{ title: big, dimension: "D1", rationale: big }],
      discrepancies: [{ dimension: "D2", claim: big }],
    });
    expect(a.dimensions[0].strengths[0].length).toBe(MAX_FIELD_LEN);
    expect(a.dimensions[0].gaps[0].length).toBe(MAX_FIELD_LEN);
    expect(a.roadmap[0].title.length).toBe(MAX_FIELD_LEN);
    expect(a.roadmap[0].rationale.length).toBe(MAX_FIELD_LEN);
    expect(a.discrepancies[0].claim.length).toBe(MAX_FIELD_LEN);
  });
});

describe("validateAssessment — array caps & sanitation (#3)", () => {
  it("caps a 10_000-element strengths array to the array max and drops non-strings/blanks", () => {
    const hostile = [
      ...Array.from({ length: 10_000 }, (_, i) => `s${i}`),
      42, // non-string -> dropped
      "  ", // blank -> dropped
      null, // -> dropped
    ];
    const a = validateAssessment({ strengths: hostile, risks: hostile });
    expect(a.strengths.length).toBeLessThanOrEqual(MAX_ARRAY);
    expect(a.strengths).toHaveLength(MAX_ARRAY);
    expect(a.risks).toHaveLength(MAX_ARRAY);
    // Survivors are all non-empty trimmed strings (the hostile non-strings never leak through).
    expect(a.strengths.every((s) => typeof s === "string" && s.trim().length > 0)).toBe(true);
  });

  it("caps roadmap.explore at its narrower max of 3", () => {
    const a = validateAssessment({
      roadmap: [
        {
          title: "do thing",
          dimension: "D1",
          explore: Array.from({ length: 1000 }, (_, i) => `e${i}`),
        },
      ],
    });
    expect(a.roadmap).toHaveLength(1);
    expect(a.roadmap[0].explore.length).toBeLessThanOrEqual(MAX_EXPLORE);
    expect(a.roadmap[0].explore).toHaveLength(MAX_EXPLORE);
  });

  it("caps the roadmap list at 6 and discrepancies at 8", () => {
    const a = validateAssessment({
      roadmap: Array.from({ length: 50 }, (_, i) => ({
        title: `item ${i}`,
        dimension: "D1",
      })),
      discrepancies: Array.from({ length: 50 }, () => ({ dimension: "D1", claim: "c" })),
    });
    expect(a.roadmap.length).toBeLessThanOrEqual(6);
    expect(a.discrepancies.length).toBeLessThanOrEqual(8);
  });

  it("coerces a non-array array-field to [] rather than crashing", () => {
    const a = validateAssessment({ strengths: "not an array", risks: 123 });
    expect(a.strengths).toEqual([]);
    expect(a.risks).toEqual([]);
  });
});

describe("validateAssessment — dimension de-dupe & input bound (#3)", () => {
  it("collapses 1000 duplicate valid-id dimensions to exactly one (first score wins)", () => {
    const a = validateAssessment({
      dimensions: Array.from({ length: 1000 }, (_, i) => ({ id: "D1", score: i })),
    });
    const d1 = a.dimensions.filter((d) => d.id === "D1");
    expect(d1).toHaveLength(1);
    expect(d1[0].score).toBe(0); // FIRST entry's score (i === 0) wins, not a later one
  });

  it("bounds the dimensions input so a hostile huge array can't smuggle past unique ids", () => {
    // Far more entries than DIMENSIONS exist; output can never exceed the distinct valid id count.
    const a = validateAssessment({
      dimensions: Array.from({ length: 100_000 }, (_, i) => ({ id: `D${(i % 9) + 1}`, score: 50 })),
    });
    expect(a.dimensions.length).toBeLessThanOrEqual(9); // one row per distinct valid id, at most
    expect(new Set(a.dimensions.map((d) => d.id)).size).toBe(a.dimensions.length); // all unique
  });
});

describe("validateAssessment — levelUnlock sanity via roadmap (#3)", () => {
  // validLevelUnlock is internal; exercise it through the roadmap path it guards.
  const unlock = (levelUnlock: unknown): string | undefined =>
    validateAssessment({
      roadmap: [{ title: "advance maturity", dimension: "D1", levelUnlock }],
    }).roadmap[0]?.levelUnlock;

  it("normalizes a valid in-range advance (both arrow forms)", () => {
    expect(unlock("L2->L4")).toBe("L2->L4");
    expect(unlock("L2→L4")).toBe("L2->L4"); // unicode arrow normalized to canonical ASCII
    expect(unlock("L1 -> L5")).toBe("L1->L5"); // whitespace tolerated
  });

  it("rejects a downgrade — a 'fix' that LOWERS maturity must never reach the roadmap", () => {
    expect(unlock("L3->L2")).toBeUndefined();
    expect(unlock("L3→L2")).toBeUndefined();
    expect(unlock("L4->L4")).toBeUndefined(); // equal is not an advance
  });

  it("rejects out-of-range / garbage level unlocks", () => {
    expect(unlock("L5->L7")).toBeUndefined(); // L7 out of the L1..L5 band
    expect(unlock("L0->L3")).toBeUndefined();
    expect(unlock("garbage")).toBeUndefined();
    expect(unlock("")).toBeUndefined();
    expect(unlock(42)).toBeUndefined(); // wrong type
    expect(unlock(undefined)).toBeUndefined();
  });
});

describe("validateAssessment — malformed payloads yield the documented empty (never half-valid) result (#3)", () => {
  const EMPTY = {
    dimensions: [],
    headline: "",
    strengths: [],
    risks: [],
    roadmap: [],
    discrepancies: [],
  };

  it("never throws and returns a well-formed empty assessment for hostile/garbage inputs", () => {
    for (const bad of [null, undefined, 42, "string", true, [], { unrelated: "junk" }]) {
      expect(() => validateAssessment(bad)).not.toThrow();
      expect(validateAssessment(bad)).toEqual(EMPTY);
    }
  });

  it("drops a roadmap entry with a missing/unknown dimension instead of mis-tagging it", () => {
    const a = validateAssessment({
      roadmap: [
        { title: "no dim" }, // missing dimension -> dropped, never silently re-tagged to D1
        { title: "bad dim", dimension: "D99" }, // unknown id -> dropped
        { title: "ok", dimension: "D1" }, // the only survivor
      ],
    });
    expect(a.roadmap).toHaveLength(1);
    expect(a.roadmap[0]).toMatchObject({ title: "ok", dimension: "D1" });
  });

  it("drops a discrepancy missing its dimension or claim", () => {
    const a = validateAssessment({
      discrepancies: [
        { dimension: "D1" }, // no claim -> dropped
        { claim: "orphan claim" }, // no dimension -> dropped
        { dimension: "D99", claim: "bad dim" }, // unknown dim -> dropped
        { dimension: "D2", claim: "real" }, // survivor
      ],
    });
    expect(a.discrepancies).toHaveLength(1);
    expect(a.discrepancies[0]).toEqual({ dimension: "D2", claim: "real" });
  });

  it("coerces an out-of-band impact/effort to the safe 'medium' default (not undefined)", () => {
    const a = validateAssessment({
      roadmap: [{ title: "t", dimension: "D1", impact: "catastrophic", effort: 99 }],
    });
    expect(a.roadmap[0].impact).toBe("medium");
    expect(a.roadmap[0].effort).toBe("medium");
  });
});
