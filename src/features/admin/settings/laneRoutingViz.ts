// The words of the lane-routing card: per-lane labels, the cell a lane row prints, the "N of 5"
// summary, and the diff between where a lane runs now and where it would run if the saved provider
// were switched on. The routing itself is decided in src/lib/llm/lane-routes.ts; this only says it.
//
// Pure: no React, no hooks, no I/O.

import { LANE_IDS, LANE_ROUTING, type LaneAccount, type LaneId, type LaneRow } from "@/lib/llm/lane-routes";

export const LANE_LABEL: Record<LaneId, string> = {
  scans: "Scans",
  athena: "Athena",
  briefing: "Board narrative",
  memory: "Shared memory",
  laneSummary: "Lane summaries",
};

/** What each lane sends to the model: the content an owner is deciding the destination of. */
export const LANE_HINT: Record<LaneId, string> = {
  scans: "File samples from every scanned repository",
  athena: "Athena's turns and background cycle, grounded in this organization's standing",
  briefing: "The executive briefing's opening paragraph, from fleet scores",
  memory: "Shared memory entries, for the write check and reflection",
  laneSummary: "The loop's delivered-work headlines, for a wording polish",
};

/** What each lane falls back to when no engine is reachable. */
const NO_ENGINE: Record<LaneId, string> = {
  scans: "No engine",
  athena: "No engine: Athena cannot answer",
  briefing: "No engine: template paragraph",
  memory: "No engine: deterministic heuristic",
  laneSummary: "No engine: derived list kept",
};

const ACCOUNT_LABEL: Record<LaneAccount, string> = {
  yours: "Your account",
  platform: "Ascent platform",
  none: "Nothing sent",
};

export type LaneTone = "yours" | "platform" | "quiet" | "warn";

export interface LaneCell {
  text: string;
  model: string | null;
  account: string;
  tone: LaneTone;
}

/** One row's cell: the engine (or why there is none), the model, and whose account answers. */
export function laneCell(row: LaneRow): LaneCell {
  const account = ACCOUNT_LABEL[row.account];
  switch (row.state) {
    case "runs":
      if (row.engine === "mock") return { text: "mock (deterministic)", model: null, account, tone: "quiet" };
      return { text: row.engine ?? "", model: row.model, account, tone: row.account === "yours" ? "yours" : "platform" };
    case "blocked":
      return { text: "Blocked: fails closed, no platform fallback", model: null, account, tone: "warn" };
    case "template":
      return { text: "Template paragraph: your provider cannot be resolved", model: null, account, tone: "warn" };
    case "off":
      return { text: "Off: BRIEFING_NARRATIVE unset, template paragraph", model: null, account, tone: "quiet" };
    case "no-engine":
      return { text: NO_ENGINE[row.lane], model: null, account, tone: "quiet" };
  }
}

/** "3 of 5 lanes run on your provider", or the platform / blocked / no-vendor equivalent. */
export function laneSummaryLine(rows: readonly LaneRow[]): string {
  const total = rows.length;
  const count = (p: (r: LaneRow) => boolean) => rows.filter(p).length;
  const blocked = count((r) => r.state === "blocked");
  if (blocked) return `${blocked} of ${total} lanes blocked: your provider's credentials cannot be resolved`;
  const yours = count((r) => r.account === "yours");
  if (yours || rows.some((r) => r.bypassesByom)) return `${yours} of ${total} lanes run on your provider`;
  const platform = count((r) => r.account === "platform");
  return platform ? `${platform} of ${total} lanes run on the platform provider` : "No lane calls a model vendor";
}

/** The lanes that never use a connected provider, read from the routing table (never a hand list). */
export function platformOnlyLanes(): string[] {
  return LANE_IDS.filter((l) => !LANE_ROUTING[l].honorsByom).map((l) => LANE_LABEL[l]);
}

export interface LaneViewRow {
  lane: LaneId;
  label: string;
  hint: string;
  now: LaneCell;
  /** The "If switched on" cell, or null when there is no saved provider to preview. */
  next: LaneCell | null;
  /** The preview puts this lane on a different engine, model, account or state. */
  moves: boolean;
  /** An enabled (or previewed) BYOM does not apply to this lane. */
  bypassesByom: boolean;
}

export interface LaneRoutingView {
  rows: LaneViewRow[];
  summary: string;
  previewSummary: string | null;
}

const differs = (a: LaneRow, b: LaneRow) =>
  a.engine !== b.engine || a.model !== b.model || a.account !== b.account || a.state !== b.state;

export function laneRoutingView({ current, preview }: { current: LaneRow[]; preview: LaneRow[] | null }): LaneRoutingView {
  const rows = current.map((now): LaneViewRow => {
    const next = preview?.find((r) => r.lane === now.lane) ?? null;
    return {
      lane: now.lane,
      label: LANE_LABEL[now.lane],
      hint: LANE_HINT[now.lane],
      now: laneCell(now),
      next: next ? laneCell(next) : null,
      moves: next ? differs(now, next) : false,
      bypassesByom: (next ?? now).bypassesByom,
    };
  });
  return { rows, summary: laneSummaryLine(current), previewSummary: preview ? laneSummaryLine(preview) : null };
}
