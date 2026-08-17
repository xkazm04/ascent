// Scan phase: deterministic analysis → the LlmScoreInput handed to the model.
//
// Extracted verbatim from scanRepository (src/lib/scan.ts). This is where the ingested snapshot plus
// the GitHub enrichments become dimension signals: PR + governance folded in, D9 REPLACED by the
// deterministic security check battery, archetype/stack-fit/tech-stack detected once, and the org's
// standing decisions read (best-effort — an unreachable decision store must never fail a scan).
//
// The only I/O here is that decision read; everything else is pure over the snapshot.

import { analyzeSignals, classifyArchetype, offPlatformReview } from "@/lib/analyze";
import { applyGovernanceSignals, applyPrSignals } from "@/lib/analyze/pulls";
import { applyAppInventorySignals, applyCiHealthSignals } from "@/lib/analyze/platform-signals";
import type { AppInventory } from "@/lib/github/check-suites";
import type { CiHealth } from "@/lib/github/actions-health";
import { detectStackFit, type StackFit } from "@/lib/analyze/stack-fit";
import { extractTechStack } from "@/lib/analyze/tech-extract";
import { computeSecurityChecks } from "@/lib/security/checks";
import { techStackPromptEnabled } from "@/lib/llm/config";
import { decisionsForRepo } from "@/lib/db";
import type { LlmScoreInput } from "@/lib/llm/provider";
import type {
  DimensionSignals,
  Governance,
  PrStats,
  RepoArchetype,
  RepoSnapshot,
  SecurityExposure,
  SecurityPosture,
  TechStack,
} from "@/lib/types";

export interface ScoreInputPhaseInput {
  snapshot: RepoSnapshot;
  prStats: PrStats | null;
  governance: Governance | null;
  securityPosture: SecurityPosture | null;
  securityExposure: SecurityExposure | null;
  /** Deepening pass: installed-App inventory on the scored commit; null = not observable. */
  appInventory?: AppInventory | null;
  /** Deepening pass: default-branch Actions run health; null = not observable. */
  ciHealth?: CiHealth | null;
  /** The scan timestamp, resolved once by the caller so D7's recency bonus is deterministic. */
  now: string;
  /**
   * Which workspace to read STANDING DECISIONS from (`decisionOrgSlug ?? orgSlug`). Undefined /
   * empty ⇒ no decisions are read at all.
   */
  decisionSlug?: string;
}

export interface ScoreInputPhaseResult {
  signals: DimensionSignals[];
  archetype: RepoArchetype;
  /** Non-null when the rubric is known to under-read this stack — also becomes a report caveat. */
  stackFit: StackFit | null;
  /** Always attached to the report; only in the PROMPT when the gated flag is on. */
  techStack: TechStack;
  scoreInput: LlmScoreInput;
  /** Caveats raised by the signal detectors themselves — the seed of the report's warnings. */
  detectorWarnings: string[];
}

/** Build the model's input from the ingested snapshot + GitHub enrichments. */
export async function buildScanScoreInput(input: ScoreInputPhaseInput): Promise<ScoreInputPhaseResult> {
  const { snapshot, prStats, governance, securityPosture, securityExposure, now, decisionSlug } = input;
  const appInventory = input.appInventory ?? null;
  const ciHealth = input.ciHealth ?? null;

  const detectorWarnings: string[] = [];
  // Deepening pass: the platform-observed folds (installed Apps, CI health) run AFTER PR + governance
  // so their "only when the file scan found none" guards see the full evidence list.
  const baseSignals = applyCiHealthSignals(
    applyAppInventorySignals(
      applyGovernanceSignals(
        applyPrSignals(analyzeSignals(snapshot, now, detectorWarnings), prStats, {
          // Suppress the misleading GitHub reviewedRate when review runs off-platform (Gerrit/bors) — the
          // gate is credited positively in the D6 detector from the same commit trailers.
          offPlatformReview: offPlatformReview(snapshot.commits) != null,
        }),
        governance,
      ),
      appInventory,
    ),
    ciHealth,
  );
  // Security (D9) is scored by the DETERMINISTIC check battery (OpenSSF-Scorecard-style: graded,
  // risk-weighted, auditable) rather than the file-grep detector + LLM blend. It reads the full
  // workflow set + governance + posture + exposure, and its result REPLACES the D9 signal, flagged
  // `deterministic` so the engine takes the number as-is (the LLM only narrates D9, per the framework).
  const securityAssessment = computeSecurityChecks(snapshot, governance, securityPosture, securityExposure, appInventory);
  const signals = baseSignals.map((s) =>
    s.id === "D9"
      ? { ...s, signalScore: securityAssessment.d9, deterministic: true, gaps: securityAssessment.gaps, signals: securityAssessment.evidence.map((label) => ({ label })) }
      : s,
  );
  const archetype = classifyArchetype(snapshot);
  // Stack-fit (ML/notebook · mobile · embedded) is a known blind spot of the web/service-tuned rubric.
  // Detect it HERE — before the assessment — and thread it into the prompt so the model's roadmap +
  // discrepancy audit calibrate to the stack instead of judging notebooks on web conventions. Detected
  // once and reused for the user-facing warning later. [Tiger P0-2]
  const stackFit = detectStackFit(snapshot);
  // Tech-stack detection (Feature 3a): computed once here from the already-fetched manifests/tree.
  // Always attached to the report (display/persist); fed into the PROMPT only when the gated
  // TECH_STACK_PROMPT flag is on (Option B) — default off keeps scans byte-identical.
  const techStack = extractTechStack(snapshot);

  // Standing decisions already made about this repo (accepted/dismissed/snoozed findings and WHY).
  // Best-effort: a decision store that's unreachable must never fail a scan, and an unscoped
  // ("public") scan simply has none. This closes the Shared Org Memory loop — the human's reason for
  // dismissing a finding becomes context the next assessment reads instead of re-raising the gap.
  // decisionSlug (individual tier) points the read at the TRIGGERING viewer's personal org on the
  // public funnel; org scans keep reading their own org via the orgSlug fallback.
  const orgDecisions = decisionSlug
    ? await decisionsForRepo(decisionSlug, `${snapshot.meta.owner}/${snapshot.meta.name}`).catch(() => [])
    : [];

  const scoreInput: LlmScoreInput = {
    repo: snapshot.meta,
    signals,
    files: snapshot.files,
    commitSample: snapshot.commits.map((c) => c.message).slice(0, 15),
    archetype,
    ...(orgDecisions.length > 0 ? { orgDecisions } : {}),
    // Already fetched above and folded into the deterministic D3/D6/D7/D8 scores — also hand them to
    // the LLM auditor so it reasons about review/governance with the real evidence (MAT-1).
    prStats,
    governance,
    // The deterministic Security (D9) check battery — its score is FIXED (D9 is `deterministic`); the
    // LLM's job is to narrate it (summary + prioritized gaps) from the same graded evidence, not to
    // re-derive the number. Threaded so the D9 narrative matches the computed score/checks.
    securityAssessment,
    // Name the stack the rubric under-reads so the model weights the affected dimensions accordingly.
    stackFit,
    // Option B (gated): include the detected stack in the prompt only when explicitly enabled.
    ...(techStackPromptEnabled() ? { techStack } : {}),
  };

  return { signals, archetype, stackFit, techStack, scoreInput, detectorWarnings };
}
