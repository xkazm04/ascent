// The three request bodies the cockpit composes from one set of dials. Pinned:
//
//   - a manual run's body is EXACTLY what the inspector sent before the composition moved here;
//   - a bounded drive now carries the dials (until 2026-09-18 it sent none, so every drive run used the
//     deployment defaults whatever the dialog said);
//   - all three now carry the ARMS the builder composed (the two drive bodies inside `dials`, the only
//     place the drive route reads them; the reader tests beside both routes prove the round trip), and
//     none of them departs on a configuration the preflight probe refused;
//   - the standing runner forces its two settings — no delivery, verify on — whatever the dials hold,
//     omits `repos` for the default scope, and refuses an empty ceiling rather than read it as "none".

import { describe, expect, it } from "vitest";
import { armStartBlock, driveStartInput, parseCeilingUsd, runStartInput, runnerStartInput } from "./startInputs";
import { newArmDraft } from "./arms/armDraft";
import { dialsSummary } from "./setupSummary";
import { INITIAL_DIALS, type RunDials } from "./useRunDials";

const dials = (over: Partial<RunDials> = {}): RunDials => ({ ...INITIAL_DIALS, ...over });

describe("runStartInput", () => {
  it("is the body the inspector always sent", () => {
    const body = runStartInput(dials({ delivery: "land", sessionMinutes: 30 }), { runnable: ["acme/a"], batches: { "acme/a": ["r1"] } });
    expect(body).toEqual({
      repos: ["acme/a"],
      batches: { "acme/a": ["r1"] },
      concurrency: INITIAL_DIALS.concurrency,
      maxCycles: 3,
      model: null,
      effort: null,
      delivery: "land",
      batchSize: 5,
      agentTimeoutMs: 1_800_000,
      verifyMode: "on",
      verifyTimeoutMs: 600_000,
      // Since 2026-09-18 a manual run carries the rescan cadence too — the dial is offered in every mode.
      rescanCadence: "cycle",
      // Since 2026-09-21 it carries the ARMS as well: the Model control is gone, and the default
      // dials are one Claude arm on the deployment default — the pre-arms run, written down.
      armPolicy: "single",
      arms: [{ id: "claude-sonnet-1", label: "", transport: "claude", model: "sonnet", plan: null }],
    });
    expect(runStartInput(dials(), { runnable: ["acme/a"], batches: {} }).batches).toBeUndefined();
  });
});

describe("driveStartInput", () => {
  it("sends the dials with a bounded drive, and no runner fields", () => {
    const body = driveStartInput(dials({ batchSize: 8, verifyMode: "off", rescanCadence: "run" }), ["acme/a"]);
    expect(body.dials).toEqual({
      batchSize: 8,
      agentTimeoutMs: 1_200_000,
      verifyMode: "off",
      verifyTimeoutMs: 600_000,
      rescanCadence: "run",
      armPolicy: "single",
      arms: [{ id: "claude-sonnet-1", label: "claude:sonnet", transport: "claude", model: "sonnet", plan: null }],
    });
    expect(body.maxRuns).toBe(3);
    expect(body.delivery).toBe("branch");
    expect(body.mode).toBeUndefined();
    expect(body.spendCeilingUsd).toBeUndefined();
    // The arms ride INSIDE the dials: at the top of a drive body the route refuses them.
    expect("arms" in body).toBe(false);
    expect("armPolicy" in body).toBe(false);
  });

  it("sends planMode 'on' with a split arm, on every door, and never for a plain one", () => {
    const split = { ...newArmDraft("pi"), model: "qwen3.8:27b", plan: { transport: "claude" as const, model: "sonnet" } };
    expect(driveStartInput(dials({ arms: [split] }), ["acme/a"]).dials?.planMode).toBe("on");
    expect(runStartInput(dials({ arms: [split] }), { runnable: ["acme/a"], batches: {} }).planMode).toBe("on");
    expect(driveStartInput(dials(), ["acme/a"]).dials?.planMode).toBeUndefined();
  });
});

