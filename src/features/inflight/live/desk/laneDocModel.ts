// The inner pages' reading of one run detail — pure. A lane's log lines classified good / warning /
// failure, its armed batch joined to titles, its report items joined to the rescan's ruling, and the
// order lanes walk in for prev/next. A claim is not a close: a report item the agent calls `resolved`
// is "claimed" until the rescan's `closedIds` says closed.

import type { LoopLaneOutcome, LoopLaneRecord, LoopRunDetail } from "../cockpit/loopTypes";

export type LogKind = "good" | "warn" | "bad" | "info";
export const LOG_GLYPH: Record<LogKind, string> = { good: "✓", warn: "!", bad: "✕", info: "·" };

export function logKind(text: string): LogKind {
  if (/VERIFIED closed|verified closed|passed before/i.test(text)) return "good";
  if (/rejected|broke|failed|error|Error/.test(text)) return "bad";
  if (/NARROWED|Not landing|not a fast-forward|deferred|could not|unavailable|Interrupted/i.test(text)) return "warn";
  return "info";
}

export interface LogLine {
  t: string;
  text: string;
  kind: LogKind;
}

export function logLines(lines: readonly string[]): LogLine[] {
  return lines.map((line) => {
    const m = /^(\d\d:\d\d:\d\d) ([\s\S]*)$/.exec(line);
    const text = m ? m[2]! : line;
    return { t: m ? m[1]! : "", text, kind: logKind(text) };
  });
}

export function logCounts(lines: readonly LogLine[]): Record<"good" | "warn" | "bad", number> {
  const c = { good: 0, warn: 0, bad: 0 };
  for (const l of lines) if (l.kind !== "info") c[l.kind]++;
  return c;
}

export interface BatchItem {
  id: string;
  title: string | null;
  dimId: string | null;
  closed: boolean;
}

export function batchOf(lane: LoopLaneRecord, titles: LoopRunDetail["batchTitles"]): BatchItem[] {
  const closed = new Set(lane.closedIds);
  return lane.batchIds.map((id) => ({ id, title: titles?.[id]?.title ?? null, dimId: titles?.[id]?.dimId ?? null, closed: closed.has(id) }));
}

export interface ReportItem extends BatchItem {
  verdict: string;
  reason: string;
  files: string[];
}

export function reportOf(lane: LoopLaneRecord, titles: LoopRunDetail["batchTitles"]): ReportItem[] {
  const closed = new Set(lane.closedIds);
  return (lane.report?.items ?? []).map((it) => ({
    id: it.recommendationId,
    title: titles?.[it.recommendationId]?.title ?? null,
    dimId: titles?.[it.recommendationId]?.dimId ?? null,
    closed: closed.has(it.recommendationId),
    verdict: it.verdict,
    reason: it.reason,
    files: it.files,
  }));
}

/** "closed · rescan" / "resolved · claimed" / the agent's own verdict word. */
export function reportWord(it: ReportItem): { word: string; key: "verified" | "baseline" | "unknown" } {
  if (it.closed) return { word: "closed · rescan", key: "verified" };
  if (it.verdict === "resolved") return { word: "resolved · claimed", key: "baseline" };
  return { word: it.verdict.replace("_", " "), key: "unknown" };
}

export const outcomeOf = (detail: LoopRunDetail, laneId: string): LoopLaneOutcome | null =>
  detail.outcomes.find((o) => o.lane.id === laneId) ?? null;

/** The lanes of a run in reading order: when they started, then cycle, then repo. */
export function orderedLanes(detail: LoopRunDetail): LoopLaneRecord[] {
  const t = (s: string | null) => (s ? Date.parse(s) || 0 : 0);
  return [...detail.lanes].sort((a, b) => t(a.startedAt) - t(b.startedAt) || a.cycle - b.cycle || a.repoFullName.localeCompare(b.repoFullName));
}

/** A run's delivered headlines, the retired ones left out (the rescan stopped raising them, nobody
 *  claimed them — they are not deliveries). */
export function deliveredOf(lanes: readonly LoopLaneRecord[]) {
  return lanes.flatMap((lane) => lane.deliverables.filter((d) => !d.retired).map((d) => ({ lane, d })));
}
