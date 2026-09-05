// Diagnostic, not a test: replicates the EXACT request `OpenAiProvider.assess` sends (same strict
// json_schema response_format, same max_tokens, same system+user split) against a Nebius model and
// dumps the raw response. Run with LLM_DIAGNOSE=1.
//
// It exists because "Empty response from Nebius Token Factory" is three different bugs wearing one
// message: a rejected response_format, a truncated completion, or an answer the adapter cannot see
// because it arrived in a field it does not read. Guessing between them and patching the wrong one
// is how a benchmark ends up grading its own harness.

import { describe, expect, it } from "vitest";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import { buildAssessmentPrompt } from "@/lib/scoring/prompt";
import { assessmentResponseFormat, JSON_OBJECT_RESPONSE_FORMAT } from "@/lib/llm/schema";
import { input } from "@/lib/llm/bench/fixture";

const OUT = process.env.LLM_BENCH_OUT || join(process.cwd(), ".llm-bench");
const ENABLED = process.env.LLM_DIAGNOSE === "1";
const MODELS = (process.env.LLM_DIAGNOSE_MODELS || "zai-org/GLM-5.3-Flash,nvidia/Nemotron-3_5-Lightning")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

describe.skipIf(!ENABLED)("nebius raw response diagnosis", () => {
  it(
    "dumps what each model actually returns under ascent's exact request shape",
    async () => {
      mkdirSync(OUT, { recursive: true });
      const { system, user } = buildAssessmentPrompt(input);

      for (const model of MODELS) {
        for (const [label, fmt] of [
          ["json_schema", assessmentResponseFormat()],
          ["json_object", JSON_OBJECT_RESPONSE_FORMAT],
        ] as const) {
          const started = Date.now();
          const res = await fetch("https://api.tokenfactory.nebius.com/v1/chat/completions", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${process.env.NEBIUS_API_KEY}`,
            },
            body: JSON.stringify({
              model,
              temperature: 0,
              max_tokens: Number(process.env.OPENAI_MAX_TOKENS) || 16000,
              response_format: fmt,
              messages: [
                { role: "system", content: system },
                { role: "user", content: user },
              ],
            }),
          });
          const ms = Date.now() - started;
          const body = (await res.json()) as Record<string, unknown>;
          const choice = (body.choices as { finish_reason?: string; message?: Record<string, unknown> }[])?.[0];
          const msg = choice?.message ?? {};
          const content = (msg.content as string) ?? "";
          const reasoning = (msg.reasoning_content as string) ?? "";
          const usage = body.usage as Record<string, unknown> | undefined;

          // eslint-disable-next-line no-console
          console.log(
            [
              model.padEnd(30),
              label.padEnd(12),
              `http=${res.status}`,
              `finish=${choice?.finish_reason}`,
              `content=${content.length}`,
              `reasoning=${reasoning.length}`,
              `completion_tokens=${usage?.completion_tokens}`,
              `err=${body.error ? JSON.stringify(body.error).slice(0, 80) : "-"}`,
              `msg_keys=${Object.keys(msg).join("|")}`,
            ].join("  "),
          );
          writeFileSync(
            join(OUT, `diag_${model.replace(/[^a-z0-9]+/gi, "_")}_${label}.json`),
            JSON.stringify({ model, label, ms, status: res.status, body }, null, 2),
            "utf8",
          );
        }
      }
      expect(MODELS.length).toBeGreaterThan(0);
    },
    900_000,
  );
});