describe("armStartBlock — nothing departs on a configuration nothing has cleared", () => {
  it("lets an unprobed, armable configuration go — the probe is a deliberate press, not a toll", () => {
    expect(armStartBlock(dials())).toBeNull();
    expect(armStartBlock(dials({ armProbe: "armable" }))).toBeNull();
  });

  it("refuses a REFUSED probe, and says where to read what it found", () => {
    const why = armStartBlock(dials({ armProbe: "blocked" }));
    expect(why).toMatch(/probe refused/i);
    expect(why).toMatch(/gear/i);
  });

  it("refuses while the probe is still running", () => {
    expect(armStartBlock(dials({ armProbe: "probing" }))).toMatch(/still running/i);
  });

  it("refuses a half-typed arm, and sends no half configuration when it somehow departs", () => {
    const halfTyped = dials({ arms: [{ ...newArmDraft("pi"), model: "" }] });
    expect(armStartBlock(halfTyped)).toMatch(/not armable/i);
    // The second line of the same refusal: a body is composed with NO arms rather than with half a set.
    const body = runStartInput(halfTyped, { runnable: ["acme/a"], batches: {} });
    expect(body.arms).toBeUndefined();
    expect(body.armPolicy).toBeUndefined();
  });

  it("refuses a below-floor arm whose opt-in was never ticked", () => {
    const local = { ...newArmDraft("pi"), model: "qwen3.8:27b", floorAck: false };
    expect(armStartBlock(dials({ arms: [local] }))).toMatch(/below-floor/i);
    expect(armStartBlock(dials({ arms: [{ ...local, floorAck: true }] }))).toBeNull();
  });
});

describe("runnerStartInput", () => {
  it("forces the runner's settings and leaves the scope to the server by default", () => {
    const built = runnerStartInput(dials({ delivery: "land", verifyMode: "off", spendCeiling: "40" }), ["acme/a"]);
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(built.input).toEqual({
      mode: "continuous",
      maxCycles: 3,
      concurrency: INITIAL_DIALS.concurrency,
      model: null,
      effort: null,
      spendCeilingUsd: 40,
      dials: {
        batchSize: 5,
        agentTimeoutMs: 1_200_000,
        verifyMode: "on",
        verifyTimeoutMs: 600_000,
        rescanCadence: "cycle",
        armPolicy: "single",
        arms: [{ id: "claude-sonnet-1", label: "claude:sonnet", transport: "claude", model: "sonnet", plan: null }],
      },
    });
    // Neither delivery nor a rope reaches the wire.
    expect("delivery" in built.input).toBe(false);
    expect("maxRuns" in built.input).toBe(false);
    expect("repos" in built.input).toBe(false);
  });

  it("sends the selection only when the scope says so, and refuses an empty one", () => {
    const sel = runnerStartInput(dials({ runnerScope: "selection" }), ["acme/a", "acme/b"]);
    expect(sel.ok && sel.input.repos).toEqual(["acme/a", "acme/b"]);
    expect(runnerStartInput(dials({ runnerScope: "selection" }), []).ok).toBe(false);
  });

  it("defaults the ceiling to the contract's $100, and treats 0 as no ceiling but blank as an error", () => {
    expect(INITIAL_DIALS.spendCeiling).toBe("100");
    expect(parseCeilingUsd("0")).toEqual({ ok: true, usd: 0 });
    expect(parseCeilingUsd(" 12.5 ")).toEqual({ ok: true, usd: 12.5 });
    expect(parseCeilingUsd("").ok).toBe(false);
    expect(parseCeilingUsd("-3").ok).toBe(false);
    expect(parseCeilingUsd("abc").ok).toBe(false);
    expect(runnerStartInput(dials({ spendCeiling: "" }), []).ok).toBe(false);
  });
});

describe("dialsSummary", () => {
  it("reads the runner's line in runner mode and keeps the run's line unchanged otherwise", () => {
    expect(dialsSummary(INITIAL_DIALS)).toBe("all dimensions · 5 items/lane · 2 lanes · 3 cycles · default model · default effort · verified · branch");
    const runner = dialsSummary(dials({ mode: "runner" }));
    expect(runner).toContain("standing runner");
    expect(runner).toContain("$100/day ceiling");
    expect(runner).toContain("runner branch");
    expect(dialsSummary(dials({ mode: "runner", spendCeiling: "0" }))).toContain("no spend ceiling");
  });
});
