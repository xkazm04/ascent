// THE DRIVE'S DIALS reach every run — and a runner that a restart could not re-attach resumes as the
// same runner. Pure: `drive-dials.ts` and `resumeParams` (drive-types.ts) touch no db and no engine.

import { describe, expect, it } from "vitest";
import { dialRunInput, parseDriveDials } from "./drive-dials";
import { resumeParams, type DriveStatus } from "./drive-types";
import { MICROS_PER_USD } from "./runner-breakers";

describe("parseDriveDials — the loop route's validators, never a clamp", () => {
  it("absent or null is no dials (the deployment defaults)", () => {
    expect(parseDriveDials(undefined)).toEqual({ ok: true, dials: null });
    expect(parseDriveDials(null)).toEqual({ ok: true, dials: null });
    expect(parseDriveDials({})).toEqual({ ok: true, dials: null });
  });

  it("accepts every dial in its band", () => {
    const raw = {
      batchSize: 12,
      agentTimeoutMs: 5_400_000,
      verifyMode: "off",
      verifyTimeoutMs: 30_000,
      rescanCadence: "run",
      modelPolicy: "ab",
      models: ["opus", " sonnet ", "opus"],
    };
    expect(parseDriveDials(raw)).toEqual({
      ok: true,
      dials: { batchSize: 12, agentTimeoutMs: 5_400_000, verifyMode: "off", verifyTimeoutMs: 30_000, rescanCadence: "run", modelPolicy: "ab", models: ["opus", "sonnet"] },
    });
  });

  it.each([
    [{ batchSize: 0 }, "batchSize"],
    [{ batchSize: 2.5 }, "batchSize"],
    [{ agentTimeoutMs: 1_000 }, "agentTimeoutMs"],
    [{ verifyMode: "maybe" }, "verifyMode"],
    [{ verifyTimeoutMs: 99_999_999 }, "verifyTimeoutMs"],
    [{ rescanCadence: "hourly" }, "rescanCadence"],
    [{ modelPolicy: "ab", models: ["opus"] }, "two distinct models"],
    [{ modelPolicy: "ab", models: ["opus", "x; rm -rf"] }, "Invalid model"],
    [{ modelPolicy: "fleet" }, "modelPolicy"],
    [[1, 2], "object"],
  ])("refuses %j, naming it", (raw, word) => {
    const out = parseDriveDials(raw);
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toContain(word);
  });
});

describe("dialRunInput — only what is set", () => {
  it("is empty without dials, so a drive with none arms runs exactly as before", () => {
    expect(dialRunInput(null)).toEqual({});
    expect(dialRunInput({ batchSize: null, verifyMode: null })).toEqual({});
  });

  it("carries every set dial, and the A/B arms only as a pair", () => {
    expect(dialRunInput({ batchSize: 8, verifyTimeoutMs: 60_000, modelPolicy: "ab", models: ["opus", "sonnet"] })).toEqual({
      batchSize: 8,
      verifyTimeoutMs: 60_000,
      modelPolicy: "ab",
      models: ["opus", "sonnet"],
    });
    expect(dialRunInput({ modelPolicy: "ab", models: ["opus"] })).toEqual({});
  });
});

describe("resumeParams — a runner the boot sweep could not re-attach", () => {
  const runner = (over: Partial<DriveStatus> = {}): DriveStatus => ({
    id: "drive_r",
    org: "acme",
    phase: "interrupted",
    repos: ["acme/a"],
    maxRuns: 0,
    maxCycles: 2,
    concurrency: 3,
    runs: [],
    measurement: null,
    runsBefore: 0,
    resumedFrom: null,
    model: "opus",
    effort: "high",
    delivery: "runner",
    startedAt: "t0",
    endedAt: "t1",
    error: "loop off",
    stopRequested: false,
    mode: "continuous",
    spendCeilingMicros: 20 * MICROS_PER_USD,
    dials: { batchSize: 8 },
    ...over,
  });

  it("re-arms the SAME runner — no rope to exhaust, ceiling and dials carried", () => {
    expect(resumeParams(runner())).toEqual({
      org: "acme",
      repos: ["acme/a"],
      maxCycles: 2,
      concurrency: 3,
      resumedFrom: "drive_r",
      model: "opus",
      effort: "high",
      mode: "continuous",
      spendCeilingUsd: 20,
      dials: { batchSize: 8 },
    });
  });

  it("keeps 'no ceiling' as no ceiling, and still refuses anything but interrupted", () => {
    expect(resumeParams(runner({ spendCeilingMicros: null }))?.spendCeilingUsd).toBeNull();
    expect(resumeParams(runner({ phase: "stopped" }))).toBeNull();
  });
});
