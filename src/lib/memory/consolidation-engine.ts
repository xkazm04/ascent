// The LLM seam for Shared Org Memory's write-intelligence pass. Resolves the `RunPrompt` that
// src/lib/memory/consolidation.ts (pure, provider-free) calls — or null when no model is reachable, in
// which case the core degrades to its deterministic heuristic. Keeping this split means the judgment
// logic stays unit-testable without spawning anything, and a future MCP/REST adapter reuses both halves.
//
// TWO PROPERTIES THIS FILE EXISTS TO PRESERVE:
//
//  1. The dynamic `import("@/lib/llm/claude-cli")` lives INSIDE a `NODE_ENV !== "production"` block, not
//     after a guard `throw`. The production build statically inlines NODE_ENV, folds the condition to
//     `false`, and prunes the whole block — import included — dropping claude-cli.ts and its
//     `child_process.spawn` from the Node File Trace. An import placed after a `throw` is still followed
//     by the bundler. Same trick as LazyClaudeCliProvider (src/lib/llm/index.ts) and the PGlite boot
//     (src/instrumentation.ts). Do not "simplify" it.
//
//  2. Availability is decided by the SAME `providerAvailable("claude-cli")` the scan pipeline uses, so
//     "is the CLI usable here?" has exactly one answer in this codebase. It already returns false in
//     production (where assess() would throw) — this module must not invent a second, drifting rule.

import { providerAvailable } from "@/lib/llm";
import type { RunPrompt } from "@/lib/memory/consolidation";

/**
 * A duplicate check runs while a human waits on a button. The scan-sized CLI budget (10 min) would read
 * as a hung page, so cap it far lower and let the core degrade to its heuristic verdict on timeout.
 * Override with MEMORY_CHECK_TIMEOUT_MS.
 */
const CHECK_TIMEOUT_MS = Number(process.env.MEMORY_CHECK_TIMEOUT_MS) || 90_000;

/**
 * Resolve the prompt runner for the write-intelligence pass, or null when no model is reachable
 * (production build, missing `claude` binary, non-dev host). Null is a first-class, expected result —
 * `analyzeWrite` treats it as "use the deterministic heuristic", never as an error.
 *
 * Claude Code CLI is the only engine wired today (it runs under the operator's local subscription, so a
 * duplicate check costs nothing). Adding a hosted provider later means returning a different RunPrompt
 * here; neither the core nor the route changes.
 */
export async function resolveRunPrompt(): Promise<RunPrompt | null> {
  if (!providerAvailable("claude-cli")) return null;

  if (process.env.NODE_ENV !== "production") {
    const { runClaudePrompt } = await import("@/lib/llm/claude-cli");
    return (prompt, signal) => runClaudePrompt(prompt, { signal, timeoutMs: CHECK_TIMEOUT_MS });
  }
  return null;
}
