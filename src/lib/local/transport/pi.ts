// THE PI TRANSPORT — the second agent CLI behind the lane's spawn seam, and the reason the bake-off
// is a bake-off rather than a demonstration.
//
// Claude Code's headless mode is the proven path (it drove a local 27B through a real file edit on
// 2026-09-21), but it sends ~16k tokens of its own system prompt before the lane's brief is read, and
// every field report of a local model failing inside an agent harness — parameters silently dropped,
// tool-call JSON corrupted mid-call, drift past twenty steps — is prompt-size-shaped. Pi carries a
// much smaller prompt. Whether that makes a 27B at 4-bit MORE COMPETENT at the same lane is exactly
// the question the operator asked, and only two adapters can answer it.
//
// STUB — WP2 implements. The export names are final: WP1's registry imports `piProfile` from here.

import type { AgentRunResult } from "@/lib/local/agent";
import type { TransportProfile } from "@/lib/local/transport/profile";
import type { TransportRunOptions } from "@/lib/local/transport/run";

/** Pi's capability row. Every cell WP2 cannot confirm with a live run stays null (unverified). */
export const piProfile: TransportProfile = {
  id: "pi",
  label: "Pi",
  bin: "pi",
  // Placeholder band — WP2 replaces these with numbers it measured, not numbers it guessed.
  timing: { agentMs: 1_200_000, planMs: 480_000, quietMs: 90_000 },
  // Pi reports no dollar cost for a local model, and an absent price is NULL, never 0.
  zeroCost: true,
  caps: {
    streamJson: null,
    editStance: null,
    planStance: null,
    resume: null,
    promptOnStdin: null,
  },
};

export function runPiAgent(_opts: TransportRunOptions): Promise<AgentRunResult> {
  return Promise.resolve({ ok: false, summary: "runPiAgent: not implemented (WP2)" });
}
