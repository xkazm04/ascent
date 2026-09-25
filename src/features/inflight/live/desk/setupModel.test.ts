import { describe, expect, it } from "vitest";
import { runnerDrive } from "../ledger/ledgerFixture";
import { foldArms } from "./armsModel";
import { deskData } from "./deskFixture";
import { foldRounds } from "./roundsModel";
import { parseDraft, planOn, prefill, reduceSetup, repoOptions } from "./setupModel";

const data = deskData();
const rounds = foldRounds(data.rounds!, data.lanes).rounds;
const arms = foldArms(rounds);

describe("prefill", () => {
  it("copies the newest round and the engine's defaults for what nobody recorded", () => {
    const d = prefill(data, rounds, arms);
    expect(d).toMatchObject({ repos: ["acme/kp", "acme/web"], arms: ["claude:sonnet plan -> pi:qwen3.8:27b"], policy: "single", cycles: 3, batch: 5, verify: true });
    expect(planOn(d)).toBe(true);
  });

  it("takes batch, ceiling and verify from the last runner's dials", () => {
    const d2 = deskData();
    d2.ledger.runner = runnerDrive({ dials: { batchSize: 3, verifyMode: "off" }, spendCeilingMicros: 5_000_000_000 });
    expect(prefill(d2, rounds, arms)).toMatchObject({ batch: 3, verify: false, ceiling: 50 });
  });
});

describe("reduceSetup", () => {
  const base = prefill(data, rounds, arms);
  it("single keeps one arm; compare adds up to four and never drops the last", () => {
    expect(reduceSetup(base, { type: "arm", arm: "claude-opus-5" }).arms).toEqual(["claude-opus-5"]);
    const cmp = reduceSetup(base, { type: "policy", policy: "compare" });
    const two = reduceSetup(cmp, { type: "arm", arm: "claude-opus-5" });
    expect(two.arms).toHaveLength(2);
    const one = reduceSetup(reduceSetup(two, { type: "arm", arm: "claude-opus-5" }), { type: "arm", arm: base.arms[0]! });
    expect(one.arms).toHaveLength(1);
  });

  it("clamps the steppers and toggles repos", () => {
    expect(reduceSetup(base, { type: "step", key: "cycles", delta: 9 }).cycles).toBe(5);
    expect(reduceSetup(base, { type: "step", key: "ceiling", delta: -1000 }).ceiling).toBe(10);
    expect(reduceSetup(base, { type: "repo", repo: "acme/kp" }).repos).toEqual(["acme/web"]);
  });
});

describe("repoOptions and parseDraft", () => {
  it("offers paired repos with the last round each ran in", () => {
    expect(repoOptions(data, rounds)).toEqual([
      { repo: "acme/kp", lastSeq: 4, paired: true },
      { repo: "acme/web", lastSeq: 4, paired: true },
    ]);
  });

  it("accepts only a draft that still has the draft's shape", () => {
    expect(parseDraft("not json")).toBeNull();
    expect(parseDraft(JSON.stringify({ repos: "x" }))).toBeNull();
    const ok = parseDraft(JSON.stringify({ repos: ["a"], arms: [], policy: "single", cycles: 99, batch: 2, ceiling: 40, verify: true, plan: false }));
    expect(ok).toMatchObject({ cycles: 5, batch: 2 });
  });
});
