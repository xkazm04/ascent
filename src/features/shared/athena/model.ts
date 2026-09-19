// What the renderer is allowed to believe about a persisted turn.
//
// `AthenaTurnRecord.meta` is `Record<string, unknown>` decoded out of a TEXT column, so every read of
// it here is defensive. That is not paranoia about the writer (`turn.ts` writes well-formed blocks);
// it is that a row written by an older build, a hand-edited database, or a future field is one bad
// `.map()` away from white-screening the drawer that was supposed to be helping.
//
// THE CAPS ARE IMPORTED, NEVER RE-DECLARED. `blocks.ts` exports them precisely so a renderer laying
// out five columns against a validator that permits four is impossible. Re-applying them on the way
// OUT costs one `slice` and closes the only remaining gap: a block that entered the database before a
// cap existed.
//
// Pure and React-free — every rule below is unit-testable with no DOM.

import {
  ATHENA_CHART_MAX_POINTS,
  ATHENA_CHART_MAX_SERIES,
  ATHENA_MAX_BLOCKS,
  ATHENA_TABLE_MAX_COLUMNS,
  ATHENA_TABLE_MAX_ROWS,
  type AthenaBlock,
} from "@/lib/athena/blocks";
import type { AthenaTurnRecord, AthenaThreadRecord } from "@/lib/db/athena-threads";
import type { AthenaProposalRecord } from "@/lib/db/athena-proposals";

/** At most two chips, and each one a derived sentence — never a raw memory excerpt. */
export const ATHENA_VIEW_MAX_CHIPS = 2;

/** `GET /api/athena/threads?org=` — one boot request (see the route's header). */
export interface AthenaBoot {
  threads: AthenaThreadRecord[];
  thread: AthenaThreadRecord | null;
  turns: AthenaTurnRecord[];
  proposals: AthenaProposalRecord[];
  degraded: boolean;
  engine?: { degraded: boolean; reason?: string | null; provider?: string | null; model?: string | null };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const strings = (v: unknown): string[] | null =>
  Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : null;

function readTable(raw: Record<string, unknown>): AthenaBlock | null {
  const columns = strings(raw.columns);
  if (!columns || columns.length === 0) return null;
  if (!Array.isArray(raw.rows)) return null;
  const rows: string[][] = [];
  for (const r of raw.rows) {
    const cells = strings(r);
    // Width is checked against the ORIGINAL header, exactly as the validator does, so trimming to the
    // cap can never "repair" a ragged row into a confident misalignment.
    if (!cells || cells.length !== columns.length) return null;
    rows.push(cells.slice(0, ATHENA_TABLE_MAX_COLUMNS));
  }
  if (rows.length === 0) return null;
  return {
    type: "table",
    title: typeof raw.title === "string" ? raw.title : undefined,
    columns: columns.slice(0, ATHENA_TABLE_MAX_COLUMNS),
    rows: rows.slice(0, ATHENA_TABLE_MAX_ROWS),
  };
}

function readChart(raw: Record<string, unknown>): AthenaBlock | null {
  const labels = strings(raw.labels);
  if (!labels || labels.length === 0) return null;
  if (!Array.isArray(raw.series)) return null;
  const series: { name: string; values: number[] }[] = [];
  for (const s of raw.series) {
    if (!isRecord(s) || typeof s.name !== "string" || !Array.isArray(s.values)) return null;
    if (s.values.length !== labels.length) return null; // a short series draws a line that stops early
    if (!s.values.every((v) => typeof v === "number" && Number.isFinite(v))) return null;
    series.push({ name: s.name, values: (s.values as number[]).slice(0, ATHENA_CHART_MAX_POINTS) });
  }
  if (series.length === 0) return null;
  return {
    type: "chart",
    title: typeof raw.title === "string" ? raw.title : undefined,
    chart: raw.chart === "line" ? "line" : "bar",
    labels: labels.slice(0, ATHENA_CHART_MAX_POINTS),
    series: series.slice(0, ATHENA_CHART_MAX_SERIES),
  };
}

/** The blocks this turn may draw. Anything unrecognisable is dropped whole — never half-drawn. */
export function turnBlocks(turn: { meta?: Record<string, unknown> } | null | undefined): AthenaBlock[] {
  const raw = turn?.meta?.blocks;
  if (!Array.isArray(raw)) return [];
  const out: AthenaBlock[] = [];
  for (const b of raw) {
    if (out.length >= ATHENA_MAX_BLOCKS) break;
    if (!isRecord(b)) continue;
    const block = b.type === "table" ? readTable(b) : b.type === "chart" ? readChart(b) : null;
    if (block) out.push(block);
  }
  return out;
}

/** What she stood on, at most two. Empty when nothing survived — an empty strip beats an echo. */
export function turnChips(turn: { meta?: Record<string, unknown> } | null | undefined): string[] {
  const raw = turn?.meta?.chips;
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const c of raw) {
    if (out.length >= ATHENA_VIEW_MAX_CHIPS) break;
    const insight = isRecord(c) && typeof c.insight === "string" ? c.insight.trim() : "";
    if (insight) out.push(insight);
  }
  return out;
}

/** True when this answer was persisted nowhere — `turn.id === ""` means nothing can address it later. */
export const turnIsEphemeral = (turn: { id: string }): boolean => turn.id === "";
