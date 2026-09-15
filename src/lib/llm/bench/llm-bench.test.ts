// The five-arm model comparison for ascent's `scan.calibrate` use case.
//
// Run deliberately, never in CI:
//   npx vitest run scripts/llm-bench.test.ts --testTimeout=600000 --reporter=verbose
//
// It is a vitest file rather than a plain script only because ascent has no `tsx` and this needs the
// `@/` path aliases and the real provider classes. Nothing here is a unit test: every arm makes a
// paid/live call, so the whole file is skipped unless LLM_BENCH=1.
//
// WHAT IS BEING COMPARED. Not "which model is smartest" — which model is most useful at ONE declared
// call site: ascent's calibrate-and-explain step, where nine deterministic analyzers have already
// produced the evidence and the model's job is to calibrate the scores against it and explain them
// WITHOUT inventing any. That framing is the whole reason the use-case registry exists: a model that
// is excellent at prose and invents a score is a bad fit HERE and might be a fine fit elsewhere.
//
// THE SCANNED REPOSITORY is xkazm04/lighttrack, a public Rust workspace. Its signals below were read
// off the actual checkout rather than imagined, because a benchmark whose input is fabricated grades
// the fabrication.

import { describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { LLMProvider } from "@/lib/llm/provider";
import { input } from "@/lib/llm/bench/fixture";
import { NebiusProvider } from "@/lib/llm/nebius";
import { ClaudeCliProvider } from "@/lib/llm/claude-cli";
import { trackLlmCall } from "@/lib/llm/tracklight";

const OUT = process.env.LLM_BENCH_OUT || join(process.cwd(), ".llm-bench");
const ENABLED = process.env.LLM_BENCH === "1";

/** One arm of the matrix. */
interface Arm {
  label: string;
  provider: () => LLMProvider;
  /** What tracklight records the call under. */
  model: string;
  trackProvider: "nebius" | "claude-cli";
}

const ARMS: Arm[] = [
  {
    label: "GLM-5.3-Flash (Nebius)",
    model: "zai-org/GLM-5.3-Flash",
    trackProvider: "nebius",
    provider: () => new NebiusProvider({ model: "zai-org/GLM-5.3-Flash" }),
  },
  {
    label: "Nemotron-3_5-Lightning (Nebius)",
    model: "nvidia/Nemotron-3_5-Lightning",
    trackProvider: "nebius",
    provider: () => new NebiusProvider({ model: "nvidia/Nemotron-3_5-Lightning" }),
  },
  {
    label: "MiniMax-M3 (Nebius)",
    model: "MiniMaxAI/MiniMax-M3",
    trackProvider: "nebius",
    provider: () => new NebiusProvider({ model: "MiniMaxAI/MiniMax-M3" }),
  },
  {
    label: "Claude Code CLI (default engine)",
    model: "claude-cli-default",
    trackProvider: "claude-cli",
    provider: () => new ClaudeCliProvider(),
  },
  {
    label: "Sonnet (Claude Code CLI)",
    model: "sonnet",
    trackProvider: "claude-cli",
    provider: () => new ClaudeCliProvider("sonnet"),
  },
];

describe.skipIf(!ENABLED)("scan.calibrate — five-arm model comparison", () => {
  it(
    "runs every arm and records what each produced",
    async () => {
      mkdirSync(OUT, { recursive: true });
      const rows: Record<string, unknown>[] = [];
      // A substring filter, so one arm can be re-run after a config change without paying for the
      // four that already answered.
      const only = process.env.LLM_BENCH_ONLY?.trim();
      const arms = only ? ARMS.filter((a) => a.model.includes(only)) : ARMS;

      for (const arm of arms) {
        const started = Date.now();
        let assessment: unknown = null;
        let error: string | null = null;
        try {
          assessment = await arm.provider().assess(input, {});
        } catch (e) {
          error = e instanceof Error ? e.message : String(e);
        }
        const latencyMs = Date.now() - started;

        // Every arm is mirrored to tracklight under the declared use case, so the run shows up in
        // the coverage report rather than only in this file.
        trackLlmCall({
          provider: arm.trackProvider,
          model: arm.model,
          latencyMs,
          status: error ? "error" : "success",
          error: error ?? undefined,
          name: "scan.calibrate",
        } as never);

        const row = { arm: arm.label, model: arm.model, latencyMs, error, assessment };
        rows.push(row);
        writeFileSync(
          join(OUT, `${arm.model.replace(/[^a-z0-9]+/gi, "_")}.json`),
          JSON.stringify(row, null, 2),
          "utf8",
        );
        // eslint-disable-next-line no-console
        console.log(
          `${arm.label.padEnd(36)} ${String(latencyMs).padStart(7)}ms  ${error ? `ERROR ${error.slice(0, 120)}` : "ok"}`,
        );
      }

      writeFileSync(join(OUT, "all.json"), JSON.stringify(rows, null, 2), "utf8");
      // The harness asserts only that it RAN every arm. Whether an arm produced something useful is
      // the judgement this benchmark exists to make, and a test cannot make it.
      expect(rows).toHaveLength(arms.length);
    },
    600_000,
  );
});
