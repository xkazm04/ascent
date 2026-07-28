// Scan phase: report assembly + the reliability caveats printed on it.
//
// Extracted verbatim from scanRepository (src/lib/scan.ts). `composeScanReport` turns the scored
// assessment into the ScanReport and attaches every display/persist-only projection (AI usage,
// governance, commit activity, CODEOWNERS teams, tech stack, passport, metering).
// `buildScanWarnings` is a PURE function over the facts the scan already knows — it is the one place
// that decides what the user is told about how trustworthy this score is.

import { detectAiUsage } from "@/lib/analyze";
import { buildPassport } from "@/lib/analyze/passport";
import type { StackFit } from "@/lib/analyze/stack-fit";
import type { AiChangeRecord } from "@/lib/analyze/pulls";
import { extractTeamOwnership } from "@/lib/github/codeowners";
import { buildAssessmentPrompt } from "@/lib/scoring/prompt";
import { captureAssessment } from "@/lib/llm/eval-log";
import { assembleReport } from "@/lib/scoring/engine";
import type { LLMProvider, LlmScoreInput } from "@/lib/llm/provider";
import type {
  DimensionSignals,
  Governance,
  LlmAssessment,
  PrStats,
  RepoArchetype,
  RepoSnapshot,
  ScanReport,
  TechStack,
  TokenUsage,
} from "@/lib/types";

export interface ComposePhaseInput {
  snapshot: RepoSnapshot;
  signals: DimensionSignals[];
  assessment: LlmAssessment;
  /** The provider that ACTUALLY scored (post-failover / post-mock-degrade) — the report's engine. */
  provider: LLMProvider;
  now: string;
  archetype: RepoArchetype;
  /** Whose account the inference ran in: true only for a real BYOM provider (never the mock floor). */
  byomScan: boolean;
  prStats: PrStats | null;
  governance: Governance | null;
  /** AI-attributed PRs as evidence rows, from the same GraphQL page prStats was derived from. */
  aiChanges: AiChangeRecord[];
  /** Still-in-flight display-only commit activity, awaited here. */
  activityPromise: Promise<number[] | null>;
  techStack: TechStack;
  /** Token usage of the winning attempt + the LLM stage latency — the metering basis. */
  usage: TokenUsage;
  llmLatencyMs: number;
}

/** Assemble the report and attach every non-scoring projection. */
export async function composeScanReport(input: ComposePhaseInput): Promise<ScanReport> {
  const { snapshot, signals, assessment, provider, now, archetype, byomScan, prStats, governance, techStack } = input;

  const report = assembleReport(snapshot, signals, assessment, provider, now, archetype);
  // WHOSE account the inference ran in. The report header claims "in-account … never leaves the AWS
  // boundary" for every Bedrock scan, but that read as "YOUR account" on Ascent's PLATFORM Bedrock
  // too. byomScan is already computed for the no-platform-failover rule; carrying it onto the report
  // is what lets the chip tell the two apart. A degrade-to-mock keeps the flag false-y with the mock
  // engine, so the chip never renders in that case anyway.
  report.engine.byom = byomScan && provider.name !== "mock";
  report.prStats = prStats;
  // Re-derive AI usage now that PR stats are available: `detected` keys on REAL AI evidence (PR-level
  // AI involvement with tool attribution, committed guidance, or genuine AI co-author trailers) rather
  // than the bot-commit fraction that spuriously counted Renovate/Dependabot as "AI" (reference-scan P0-5).
  report.aiUsage = detectAiUsage(snapshot, prStats);
  report.governance = governance;
  // The AI-change POPULATION behind prStats' rates. Persisted (not scored) so the fleet can later be
  // asked "show me every AI-assisted change in the period and who approved it" — the question a rate
  // structurally cannot answer. Empty on a tokenless scan, where PRs are not observable at all.
  report.aiChanges = input.aiChanges;
  report.commitActivity = await input.activityPromise;
  // Team attribution from CODEOWNERS (the file is already in the snapshot — no extra GitHub call).
  // Display + persist only; it doesn't move the score. Empty array = no CODEOWNERS teams found.
  report.teams = extractTeamOwnership(snapshot.files);
  // Tech-stack detection (Feature 3a): computed once during signal analysis. Always attached for
  // display/persistence (the prompt enrichment is the separate, gated Option-B path).
  report.techStack = techStack;
  // App Readiness Passport: a pure projection of the finished report + snapshot — display/persist-only
  // (never scored, like techStack). report.governance/prStats are already set above; a tokenless scan
  // leaves them null, which makes buildPassport honestly cap the enforced "gated" rungs. See passport.ts.
  report.passport = buildPassport(report, snapshot);
  // Token usage (from the provider that scored) + LLM-stage latency — the cost/usage metering basis,
  // persisted on the Scan row. A mock/keyless scan carries no tokens (cost 0), just the latency.
  report.usage = { ...input.usage, latencyMs: input.llmLatencyMs };
  return report;
}

