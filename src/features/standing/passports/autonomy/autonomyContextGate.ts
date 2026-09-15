// The context-contract gate, split out of autonomyGateBuilders.ts to keep both files under the
// 200-LOC cap that governs src/features/** (AGENTS.md). Pure relocation plus the Direction 8 rewrite
// described below; autonomyGateBuilders re-exports it, so no call site moved.
//
// No "use client": a pure derivation with no hook and no handler, called from the SERVER component
// that builds the tab.

import type { AppPassport, ContextHealth } from "@/lib/types";
import type { ManifestReadout } from "@/lib/standard/readout";

import { statusOf, type AutonomyGate } from "./autonomyGates";

/**
 * The context contract. Presence of AGENTS.md/CLAUDE.md, the context graph, the manifest and the
 * memory/skills grades are observed by the scan; FRESHNESS is observed by the W4 context-health read
 * (Repository.contextHealthJson), threaded in by PassportsTab.
 *
 * Direction 8 — THE MOCK PENALTY IS GONE. This gate used to subtract up to 25 points derived from
 * `hashUnit(key + ":ctx")` — a hash of the repo's NAME — and then report `source: "scan"` whenever a
 * manifest readout existed. So a score containing pure fiction wore a measured badge, and the honesty
 * pin rendered nothing: exactly the failure `SourcePin` exists to prevent. The signal is real now, so
 * the honest fix is to read it rather than to label the fiction. A repo whose scan recorded no
 * freshness (pre-W4, or a lookup that failed) takes NO penalty and says "freshness not measured" —
 * unmeasured is not stale, and inventing a decay is how a grade stops meaning anything.
 */
export function contextGate(
  pp: AppPassport,
  conformance: number | null,
  /** #13 — what the scan READ in this repo's `.ai/manifest.yaml`. Optional and null-safe: a repo
   *  scanned before the readout shipped keeps exactly today's scoring, so nothing moves for a repo
   *  we have not actually looked at. */
  manifest?: ManifestReadout | null,
  /** W4 — the persisted context-health read. Null (or a null freshness score) = UNKNOWN. */
  contextHealth?: ContextHealth | null,
): AutonomyGate {
  const a = pp.automationReadiness.artifacts;
  const files = a.agentInstructions.length;
  const graph = a.contextGraph === "full" ? 25 : a.contextGraph === "partial" ? 12 : 0;
  const grade = (g: string) => (g === "governed" ? 12 : g === "curated" ? 8 : g === "adhoc" ? 4 : 0);
  // The manifest used to be worth a flat +10 for EXISTING. Presence keeps that 10; the new 8 is
  // earned by PROOF — the fraction of declared capabilities the repo's own doctor has run and
  // passed. A repo that declares nothing, or that we could not read, earns 0 of the 8 rather than a
  // fabricated share of it: unproven is not half-proven.
  const readable = manifest?.status === "ok" ? manifest : null;
  const declared = readable?.capabilities.length ?? 0;
  const verified = readable?.capabilities.filter((c) => c.verified === true).length ?? 0;
  const proof = declared > 0 ? Math.round((8 * verified) / declared) : 0;
  const observed = Math.min(100, Math.min(30, files * 15) + graph + (a.manifest ? 10 : 0) + proof + grade(a.memory) + grade(a.skills) + (conformance != null ? Math.round(conformance * 0.11) : 0));

  // MEASURED staleness. `freshness.score` is remaining potency under the repo's own churn (100 =
  // freshly edited); the penalty is its complement, capped at the same 25 the placeholder used so the
  // gate's range is unchanged. Unknown freshness, or no guidance file at all, costs nothing.
  const fresh = contextHealth?.freshness;
  const freshKnown = files > 0 && typeof fresh?.score === "number";
  const stalePenalty = freshKnown ? Math.round((25 * (100 - fresh.score!)) / 100) : 0;
  const score = Math.round(Math.max(0, observed - stalePenalty));
  const freshEvidence = freshKnown
    ? `context ${fresh.score}% fresh${fresh.ageDays != null ? ` · edited ~${fresh.ageDays}d ago` : ""}`
    : files > 0
      ? "freshness not measured on this scan"
      : "no guidance file to age";
  return {
    id: "context",
    label: "Context contract",
    short: "AGENTS",
    status: statusOf(score),
    score,
    evidence: `${files ? a.agentInstructions.join(", ") : "no AGENTS.md / CLAUDE.md"} · ${a.contextGraph} context graph${
      a.manifest ? " · .ai manifest" : ""
    }${readable ? ` · ${verified}/${declared} capabilities proven` : ""} · ${freshEvidence}`,
    action:
      files === 0
        ? "Write a human-curated AGENTS.md. LLM-generated context files measurably hurt."
        : stalePenalty > 12
          ? "Refresh the context file; it has drifted behind the repo's change rate."
          : "Deepen the context graph so an unattended run starts oriented.",
    // Every input to `score` is now observed: passport artifact fields, the manifest readout, and the
    // W4 freshness read (or its ABSENCE, which subtracts nothing). Nothing here is fabricated, so the
    // gate can honestly report "scan" — which is what the honesty pin depends on meaning something.
    source: "scan",
    gatesTier: 3,
  };
}
