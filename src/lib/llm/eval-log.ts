// Opt-in assessment eval log (Tiger P1-4). When ASCENT_EVAL_LOG_DIR is set, every assess() outcome is
// appended as one JSONL record — the prompt, the structured assessment, provenance, metering, latency —
// so a usable-but-wrong answer is debuggable, a prompt-injection is forensically traceable, and the
// model×tier benchmark has a real corpus to score against. OFF by default: no captured content, no
// overhead in production. Best-effort — a sink failure never disturbs a scan. Local-dev / self-host
// only (on an ephemeral serverless FS the file won't persist; point a real sink there if you need it).

import { appendFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { redactSecrets } from "@/lib/security/redact";
import type { LlmAssessment, TokenUsage } from "@/lib/types";

export interface EvalRecord {
  /** ISO timestamp (the scan's `now`). */
  at: string;
  repo: string;
  provider: string;
  model: string;
  /** True when the scan degraded to the deterministic mock floor. */
  degraded: boolean;
  /** Assessment coverage — dimensions actually scored vs requested (the usability gate's basis). */
  coverage: { scored: number; expected: number };
  latencyMs?: number;
  usage?: TokenUsage;
  system: string;
  user: string;
  assessment: LlmAssessment;
}

export function evalLogEnabled(): boolean {
  return Boolean(process.env.ASCENT_EVAL_LOG_DIR);
}

// Redact obvious credentials that could ride along in sampled repo files: defense in depth. The prompt
// is repo content, not secrets, but a committed key shouldn't be re-persisted into the eval log. The
// pattern list lives in ONE place (`@/lib/security/redact`), shared with the prompt egress for text
// written by agents, so the two can never disagree about what a secret looks like.

/**
 * Append one eval record as JSONL when ASCENT_EVAL_LOG_DIR is set. Returns the record id (so a caller
 * could correlate it) or null when logging is off or the write failed. Never throws.
 */
export function captureAssessment(rec: EvalRecord): string | null {
  const dir = process.env.ASCENT_EVAL_LOG_DIR;
  if (!dir) return null;
  try {
    mkdirSync(dir, { recursive: true });
    const id = randomUUID();
    const line = JSON.stringify({
      id,
      ...rec,
      system: redactSecrets(rec.system),
      user: redactSecrets(rec.user),
    });
    appendFileSync(resolve(dir, `assessments-${rec.at.slice(0, 10)}.jsonl`), line + "\n", "utf8");
    return id;
  } catch {
    return null; // a broken eval sink must never fail a scan
  }
}
