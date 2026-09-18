// THE RUNNER'S TWO RUNNER-WIDE BREAKERS, table-tested. Both resolve to PAUSE with a time it lifts —
// the classifier's job is to recognise every wording of the account's session limit the Claude CLI
// has used, and to refuse every failure that merely LOOKS like one (a pause would not cure those).

import { describe, expect, it } from "vitest";
import {
  MICROS_PER_USD,
  SESSION_LIMIT_FALLBACK_MS,
  SESSION_LIMIT_MIN_PAUSE_MS,
  classifySessionLimit,
  localMidnight,
  nextLocalMidnight,
  sessionLimitBreaker,
  sessionLimitTexts,
  spendCeilingBreaker,
  spendCeilingMicrosFrom,
  spendCeilingUsdFrom,
} from "./runner-breakers";
import { DEFAULT_SPEND_CEILING_MICROS } from "./runner-types";

// Local time on purpose: the CLI prints the machine's wall clock, and the parser reads it that way.
const NOW = new Date(2026, 8, 18, 10, 0, 0, 0); // Fri 18 Sep 2026, 10:00 local
const at = (d: number, h: number, m = 0) => new Date(2026, 8, d, h, m, 0, 0).toISOString();

describe("classifySessionLimit — every shape it recognises", () => {
  const cases: [string, string | null][] = [
    // [text, expected resetAt (null = limited, reset unknown)]
    [`Claude AI usage limit reached|${Math.floor(Date.parse(at(18, 15)) / 1000)}`, at(18, 15)],
    [`Claude usage limit reached|${Date.parse(at(18, 16))}`, at(18, 16)],
    ["You've hit your session limit · resets 3pm", at(18, 15)],
    ["You've hit your session limit · resets 3pm (Europe/Prague)", at(18, 15)],
    ["Usage limit reached — resets at 15:00", at(18, 15)],
    ["5-hour limit reached ∙ resets 11:30pm", at(18, 23, 30)],
    ["Claude usage limit reached. Your limit will reset at 3:30 PM (America/New_York).", at(18, 15, 30)],
    ["Session limit reached. Resets in 2h 15m", new Date(NOW.getTime() + (2 * 60 + 15) * 60_000).toISOString()],
    ["You have reached your usage limit; resets in 45 minutes", new Date(NOW.getTime() + 45 * 60_000).toISOString()],
    ["Weekly limit reached ∙ resets Mon 9am", at(21, 9)],
    // A time already past today means tomorrow.
    ["You've hit your session limit · resets 9am", at(19, 9)],
    ["Agent failed: You've hit your usage limit", null],
    // A bare hour is ambiguous: limited, but the reset is not guessed.
    ["Session limit reached, resets at 7", null],
  ];
  it.each(cases)("%s", (text, resetAt) => {
    expect(classifySessionLimit(text, NOW)).toEqual({ limited: true, resetAt });
  });

  const negatives = [
    null,
    undefined,
    "",
    "Agent session exceeded 20 min and was stopped.",
    'API Error: 429 {"type":"error","error":{"type":"rate_limit_error"}}',
    "Output token limit reached for this response.",
    "Could not start the claude CLI: spawn claude ENOENT",
    "The degradation guard rejected this cycle",
  ];
  it.each(negatives)("does not mistake %j for the account's limit", (text) => {
    expect(classifySessionLimit(text, NOW)).toEqual({ limited: false, resetAt: null });
  });
});

describe("sessionLimitBreaker — the whole runner pauses until the LATEST named reset", () => {
  it("returns null when no text is a session limit", () => {
    expect(sessionLimitBreaker(["Agent failed: boom"], NOW)).toBeNull();
  });

  it("pauses until the latest reset any lane named", () => {
    const hit = sessionLimitBreaker(["You've hit your session limit · resets 3pm", "Usage limit reached — resets at 16:00"], NOW);
    expect(hit).toMatchObject({ reason: "session-limit", until: at(18, 16) });
  });

  it("falls back to +60 min when no reset parsed", () => {
    const hit = sessionLimitBreaker(["You've hit your usage limit"], NOW);
    expect(hit?.until).toBe(new Date(NOW.getTime() + SESSION_LIMIT_FALLBACK_MS).toISOString());
  });

  it("never pauses for less than the floor, even on a reset already past", () => {
    const stale = `Claude AI usage limit reached|${Math.floor(NOW.getTime() / 1000) - 600}`;
    expect(sessionLimitBreaker([stale], NOW)?.until).toBe(new Date(NOW.getTime() + SESSION_LIMIT_MIN_PAUSE_MS).toISOString());
  });

  it("reads each lane's error AND its 'Agent failed:' log lines, and nothing else", () => {
    const texts = sessionLimitTexts([
      { error: "lane error", log: ["Agent finished: ok", "Agent failed: You've hit your session limit · resets 3pm", "note"] },
      { error: null, log: [] },
    ]);
    expect(texts).toEqual(["lane error", "Agent failed: You've hit your session limit · resets 3pm"]);
  });
});

describe("spend ceiling", () => {
  it("converts USD to micro-cents; omitted is the default, 0/null is none", () => {
    expect(spendCeilingMicrosFrom(undefined)).toBe(DEFAULT_SPEND_CEILING_MICROS);
    expect(spendCeilingMicrosFrom(null)).toBeNull();
    expect(spendCeilingMicrosFrom(0)).toBeNull();
    expect(spendCeilingMicrosFrom(12.5)).toBe(12.5 * MICROS_PER_USD);
    expect(spendCeilingMicrosFrom(-3)).toBe(DEFAULT_SPEND_CEILING_MICROS);
    expect(spendCeilingUsdFrom(12.5 * MICROS_PER_USD)).toBe(12.5);
    expect(spendCeilingUsdFrom(null)).toBeNull();
  });

  const ceiling = 10 * MICROS_PER_USD;
  const cases: [string, number | null, number | null, boolean][] = [
    ["under the ceiling", 9.99 * MICROS_PER_USD, ceiling, false],
    ["exactly at the ceiling", ceiling, ceiling, true],
    ["past the ceiling", 11 * MICROS_PER_USD, ceiling, true],
    ["no ceiling at all", 1_000 * MICROS_PER_USD, null, false],
    ["no spend reading", null, ceiling, false],
  ];
  it.each(cases)("%s", (_label, spent, cap, fires) => {
    const hit = spendCeilingBreaker(spent, cap, NOW);
    expect(hit != null).toBe(fires);
    if (hit) {
      expect(hit.reason).toBe("spend-ceiling");
      expect(hit.until).toBe(nextLocalMidnight(NOW).toISOString());
      expect(hit.note).toContain("$10.00");
    }
  });

  it("the window starts at local midnight and lifts at the next one", () => {
    expect(localMidnight(NOW).toISOString()).toBe(at(18, 0));
    expect(nextLocalMidnight(NOW).toISOString()).toBe(at(19, 0));
  });
});
