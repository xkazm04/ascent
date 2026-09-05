import { describe, expect, it } from "vitest";
import {
  APPROACHING,
  AT_RISK,
  classifyOutputBudget,
  FALLBACK_OUTPUT_CAP,
  outputBudgetWarning,
  outputCapFor,
} from "./output-budget";

describe("outputCapFor", () => {
  it("matches the longest model prefix", () => {
    expect(outputCapFor("gemini-3.7-flash")).toEqual({ cap: 65_536, assumed: false });
    expect(outputCapFor("claude-opus-5")).toEqual({ cap: 64_000, assumed: false });
  });

  it("matches the bare claude-cli aliases", () => {
    expect(outputCapFor("opus").assumed).toBe(false);
    expect(outputCapFor("haiku").cap).toBe(8_192);
  });

  it("strips a Bedrock geo prefix before matching", () => {
    expect(outputCapFor("us.anthropic.claude-sonnet-4-6")).toEqual({ cap: 64_000, assumed: false });
  });

  // Under-estimating a cap raises a warning that turns out to be early. Over-estimating it stays
  // silent right through the truncation — so an unknown model gets the conservative number.
  it("falls back conservatively for an unrecognized model, and says the cap was assumed", () => {
    expect(outputCapFor("some-new-model")).toEqual({ cap: FALLBACK_OUTPUT_CAP, assumed: true });
    expect(outputCapFor(null)).toEqual({ cap: FALLBACK_OUTPUT_CAP, assumed: true });
    expect(outputCapFor("")).toEqual({ cap: FALLBACK_OUTPUT_CAP, assumed: true });
  });
});

describe("classifyOutputBudget", () => {
  const cap = 65_536; // gemini-3.7-flash

  it("reads a small assessment as ok", () => {
    const b = classifyOutputBudget(5_000, "gemini-3.7-flash")!;
    expect(b.level).toBe("ok");
    expect(b.usedPct).toBe(8);
    expect(b.cap).toBe(cap);
  });

  it("flags the approaching band", () => {
    expect(classifyOutputBudget(Math.ceil(cap * APPROACHING), "gemini-3.7-flash")!.level).toBe("approaching");
  });

  it("flags the at-risk band", () => {
    expect(classifyOutputBudget(Math.ceil(cap * AT_RISK), "gemini-3.7-flash")!.level).toBe("at-risk");
  });

  it("stays ok just below the approaching threshold", () => {
    expect(classifyOutputBudget(Math.floor(cap * APPROACHING) - 1, "gemini-3.7-flash")!.level).toBe("ok");
  });

  // "Not measured" and "comfortably small" are different statements. Reporting 0% used for a mock
  // scan would assert the second while only the first is true.
  it("returns null when the provider reported no usage — never a reassuring 0%", () => {
    expect(classifyOutputBudget(0, "gemini-3.7-flash")).toBeNull();
    expect(classifyOutputBudget(null, "gemini-3.7-flash")).toBeNull();
    expect(classifyOutputBudget(undefined, "gemini-3.7-flash")).toBeNull();
    expect(classifyOutputBudget(NaN, "gemini-3.7-flash")).toBeNull();
  });

  // The same assessment is comfortable on a roomy model and at risk on a small one — which is the
  // point: the ceiling is a property of the model, and switching models moves it.
  it("classifies the same token count differently per model", () => {
    expect(classifyOutputBudget(7_000, "gemini-3.7-flash")!.level).toBe("ok");
    expect(classifyOutputBudget(7_000, "haiku")!.level).toBe("at-risk");
  });
});

describe("outputBudgetWarning", () => {
  it("says nothing when the budget is comfortable", () => {
    expect(outputBudgetWarning(classifyOutputBudget(1_000, "gemini-3.7-flash"))).toBeNull();
    expect(outputBudgetWarning(null)).toBeNull();
  });

  // A limit warning with no stated consequence reads as noise. The consequence here is specific,
  // and so is the remedy — which is the whole reason to measure this.
  it("names both the failure mode and the fix at the at-risk level", () => {
    const w = outputBudgetWarning(classifyOutputBudget(60_000, "gemini-3.7-flash"))!;
    expect(w).toMatch(/truncated/i);
    expect(w).toMatch(/drops dimensions silently/i);
    expect(w).toMatch(/split into smaller calls/i);
  });

  it("is calmer at the approaching level and does not claim truncation", () => {
    const w = outputBudgetWarning(classifyOutputBudget(Math.ceil(65_536 * 0.65), "gemini-3.7-flash"))!;
    expect(w).toMatch(/growing toward the ceiling/i);
    expect(w).not.toMatch(/truncated/i);
  });

  it("discloses when the ceiling it measured against was assumed", () => {
    const w = outputBudgetWarning(classifyOutputBudget(7_500, "some-new-model"))!;
    expect(w).toMatch(/assumed for an unrecognized model/i);
  });
});