export interface EvalLogPhaseInput {
  now: string;
  repoFullName: string;
  provider: LLMProvider;
  llmFailed: boolean;
  assessment: LlmAssessment;
  expectedDimensions: number;
  llmLatencyMs: number;
  usage: ScanReport["usage"];
  scoreInput: LlmScoreInput;
}

/**
 * Eval-log capture (opt-in via ASCENT_EVAL_LOG_DIR — Tiger P1-4): record the prompt + structured
 * assessment + provenance + metering so a usable-but-wrong answer is debuggable, an injection is
 * traceable, and the model×tier benchmark has a corpus. The caller gates on `evalLogEnabled()` so the
 * prompt is only ever built when logging is on; best-effort, never blocks the scan.
 */
export function captureScanEvalLog(input: EvalLogPhaseInput): void {
  const { system, user } = buildAssessmentPrompt(input.scoreInput);
  captureAssessment({
    at: input.now,
    repo: input.repoFullName,
    provider: input.provider.name,
    model: input.provider.model,
    degraded: input.llmFailed,
    coverage: { scored: input.assessment.dimensions.length, expected: input.expectedDimensions },
    latencyMs: input.llmLatencyMs,
    usage: input.usage,
    system,
    user,
    assessment: input.assessment,
  });
}

export interface ScanWarningsInput {
  /** Caveats the signal detectors themselves raised — always first. */
  detectorWarnings: string[];
  /** A GitHub token was available (absent ⇒ PR signals were skipped entirely). */
  hasToken: boolean;
  /** An LLM was expected and every attempt failed — the runtime degrade. */
  llmFailed: boolean;
  /** Name of the provider that actually scored. */
  providerName: string;
  /** The caller explicitly asked for the mock (a demo scan) — suppresses the keyless caveat. */
  explicitMock: boolean;
  snapshotTruncated: boolean;
  snapshotCoverage: number;
  stackFit: StackFit | null;
  prPartial: boolean;
  /**
   * Prose caveat for a SCOPED scan (a non-default ref and/or a monorepo sub-path — see
   * `scopeWarning` in src/lib/scan-scope.ts), or null for an ordinary whole-repo default-branch scan.
   * Emitted LAST because it qualifies the whole report's subject rather than one signal's reliability:
   * a reader must not compare it with default-branch scores, and it is deliberately not persisted.
   */
  scopeCaveat?: string | null;
}

/**
 * Surface non-fatal reliability caveats so the score is interpreted in context. Pure: same facts in,
 * same ordered list out. The caller merges the result into `report.warnings` (and stamps
 * `report.prPartial` separately, since that is a typed flag, not prose).
 */
export function buildScanWarnings(input: ScanWarningsInput): string[] {
  const warnings: string[] = [...input.detectorWarnings];
  if (!input.hasToken) {
    warnings.push(
      "Pull-request signals were skipped — they need a GitHub token (GraphQL has no anonymous access).",
    );
  }
  if (input.llmFailed) {
    warnings.push(
      "AI analysis was unavailable, so scores reflect detected signals only (no qualitative nuance).",
    );
  } else if (input.providerName === "mock" && !input.explicitMock) {
    // Keyless / unconfigured deploy: the engine fell back to the deterministic mock from the START —
    // NOT a runtime failure (llmFailed is false, so the caveat above never fires) and NOT an explicit
    // per-request demo (opts.mock). Without this, a keyless public deploy serves the floor as an "AI"
    // scan disclosed only by a quiet engine chip. Say it plainly so a public-badge or audit reader
    // knows the AI layer never ran, instead of inferring it. [Tiger P1-5 / MEI-B1]
    warnings.push(
      "No AI model is configured for this scan, so scores reflect detected signals only (the deterministic rubric — no AI nuance).",
    );
  }
  if (input.snapshotTruncated) {
    warnings.push(
      "This repository is very large — its file tree was truncated, so some signals may be missed.",
    );
  } else if (input.snapshotCoverage < 0.5) {
    warnings.push(
      `Only part of the repository could be inspected (~${Math.round(input.snapshotCoverage * 100)}% coverage); treat scores as indicative.`,
    );
  }
  // Partial-fit caveat: name a stack the web/service-tuned rubric is known to under-read (ML/notebooks,
  // mobile delivery, embedded/firmware) so the score is read honestly rather than taken at face value.
  // Detected during signal analysis and also threaded into the LLM prompt (Tiger P0-2) — reuse it here.
  if (input.stackFit) warnings.push(input.stackFit.caveat);
  // A truncated PR slice makes D6/D7/D8 understate. Say so on the report (the UI, the LLM export and the
  // CI gate all read `warnings`); the caller also stamps the typed `report.prPartial` flag
  // classifyScanResult uses to refuse caching or persisting this report as authoritative.
  if (input.prPartial) {
    warnings.push(
      "Pull-request data was incomplete (GitHub returned a truncated page), so the Review, Velocity and Delivery dimensions may understate. This scan was not cached.",
    );
  }
  // Scope caveat last: it qualifies WHAT was scored, not how reliably, so it should read as the final
  // framing statement rather than be buried among the signal-level caveats.
  if (input.scopeCaveat) warnings.push(input.scopeCaveat);
  return warnings;
}
