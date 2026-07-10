// Model-comparison matrix for the ONE ascent LLM op (repo-maturity assess). Replays the captured
// fixtures (scripts/matrix/capture.mts) across N OpenRouter models on IDENTICAL inputs and scores each
// model three ways:
//   1. QUALITY   — an LLM-as-judge (JUDGE_MODEL) rates the assessment 1–10 (relevance/correctness/adherence).
//   2. CALIBRATION — the model's assessment is blended through the real engine (assembleReport) to a
//                    maturity level, compared to the ground-truth label in bench/repos.json (exact / within-1).
//   3. COST/SPEED — token usage + wall latency (no absolute $ axis: OpenRouter's list prices for these
//                    slugs aren't booked; tokens + latency are the proxy, as in the sibling apps).
// Plus RELIABILITY: share of attempts that returned a usable assessment (didn't throw / cover < half).
//
//   OPENROUTER_API_KEY=… npx vite-node --config vitest.config.js scripts/matrix/run.mts
//
// Writes bench/matrix/records.json + summary.md. Re-bake the UI scorecard from these with bake.mts.

import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { OpenRouterProvider } from "@/lib/llm/openrouter";
import { assembleReport } from "@/lib/scoring/engine";
import { isAssessmentUsable } from "@/lib/llm/provider";
import type { MatrixFixture } from "@/lib/llm/matrix-capture";
import type { TokenUsage } from "@/lib/types";

// The fleet. Diverse vendors so no single family dominates; the judge (JUDGE_MODEL) is one of them —
// the self-preference caveat is documented in docs/LLM_MODEL_MATRIX.md.
const MODELS = [
  "openai/gpt-4o-mini",
  "openai/gpt-5.4-mini",
  "google/gemini-3.5-flash",
  "deepseek/deepseek-v4-flash",
  "z-ai/glm-5.2",
  "anthropic/claude-sonnet-5",
];
const JUDGE_MODEL = process.env.MATRIX_JUDGE_MODEL || "anthropic/claude-sonnet-5";
const INPUTS_DIR = "bench/matrix-inputs";
const OUT_DIR = "bench/matrix";

const lvlNum = (id: string): number => parseInt(String(id).slice(1), 10) || 0;

