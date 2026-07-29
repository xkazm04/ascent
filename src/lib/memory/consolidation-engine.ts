// The LLM seam for Shared Org Memory's write-intelligence and reflection passes. Resolves the
// `RunPrompt` that the pure, provider-free cores (consolidation.ts, reflection.ts) call — or null when
// no model is reachable, in which case the write gate degrades to its deterministic heuristic and
// reflection honestly returns nothing. Keeping this split means the judgment logic stays unit-testable
// without spawning or calling anything, and a future MCP/REST adapter reuses both halves.
//
// UNTIL 2026-07-29 THIS RETURNED null IN PRODUCTION, ALWAYS. The only text engine wired was the local
// `claude` CLI (local-dev-only by construction), so in any deployment `proposeReflections` returned []
// on every call and the `summary` memory kind was unreachable — a taxonomy with a fourth kind nothing
// on the planet could produce. The fix is the one this file's own comment predicted: return a different
// RunPrompt here. Neither the cores nor the routes changed shape.
//
// PROVIDER SELECTION IS NOT DECIDED HERE. `resolveTextRunner` (src/lib/llm/text.ts) reuses the SAME
// `resolveProviderChoice()` + `providerAvailable()` the scan pipeline uses, so "which provider, and is
// it usable here?" still has exactly one answer in this codebase — including the claude-cli
// NODE_ENV-gated dynamic import that keeps child_process.spawn out of the production file trace.

import { resolveTextRunner } from "@/lib/llm/text";
import type { RunPrompt } from "@/lib/memory/consolidation";
import type { ProviderName } from "@/lib/types";

/**
 * A duplicate check (and a reflection pass) runs while a human waits on a button. The scan-sized budget
 * (10 min for the CLI, 60s for a hosted call) would read as a hung page, so cap it here and let the core
 * degrade on timeout. Override with MEMORY_CHECK_TIMEOUT_MS.
 */
const CHECK_TIMEOUT_MS = Number(process.env.MEMORY_CHECK_TIMEOUT_MS) || 90_000;

export interface MemoryRunner {
  run: RunPrompt;
  /** Which provider answered — so the UI can say "gemini judged this", not just "an LLM did". */
  engine: ProviderName;
  model: string;
}

/**
 * Resolve the prompt runner for the memory passes, or null when no model is reachable (LLM_PROVIDER
 * unset/mock, a missing key, or claude-cli on a production host). Null is a first-class, expected
 * result — `analyzeWrite` treats it as "use the deterministic heuristic", and `proposeReflections`
 * treats it as "propose nothing, and SAY so" (`llmUnavailable: true`).
 */
export async function resolveMemoryRunner(): Promise<MemoryRunner | null> {
  const runner = await resolveTextRunner({ timeoutMs: CHECK_TIMEOUT_MS });
  return runner ? { run: runner.run, engine: runner.engine, model: runner.model } : null;
}
