// ONE RUN-SPEC PARSER behind both start doors (challenge-2026-09-23b, local-autopilot-loop-engine#A).
//
// `/api/org/loop` reads its dials from the top of the body; `/api/org/local/drive` reads the same dials
// from `body.dials`. Until this module they were validated by two hand-kept copies that had stopped
// agreeing (a sent null, a modelPolicy typo, a fractional cycle count), and neither knew that a split
// arm with plan mode off is a run that never spawns its planning half. Pinned here as pure functions;
// the two reader tests beside the routes pin what the handlers do with the result.

import { describe, expect, it } from "vitest";
import { impliedPlanMode, parseRunDials, parseRunSpec, parseWholeCount, type RunCaps } from "./run-spec";
import { dialRunInput } from "./drive-dials";

const CAPS: RunCaps = { maxCycles: 5, concurrency: 4 };
const split = { id: "split", transport: "pi", model: "qwen3.8:27b", plan: { transport: "claude", model: "sonnet" } };
const plain = { id: "plain", transport: "claude", model: "sonnet" };

/** The same request as each door receives it: flat on /loop, the dials nested on /drive. */
const TOP = ["maxCycles", "concurrency", "model", "effort"];
function doors(fields: Record<string, unknown>) {
  const top = Object.fromEntries(Object.entries(fields).filter(([k]) => TOP.includes(k)));
  const dials = Object.fromEntries(Object.entries(fields).filter(([k]) => !TOP.includes(k)));
  return { loop: parseRunSpec(fields, CAPS, "body"), drive: parseRunSpec({ ...top, dials }, CAPS, "dials") };
}

describe("parity: one verdict per input, whichever door it arrives at", () => {
  it.each([
    ["a sent null batchSize (= omitted)", { batchSize: null }, true],
    ["modelPolicy 'abc'", { modelPolicy: "abc" }, false],
    ["maxCycles 2.6", { maxCycles: 2.6 }, false],
    ["concurrency 1.5", { concurrency: 1.5 }, false],
    ["a model name that is not on the roster (falls back to the default)", { model: "bad name" }, true],
    ["a split arm with no planMode", { armPolicy: "single", arms: [split] }, true],
    ["a split arm with planMode off", { armPolicy: "single", arms: [split], planMode: "off" }, false],
  ])("%s", (_label, fields, ok) => {
    const { loop, drive } = doors(fields);
    expect(loop.ok).toBe(ok);
    expect(drive.ok).toBe(ok);
    if (loop.ok && drive.ok) expect(loop.value).toEqual(drive.value);
  });

  it("normalizes the shared values identically (null = omitted, bad model = default)", () => {
    const { loop } = doors({ batchSize: null, model: "bad name" });
    expect(loop.ok && loop.value).toEqual({ maxCycles: 3, concurrency: 2, model: null, effort: null, dials: {} });
  });
});

describe("planMode and the split arm", () => {
  it("implies 'on' when any arm plans with a different half and the caller named no mode", () => {
    const out = parseRunDials({ armPolicy: "compare", arms: [plain, split] });
    expect(out.ok && out.value.planMode).toBe("on");
    expect(impliedPlanMode([], undefined)).toBeUndefined();
  });

  it("leaves a set of plain arms without a planMode", () => {
    const out = parseRunDials({ armPolicy: "single", arms: [plain] });
    expect(out.ok && "planMode" in out.value).toBe(false);
  });

  it("refuses an explicit 'off' for a split arm, naming planMode", () => {
    const out = parseRunDials({ armPolicy: "single", arms: [split], planMode: "off" }, "dials.");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/planMode/);
  });

  it("refuses a planMode it does not know, and treats a sent null as omitted", () => {
    expect(parseRunDials({ planMode: "yes" }).ok).toBe(false);
    expect(parseRunDials({ planMode: null })).toEqual({ ok: true, value: {} });
  });
});

describe("the drive door", () => {
  it("refuses a stale top-level 'arms', saying where they belong", () => {
    const out = parseRunSpec({ arms: [plain], armPolicy: "single" }, CAPS, "dials");
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/dials\.arms/);
  });

  it("refuses a non-object dials", () => {
    expect(parseRunSpec({ dials: "fast" }, CAPS, "dials").ok).toBe(false);
  });
});

describe("parseWholeCount — one integer rule", () => {
  it("defaults omitted and null, refuses fractions, strings and the out-of-band", () => {
    expect(parseWholeCount(undefined, 3, 1, 5, "maxCycles")).toEqual({ ok: true, value: 3 });
    expect(parseWholeCount(null, 3, 1, 5, "maxCycles")).toEqual({ ok: true, value: 3 });
    expect(parseWholeCount(4, 3, 1, 5, "maxCycles")).toEqual({ ok: true, value: 4 });
    for (const v of [2.6, "3", 0, 6, Number.NaN]) expect(parseWholeCount(v, 3, 1, 5, "maxCycles").ok).toBe(false);
  });
});

describe("guards", () => {
  it("guard: a body with no dials arms exactly what it did (dialRunInput(null) is {})", () => {
    expect(dialRunInput(null)).toEqual({});
    expect(doors({}).drive).toEqual({ ok: true, value: { maxCycles: 3, concurrency: 2, model: null, effort: null, dials: {} } });
  });

  it("guard: the legacy ab pair still parses as a model-keyed pair, with no arms", () => {
    const out = parseRunDials({ modelPolicy: "ab", models: ["sonnet", " opus "] });
    expect(out).toEqual({ ok: true, value: { modelPolicy: "ab", models: ["sonnet", "opus"] } });
  });
});