function loadEnvLocal(): void {
  try {
    const txt = readFileSync(resolve(process.cwd(), ".env.local"), "utf8");
    for (const line of txt.split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
      const key = m?.[1];
      const val = m?.[2];
      if (key && val !== undefined && !process.env[key]) process.env[key] = val.replace(/^["']|["']$/g, "");
    }
  } catch {
    /* ambient env only */
  }
}

interface JudgeScore {
  score: number;
  relevance: number;
  correctness: number;
  adherence: number;
  verdict: string;
}

async function judge(repo: string, archetype: string, assessment: unknown): Promise<JudgeScore | null> {
  const system =
    "You are a strict senior engineering reviewer scoring the QUALITY of an automated repo-maturity " +
    "assessment. Score ONLY the given assessment against the task and the repo context. You are given " +
    "the structured output, not the full repo, so weight coherence, specificity, task-adherence and " +
    "usefulness of the dimension summaries / roadmap; do not assert facts you cannot verify. Return ONLY JSON.";
  const user = [
    `Repo: ${repo} (archetype: ${archetype})`,
    "Task: assess the repo's engineering maturity — per-dimension scores + summaries, a headline, strengths, risks, and a prioritized roadmap.",
    "Assessment to score (JSON):",
    JSON.stringify(assessment).slice(0, 12000),
    'Return ONLY: {"score":<1-10>,"relevance":<1-10>,"correctness":<1-10>,"adherence":<1-10>,"verdict":"<one sentence>"}',
  ].join("\n\n");
  try {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "HTTP-Referer": "https://ascent.dev",
        "X-Title": "Ascent",
      },
      body: JSON.stringify({
        model: JUDGE_MODEL,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content;
    if (!text) return null;
    const p = JSON.parse(text) as Record<string, unknown>;
    const num = (v: unknown) => (typeof v === "number" ? v : Number(v));
    const score = num(p.score);
    if (!Number.isFinite(score)) return null;
    return {
      score,
      relevance: num(p.relevance) || score,
      correctness: num(p.correctness) || score,
      adherence: num(p.adherence) || score,
      verdict: typeof p.verdict === "string" ? p.verdict : "",
    };
  } catch {
    return null;
  }
}

interface Record_ {
  repo: string;
  model: string;
  expected: string;
  predicted: string | null;
  overallScore: number | null;
  levelDelta: number | null;
  usable: boolean;
  error: string | null;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  judge: JudgeScore | null;
}

async function main(): Promise<void> {
  loadEnvLocal();
  if (!process.env.OPENROUTER_API_KEY) {
    console.error("OPENROUTER_API_KEY is required (the matrix runs every model through OpenRouter).");
    process.exit(1);
  }
  const labels = new Map<string, string>();
  for (const r of JSON.parse(readFileSync(resolve("bench/repos.json"), "utf8")).repos as { repo: string; expected: string }[]) {
    labels.set(r.repo, r.expected);
  }
  const files = readdirSync(INPUTS_DIR).filter((f) => f.endsWith(".json"));
  const fixtures: MatrixFixture[] = files.map((f) => JSON.parse(readFileSync(resolve(INPUTS_DIR, f), "utf8")));
  console.log(`\nMatrix · ${fixtures.length} repos × ${MODELS.length} models · judge ${JUDGE_MODEL}\n`);

  const records: Record_[] = [];
  for (const fx of fixtures) {
    const expected = labels.get(fx.repo) ?? "?";
    // Models run concurrently per repo; assess() + judge() are independent per model.
    const perModel = await Promise.all(
      MODELS.map(async (model): Promise<Record_> => {
        const rec: Record_ = {
          repo: fx.repo, model, expected, predicted: null, overallScore: null, levelDelta: null,
          usable: false, error: null, latencyMs: 0, inputTokens: 0, outputTokens: 0, judge: null,
        };
        let usage: TokenUsage = {};
        const started = Date.now();
        try {
          const assessment = await new OpenRouterProvider({ model }).assess(fx.scoreInput, {
            onUsage: (u) => { usage = u; },
          });
          rec.latencyMs = Date.now() - started;
          rec.inputTokens = usage.inputTokens ?? 0;
          rec.outputTokens = usage.outputTokens ?? 0;
          rec.usable = isAssessmentUsable(assessment, fx.scoreInput.signals.length);
          const report = assembleReport(fx.snapshot, fx.scoreInput.signals, assessment, { name: "openrouter", model }, fx.at, fx.scoreInput.archetype);
          rec.predicted = report.level.id;
          rec.overallScore = report.overallScore;
          rec.levelDelta = Math.abs(lvlNum(report.level.id) - lvlNum(expected));
          if (rec.usable) rec.judge = await judge(fx.repo, fx.scoreInput.archetype, assessment);
        } catch (e) {
          rec.latencyMs = Date.now() - started;
          rec.error = e instanceof Error ? e.message.slice(0, 160) : String(e);
        }
        const flag = rec.error ? "✗" : rec.judge ? `${rec.judge.score}` : "·";
        console.log(`  ${fx.repo.padEnd(38)} ${model.padEnd(28)} exp ${expected} got ${rec.predicted ?? "—"} judge ${flag}`);
        return rec;
      }),
    );
    records.push(...perModel);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(resolve(OUT_DIR, "records.json"), JSON.stringify(records, null, 2), "utf8");
  writeFileSync(resolve(OUT_DIR, "summary.md"), summarize(records), "utf8");
  console.log(`\nWrote ${OUT_DIR}/records.json + summary.md\n`);
  console.log(summarize(records));
}

function summarize(records: Record_[]): string {
  const byModel = new Map<string, Record_[]>();
  for (const r of records) (byModel.get(r.model) ?? byModel.set(r.model, []).get(r.model)!).push(r);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
  const rows = [...byModel.entries()].map(([model, rs]) => {
    const judged = rs.filter((r) => r.judge).map((r) => r.judge!.score);
    const scored = rs.filter((r) => r.usable && r.predicted !== null);
    const exact = scored.filter((r) => r.levelDelta === 0).length;
    const within1 = scored.filter((r) => (r.levelDelta ?? 9) <= 1).length;
    return {
      model,
      quality: mean(judged),
      exact: scored.length ? exact / scored.length : 0,
      within1: scored.length ? within1 / scored.length : 0,
      mae: mean(scored.map((r) => r.levelDelta ?? 0)),
      reliability: rs.length ? rs.filter((r) => r.usable).length / rs.length : 0,
      latency: mean(rs.filter((r) => !r.error).map((r) => r.latencyMs)),
      outTok: mean(rs.filter((r) => !r.error).map((r) => r.outputTokens)),
      n: rs.length,
    };
  });
  rows.sort((a, b) => b.quality - a.quality);
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const lines = [
    "| model | quality | exact | within-1 | MAE | reliability | p50 latency | out tok |",
    "|---|--:|--:|--:|--:|--:|--:|--:|",
  ];
  for (const r of rows) {
    lines.push(
      `| ${r.model} | ${r.quality.toFixed(2)} | ${pct(r.exact)} | ${pct(r.within1)} | ${r.mae.toFixed(2)} | ${pct(r.reliability)} | ${Math.round(r.latency)}ms | ${Math.round(r.outTok)} |`,
    );
  }
  return lines.join("\n") + "\n";
}

void main();
