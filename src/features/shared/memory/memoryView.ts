// Pure shaping for the Prism memory composition. Scores and ages stay the server's; this file only
// picks a ladder or cell state and formats text both themes already agreed on.
import type { CellState, LadderState, LadderStep } from "@/components/kit";
import type { MemoryRow } from "@/lib/db";
import type { StaleRepo } from "@/lib/memory/coverage";
import { CONFIDENCE_BANDS, confidenceLabel, isRepoMemorySource, isScanPipelineSource } from "@/lib/org/memory-kinds";
import type { IneligibleReason } from "./memoryRecall";

export const STALE_SHOWN = 5;

const BANDS = ["low", "medium", "high"] as const;

function bandName(id: (typeof BANDS)[number]): string {
  return CONFIDENCE_BANDS.find((b) => b.id === id)?.label.split(":")[0] ?? id;
}

/** Sentence-case trust word for a stored score, e.g. "Medium trust". */
export function trustWord(confidence: number): string {
  const id = confidenceLabel(confidence);
  const name = (BANDS as readonly string[]).includes(id) ? bandName(id as (typeof BANDS)[number]) : id;
  return `${name} trust`;
}

export function excerpt(text: string, max = 220): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function quantile(sorted: number[], q: number): number {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(q * (sorted.length - 1))));
  return sorted[i] ?? 0;
}

export function confidenceSpread(memories: Pick<MemoryRow, "confidence">[]): {
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  n: number;
} | null {
  const sorted = memories
    .map((m) => m.confidence)
    .filter((c): c is number => typeof c === "number" && Number.isFinite(c))
    .sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  return {
    min: sorted[0] ?? 0,
    q1: quantile(sorted, 0.25),
    median: quantile(sorted, 0.5),
    q3: quantile(sorted, 0.75),
    max: sorted[sorted.length - 1] ?? 0,
    n: sorted.length,
  };
}

export function trustLadder(confidence: number): LadderStep[] {
  if (typeof confidence !== "number" || !Number.isFinite(confidence)) {
    return BANDS.map((id) => ({ key: id, label: bandName(id), state: "unmeasured" as const }));
  }
  const at = BANDS.indexOf(confidenceLabel(confidence) as (typeof BANDS)[number]);
  return BANDS.map((id, i) => {
    const state: LadderState = at < 0 ? "unmeasured" : i < at ? "reached" : i === at ? "current" : "open";
    return { key: id, label: bandName(id), state };
  });
}

export function bandCounts(memories: Pick<MemoryRow, "confidence">[]): LadderStep[] {
  const counts = { low: 0, medium: 0, high: 0 };
  for (const m of memories) {
    if (typeof m.confidence !== "number" || !Number.isFinite(m.confidence)) continue;
    const id = confidenceLabel(m.confidence);
    if (id === "low" || id === "medium" || id === "high") counts[id] += 1;
  }
  return BANDS.map((id) => ({
    key: id,
    label: bandName(id),
    state: counts[id] > 0 ? "reached" : "open",
    detail: String(counts[id]),
  }));
}

export function staleWindow(repos: StaleRepo[]): { shown: StaleRepo[]; more: number; wentQuiet: number; neverRecorded: number } {
  const wentQuiet = repos.filter((r) => r.lastMemoryAt).length;
  return {
    shown: repos.slice(0, STALE_SHOWN),
    more: Math.max(0, repos.length - STALE_SHOWN),
    wentQuiet,
    neverRecorded: repos.length - wentQuiet,
  };
}

export function coverageBands(input: { fresh: number; total: number; wentQuiet: number; neverRecorded: number }): LadderStep[] {
  return [
    { key: "fresh", label: "Fresh", state: input.fresh > 0 ? "reached" : "open", detail: `${input.fresh} of ${input.total}` },
    { key: "quiet", label: "Went quiet", state: input.wentQuiet > 0 ? "current" : "open", detail: `${input.wentQuiet} repos` },
    {
      key: "never",
      label: "Never recorded",
      state: input.neverRecorded > 0 ? "unmeasured" : "open",
      detail: input.neverRecorded > 0 ? `${input.neverRecorded} repos` : "none",
    },
  ];
}

/** A factor length of 0 is a counted zero. Non-finite is the only unmeasured state. */
export function factorState(value: number): LadderState {
  if (!Number.isFinite(value)) return "unmeasured";
  if (value >= 0.85) return "reached";
  if (value > 0) return "current";
  return "open";
}

export function reflectLadder(input: {
  consideredCount: number;
  clusterCount: number;
  proposalCount: number;
  llmUnavailable: boolean;
}): LadderStep[] {
  return [
    {
      key: "considered",
      label: "Considered",
      state: input.consideredCount > 0 ? "reached" : "open",
      detail: String(input.consideredCount),
    },
    {
      key: "families",
      label: "Families",
      state: input.clusterCount > 0 ? "reached" : "open",
      detail: String(input.clusterCount),
    },
    {
      key: "proposals",
      label: "Proposals",
      state: input.llmUnavailable ? "unmeasured" : input.proposalCount > 0 ? "current" : "open",
      detail: input.llmUnavailable ? "no engine" : String(input.proposalCount),
    },
  ];
}

export function ineligibleCell(reason: IneligibleReason): CellState {
  return reason === "filtered" ? "unmeasured" : "missing";
}

export function ageLabel(ageDays: number): string {
  if (!Number.isFinite(ageDays)) return "not measured";
  if (ageDays < 1) return "today";
  if (ageDays < 45) return `${Math.round(ageDays)}d`;
  return `${(ageDays / 30.44).toFixed(1)}mo`;
}

export function memoryByline(m: Pick<MemoryRow, "createdBy" | "source">): string {
  if (m.createdBy) return m.createdBy;
  if (isRepoMemorySource(m.source)) return "an agent in the repo";
  if (isScanPipelineSource(m.source)) return "the scan pipeline";
  return "unknown";
}
