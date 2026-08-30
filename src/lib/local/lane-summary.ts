// OPTIONAL LLM POLISH of a lane's deliverable headlines — never on the lane's critical path.
//
// `deriveLaneDeliverables` (lane-deliverables.ts) is the deterministic producer and is always what a
// lane gets. When a text runner resolves, this asks it to CONDENSE that list into ≤ 4 headlines —
// merge two closes that are one change, tighten a clause the agent wrote loosely — and validates the
// answer against the list it was given: every index must exist, every headline must be ≤ 8 words,
// nothing may be invented. A null runner, a timeout, a thrown transport or an answer that fails
// validation all keep the deterministic list, exactly as `analyzeWrite` (memory/consolidation.ts)
// keeps its heuristic verdict. Same shape as `resolveMemoryRunner`: a tagged leg kind, a bounded
// timeout, the org's ledger.

import type { LaneDeliverable } from "@/lib/db/loop-runs-types";
import { HEADLINE_WORDS } from "@/lib/local/lane-deliverables";
import { resolveTextRunner } from "@/lib/llm/text";
import type { TextRunner } from "@/lib/llm/leg";

/** Hard ceiling on the polish call — a lane is never held longer than this for a rewrite. */
export const LANE_SUMMARY_TIMEOUT_MS = 20_000;
export const LANE_SUMMARY_MAX = 4;

/** The runner, or null when no model is reachable — the caller then keeps the derived list. */
export async function resolveLaneSummaryRunner(orgSlug: string | null | undefined): Promise<TextRunner | null> {
  try {
    const runner = await resolveTextRunner({
      legKind: "lane_summary",
      timeoutMs: LANE_SUMMARY_TIMEOUT_MS,
      meter: { orgSlug: orgSlug ?? null },
    });
    return runner?.run ?? null;
  } catch {
    return null;
  }
}

export function buildLaneSummaryPrompt(list: readonly LaneDeliverable[]): string {
  const rows = list.map((d, i) => `${i}. [${d.kind}${d.dimId ? ` ${d.dimId}` : ""}] ${d.headline}${d.evidence ? ` — ${d.evidence}` : ""}`);
  return [
    "You are condensing what one automated remediation lane delivered to a repository into headlines for a dashboard cell.",
    `Below is the derived list. Return AT MOST ${LANE_SUMMARY_MAX} headlines that cover it: merge entries that are one change, keep entries that are distinct, drop nothing that is not covered by a merge.`,
    `Each headline: ≤ ${HEADLINE_WORDS} words, verb-first, past tense, naming the artefact (e.g. "Hardened GitHub CI/CD", "Added permissions scope to 3 workflows"). Never invent work the list does not contain.`,
    "",
    "Answer with JSON only, no prose:",
    '[{"merges":[0,2],"headline":"Hardened GitHub CI/CD"}, …]',
    "",
    ...rows,
  ].join("\n");
}

/** Parse + validate the model's answer against the source list; null when it is not usable. */
export function parseLaneSummary(raw: string, list: readonly LaneDeliverable[]): LaneDeliverable[] | null {
  const text = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
  const start = text.indexOf("[");
  if (start < 0) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.slice(start, text.lastIndexOf("]") + 1));
  } catch {
    return null;
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > LANE_SUMMARY_MAX) return null;
  const used = new Set<number>();
  const out: LaneDeliverable[] = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") return null;
    const e = entry as { merges?: unknown; headline?: unknown };
    if (typeof e.headline !== "string" || !Array.isArray(e.merges) || e.merges.length === 0) return null;
    const headline = e.headline.replace(/\s+/g, " ").trim().replace(/[.;:,\s]+$/, "");
    if (!headline || headline.split(" ").length > HEADLINE_WORDS) return null;
    const idx = e.merges.map((m) => (typeof m === "number" && Number.isInteger(m) ? m : -1));
    if (idx.some((i) => i < 0 || i >= list.length || used.has(i))) return null;
    idx.forEach((i) => used.add(i));
    const members = idx.map((i) => list[i]!);
    const dimIds = new Set(members.map((m) => m.dimId));
    out.push({
      headline: headline[0]!.toUpperCase() + headline.slice(1),
      dimId: dimIds.size === 1 ? members[0]!.dimId : null,
      kind: members[0]!.kind,
      covers: [...new Set(members.flatMap((m) => m.covers))],
      evidence: members.find((m) => m.evidence)?.evidence ?? null,
    });
  }
  // Anything the model left out rides along untouched, up to the cap — a rewrite must not lose work.
  for (let i = 0; i < list.length && out.length < LANE_SUMMARY_MAX; i++) if (!used.has(i)) out.push(list[i]!);
  return out;
}

/**
 * Polish `list` through `run`, or return it unchanged. Never throws, never blocks past the runner's
 * own timeout (the seam's wrapper enforces LANE_SUMMARY_TIMEOUT_MS).
 */
export async function polishLaneDeliverables(list: readonly LaneDeliverable[], run: TextRunner | null, signal?: AbortSignal): Promise<LaneDeliverable[]> {
  if (!run || list.length <= 1) return [...list];
  try {
    const raw = await run(buildLaneSummaryPrompt(list), signal);
    return parseLaneSummary(raw, list) ?? [...list];
  } catch {
    return [...list];
  }
}
