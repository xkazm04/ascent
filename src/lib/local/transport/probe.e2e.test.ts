// THE PROBE AGAINST THE REAL MACHINE. Skipped unless `ASCENT_PROBE_E2E=1`, because it needs a live
// inference server and a real `claude` binary — the same posture `lane-deps-install.e2e.test.ts`
// takes.
//
// It exists because every remedy sentence this package writes claims to know what a real server
// answers, and the only way that claim stays true is a run that asks one. What it asserts is the
// SHAPE of the answer, never the machine's particular numbers: this box measured Ollama 0.32.15
// serving 32 768 tokens on 2026-09-21, and both figures are refusals — pinning them would pin a
// machine, not a contract.
//
//   ASCENT_PROBE_E2E=1 ASCENT_PROBE_MODEL=qwen2.5:7b-instruct npx vitest run src/lib/local/transport/probe.e2e.test.ts

import { describe, expect, it } from "vitest";
import { probeRefusal, probeTransport } from "@/lib/local/transport/probe";

const live = process.env.ASCENT_PROBE_E2E === "1";
const endpoint = {
  baseUrl: process.env.ASCENT_PROBE_URL || "http://localhost:11434",
  model: process.env.ASCENT_PROBE_MODEL || "qwen2.5:7b-instruct",
  token: "local",
  contextTokens: 65_536,
};

describe.skipIf(!live)("probeTransport against the live machine", () => {
  it("reports a finding for every check, with a remedy on each miss", async () => {
    const result = await probeTransport("claude", endpoint);
    // The transcript IS the artifact this test produces; run it with --silent=false to read it.
    console.log(JSON.stringify(result, null, 2), "\n", probeRefusal(result));
    expect(result.findings.map((f) => f.check)).toEqual(["binary", "endpoint", "model", "context", "server-version", "auth"]);
    for (const f of result.findings) if (!f.ok) expect(f.remedy).toBeTruthy();
    expect(result.zeroToken).toBe(true);
    expect(result.binVersion).toBeTruthy();
    expect(result.serverVersion).toBeTruthy();
    expect(result.ok ? null : probeRefusal(result)).toEqual(result.ok ? null : expect.any(String));
  }, 200_000);
});
