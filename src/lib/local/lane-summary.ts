// OPTIONAL LLM POLISH of a lane's deliverable headlines — never on the lane's critical path.
//
// `deriveLaneDeliverables` (lane-deliverables.ts) is the deterministic producer and is always what a
// lane gets. When a text runner resolves, this asks it to REWRITE EACH HEADLINE IN PLACE — same count
// in, same count out, merged by index — tightening a clause the agent wrote loosely into the house
// verb-first shape ("Hardened GitHub CI/CD"). It never condenses: the owner reviews each individual
// gap, so a rewrite that merged or dropped rows would remove the per-gap control the review gate
// needs. The answer is validated against the list it was given: every index exactly once, every
// headline ≤ 8 words, nothing invented — a response with a different count is rejected outright.
// A null runner, a timeout, a thrown transport or an answer that fails validation all keep the
// deterministic list, exactly as `analyzeWrite` (memory/consolidation.ts) keeps its heuristic
// verdict. Same shape as `resolveMemoryRunner`: a tagged leg kind, a bounded timeout, the org's
// ledger.

import type { LaneDeliverable } from "@/lib/db/loop-runs-types";
import { HEADLINE_WORDS } from "@/lib/local/lane-deliverables";
import { resolveTextRunner } from "@/lib/llm/text";
import type { TextRunner } from "@/lib/llm/leg";

/** Hard ceiling on the polish call — a lane is never held longer than this for a rewrite. */
export const LANE_SUMMARY_TIMEOUT_MS = 20_000;

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
    "You are rewriting the headlines of what one automated remediation lane delivered to a repository, for a dashboard cell.",
    `Below is the derived list. Rewrite EACH headline in place — one rewrite per entry, same count out as in. Never merge entries, never drop one, never add one: each entry is one gap the owner reviews individually.`,
    `Each headline: ≤ ${HEADLINE_WORDS} words, verb-first, past tense, naming the artefact (e.g. "Hardened GitHub CI/CD", "Added permissions scope to 3 workflows"). Never invent work the entry does not contain; keep a headline that is already good.`,
    "",
    "Answer with JSON only, no prose — one object per entry, every index exactly once:",
    '[{"i":0,"headline":"Hardened GitHub CI/CD"}, {"i":1,"headline":"…"}, …]',
    "",
    ...rows,
  ].join("\n");
}

/**
 * Parse + validate the model's answer against the source list; null when it is not usable. The
 * merge is BY INDEX: entry `i` rewrites `list[i]`'s headline and nothing else — dimension, kind,
 * covers, evidence and any review ride through untouched. A response whose count differs from the
 * list's, names an index twice, or misses one is rejected whole.
 */
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
  if (!Array.isArray(parsed) || parsed.length !== list.length) return null;
  const headlines = new Map<number, string>();
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") return null;
    const e = entry as { i?: unknown; headline?: unknown };
    if (typeof e.headline !== "string" || typeof e.i !== "number" || !Number.isInteger(e.i)) return null;
    if (e.i < 0 || e.i >= list.length || headlines.has(e.i)) return null;
    const headline = e.headline.replace(/\s+/g, " ").trim().replace(/[.;:,\s]+$/, "");
    if (!headline || headline.split(" ").length > HEADLINE_WORDS) return null;
    headlines.set(e.i, headline[0]!.toUpperCase() + headline.slice(1));
  }
  return list.map((d, i) => ({ ...d, headline: headlines.get(i)! }));
}

/**
 * Polish `list` through `run`, or return it unchanged. Never throws, never blocks past the runner's
 * own timeout (the seam's wrapper enforces LANE_SUMMARY_TIMEOUT_MS).
 */
export async function polishLaneDeliverables(list: readonly LaneDeliverable[], run: TextRunner | null, signal?: AbortSignal): Promise<LaneDeliverable[]> {
  if (!run || list.length === 0) return [...list];
  try {
    const raw = await run(buildLaneSummaryPrompt(list), signal);
    return parseLaneSummary(raw, list) ?? [...list];
  } catch {
    return [...list];
  }
}
