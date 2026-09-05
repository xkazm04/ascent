// ATHENA'S BLOCKS — the two structured shapes she is allowed to draw, parsed out of a completion.
//
// WHY BLOCKS AT ALL. A companion answering "how does the fleet score" in prose has to enumerate:
// "acme/api is 62, acme/web is 71, acme/infra is 44, …". Three or more comparable items read as a
// wall. The prompt contract (prompt.ts) tells her to emit a fenced ```athena:table``` or
// ```athena:chart``` instead, and this module is the validator that decides whether what came back is
// safe to render.
//
// THE TWO FAILURE MODES ARE NOT THE SAME FAILURE, and the asymmetry here is the whole design:
//
//   • STRUCTURALLY WRONG → DROPPED WHOLE, AND COUNTED. A chart whose series has five values against
//     eight labels is not "a chart with a gap"; rendered, it is a picture that asserts something the
//     data never said. A half-drawn chart is a lie with a picture attached, so it does not get drawn
//     at all — and the drop is COUNTED, because a block that silently vanishes is indistinguishable
//     from a model that never emitted one, and only one of those is worth fixing.
//
//   • MERELY TOO LONG → TRUNCATED, AND KEPT. Eight rows of a ten-row answer is still the answer. The
//     caps below exist so the renderer has a bounded shape to lay out, not because row nine is
//     dangerous. Cutting is honest as long as the cut is reported.
//
// NOTHING IN THIS MODULE THROWS. It sits between the model and the user: an exception here does not
// cost the block, it costs the PROSE TOO — the whole reply is lost because a chart's `values` was a
// string. Every entry point is wrapped, every field access is defensive, and the fallback is always
// "return the completion as prose with no blocks".
//
// THE CAPS ARE EXPORTED because WP4's renderer imports them. A renderer that lays out five columns
// and a validator that permits four is a bug nobody sees until a model finally emits five.

/** Most columns a table may have. Past this, the extra columns are cut (and each row cut with them). */
export const ATHENA_TABLE_MAX_COLUMNS = 4;
/** Most body rows a table may have. Past this, the extra rows are cut. */
export const ATHENA_TABLE_MAX_ROWS = 8;
/** Most x-values (categories) a chart may plot. Past this, the tail is cut from labels AND every series. */
export const ATHENA_CHART_MAX_POINTS = 8;
/** Most series a chart may carry. Past this, the extra series are cut. */
export const ATHENA_CHART_MAX_SERIES = 2;
/** Most blocks one reply may carry. Past this, the extra blocks are removed and counted as overflow. */
export const ATHENA_MAX_BLOCKS = 2;
/** Longest a single cell / label / series name is rendered at. Cut, never dropped. */
export const ATHENA_CELL_MAX_CHARS = 160;
/** Longest a block title is rendered at. Cut, never dropped. */
export const ATHENA_TITLE_MAX_CHARS = 120;
/** Default prose ceiling. Applied AFTER the fences are removed — see `parseAthenaBlocks`. */
export const ATHENA_PROSE_MAX_CHARS = 4_000;

/**
 * The lead-in used when a completion was ONLY blocks. A blank bubble above a table reads as a
 * rendering bug, and the operator's first instinct is to distrust the table under it. Deterministic
 * on purpose: a second model call to write six words is spend with no answer in it.
 */
export const ATHENA_BLOCK_ONLY_LEAD_IN = "Here it is.";

export interface AthenaTableBlock {
  type: "table";
  title?: string;
  columns: string[];
  rows: string[][];
}

export interface AthenaChartBlock {
  type: "chart";
  title?: string;
  /** Presentation only. Absent is allowed and means "bar" — it says nothing about the data. */
  chart: "bar" | "line";
  labels: string[];
  series: { name: string; values: number[] }[];
}

export type AthenaBlock = AthenaTableBlock | AthenaChartBlock;

export interface ParsedCompletion {
  /** The completion with every recognised fence removed, whitespace tidied, and then cut to budget. */
  prose: string;
  blocks: AthenaBlock[];
  /** Blocks removed WHOLE because their structure did not validate. */
  dropped: number;
  /** Blocks KEPT but cut to a cap (columns, rows, points or series). */
  truncated: number;
  /** Valid blocks removed because the reply already carried {@link ATHENA_MAX_BLOCKS}. */
  overflow: number;
}

/** Recognised, CLOSED fence. Anchored per-line so a fence must open and close at the start of a line. */
const FENCE_RE = /^[ \t]*```athena:(table|chart)[ \t]*\r?\n([\s\S]*?)^[ \t]*```[ \t]*$/gm;
/** An OPENED fence with no close — what a completion cut off mid-block looks like. */
const OPEN_FENCE_RE = /^[ \t]*```athena:(?:table|chart)[ \t]*$/m;

const EMPTY: ParsedCompletion = { prose: "", blocks: [], dropped: 0, truncated: 0, overflow: 0 };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** A cell is whatever the model put there, rendered as text. Numbers and booleans are legitimate cell
 *  values; an object or an array is not, and returning null here drops the block that contained it. */
function cellText(v: unknown): string | null {
  if (typeof v === "string") return v.slice(0, ATHENA_CELL_MAX_CHARS);
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "boolean") return String(v);
  if (v === null || v === undefined) return "";
  return null;
}

function titleOf(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t ? t.slice(0, ATHENA_TITLE_MAX_CHARS) : undefined;
}

type Validated = { block: AthenaBlock; truncated: boolean } | null;

/**
 * A table validates when it has at least one column, at least one row, and EVERY row has exactly as
 * many cells as there are declared columns. Raggedness is checked against the ORIGINAL column count,
 * before the cap is applied — otherwise cutting to four columns would silently "repair" a five-column
 * header sitting over three-cell rows, and the table would render a confident misalignment.
 */
function validateTable(raw: Record<string, unknown>): Validated {
  const cols = raw.columns;
  const rows = raw.rows;
  if (!Array.isArray(cols) || cols.length === 0) return null;
  if (!Array.isArray(rows) || rows.length === 0) return null;

  const columns: string[] = [];
  for (const c of cols) {
    const t = cellText(c);
    if (t === null) return null;
    columns.push(t);
  }
  const width = columns.length;

  const body: string[][] = [];
  for (const r of rows) {
    if (!Array.isArray(r) || r.length !== width) return null; // ragged → the whole table is wrong
    const cells: string[] = [];
    for (const cell of r) {
      const t = cellText(cell);
      if (t === null) return null;
      cells.push(t);
    }
    body.push(cells);
  }

  const cut = width > ATHENA_TABLE_MAX_COLUMNS || body.length > ATHENA_TABLE_MAX_ROWS;
  return {
    block: {
      type: "table",
      title: titleOf(raw.title),
      columns: columns.slice(0, ATHENA_TABLE_MAX_COLUMNS),
      rows: body.slice(0, ATHENA_TABLE_MAX_ROWS).map((r) => r.slice(0, ATHENA_TABLE_MAX_COLUMNS)),
    },
    truncated: cut,
  };
}

/**
 * A chart validates when it has at least one label, at least one series, every series value is a
 * finite number, and every series has EXACTLY one value per label. That last rule is the one that
 * matters: a short series rendered against a full axis draws a line that stops early, and a reader
 * takes an early stop as a fact about the fleet rather than a fact about the completion.
 *
 * Length is checked BEFORE the point cap, for the same reason raggedness is checked before the column
 * cap: cutting first would turn a mismatched series into a matching one and render the lie anyway.
 */
function validateChart(raw: Record<string, unknown>): Validated {
  const labelsRaw = raw.labels;
  const seriesRaw = raw.series;
  if (!Array.isArray(labelsRaw) || labelsRaw.length === 0) return null;
  if (!Array.isArray(seriesRaw) || seriesRaw.length === 0) return null;

  const kind = raw.chart;
  if (kind !== undefined && kind !== "bar" && kind !== "line") return null;

  const labels: string[] = [];
  for (const l of labelsRaw) {
    const t = cellText(l);
    if (t === null) return null;
    labels.push(t);
  }

  const series: { name: string; values: number[] }[] = [];
  for (const s of seriesRaw) {
    if (!isRecord(s)) return null;
    const name = cellText(s.name);
    if (name === null || !name.trim()) return null;
    const vals = s.values;
    if (!Array.isArray(vals) || vals.length !== labels.length) return null; // the load-bearing check
    const values: number[] = [];
    for (const v of vals) {
      if (typeof v !== "number" || !Number.isFinite(v)) return null;
      values.push(v);
    }
    series.push({ name: name.trim(), values });
  }

  const cut = labels.length > ATHENA_CHART_MAX_POINTS || series.length > ATHENA_CHART_MAX_SERIES;
  return {
    block: {
      type: "chart",
      title: titleOf(raw.title),
      chart: kind === "line" ? "line" : "bar",
      labels: labels.slice(0, ATHENA_CHART_MAX_POINTS),
      series: series.slice(0, ATHENA_CHART_MAX_SERIES).map((s) => ({
        name: s.name,
        values: s.values.slice(0, ATHENA_CHART_MAX_POINTS),
      })),
    },
    truncated: cut,
  };
}

/** Parse one fence body. Anything that is not a JSON object of the right shape returns null → dropped. */
function validateBody(kind: "table" | "chart", body: string): Validated {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  if (!isRecord(parsed)) return null;
  return kind === "table" ? validateTable(parsed) : validateChart(parsed);
}

/** Collapse the holes left where fences were, without touching intentional paragraph breaks. */
function tidy(s: string): string {
  return s.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").replace(/\n{3,}/g, "\n\n").trim();
}

/** Cut on a word boundary. Applied to the FENCE-FREE prose only — see `parseAthenaBlocks`. */
function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/**
 * Pull the blocks out of a completion and return the prose that is left.
 *
 * ORDER IS LOAD-BEARING: the fences come out FIRST and the prose budget is applied SECOND. Cutting
 * first slices a fence in half — the opening ```` ```athena:table ```` survives, its closing fence does
 * not, and the result is a valid table turned into one dropped block PLUS a paragraph of raw JSON
 * shown to the operator. Cutting last means the budget governs prose, which is what it was for.
 *
 * Never throws. A completion this function cannot make sense of comes back as prose with no blocks.
 */
export function parseAthenaBlocks(
  completion: string,
  opts?: { proseMaxChars?: number },
): ParsedCompletion {
  try {
    if (typeof completion !== "string" || completion.length === 0) return { ...EMPTY };
    const budget = Math.max(1, opts?.proseMaxChars ?? ATHENA_PROSE_MAX_CHARS);

    const blocks: AthenaBlock[] = [];
    let dropped = 0;
    let truncated = 0;
    let overflow = 0;

    // Pass 1: every CLOSED fence is consumed, valid or not — an invalid block must not survive as raw
    // JSON in the prose. Rebuilt rather than `.replace()`d so the parse result and the removal can
    // never disagree about which spans were fences.
    FENCE_RE.lastIndex = 0;
    let cursor = 0;
    let rest = "";
    for (let m = FENCE_RE.exec(completion); m; m = FENCE_RE.exec(completion)) {
      rest += completion.slice(cursor, m.index);
      cursor = m.index + m[0].length;
      const v = validateBody(m[1] as "table" | "chart", m[2] ?? "");
      if (!v) {
        dropped += 1;
        continue;
      }
      if (blocks.length >= ATHENA_MAX_BLOCKS) {
        overflow += 1;
        continue;
      }
      blocks.push(v.block);
      if (v.truncated) truncated += 1;
    }
    rest += completion.slice(cursor);

    // Pass 2: an OPEN fence with no close is what a completion truncated mid-block looks like (the
    // tool loop's budget expiry does exactly this). Everything from it to the end is block debris, not
    // prose, so it is cut and counted as a drop — the operator learns a block was lost rather than
    // reading its half-written JSON.
    const open = OPEN_FENCE_RE.exec(rest);
    if (open) {
      rest = rest.slice(0, open.index);
      dropped += 1;
    }

    const prose = clip(tidy(rest), budget);
    return {
      prose: prose || (blocks.length > 0 ? ATHENA_BLOCK_ONLY_LEAD_IN : ""),
      blocks,
      dropped,
      truncated,
      overflow,
    };
  } catch {
    // Belt and braces. Losing the blocks is a degraded answer; losing the prose is no answer at all.
    return { prose: typeof completion === "string" ? completion : "", blocks: [], dropped: 0, truncated: 0, overflow: 0 };
  }
}
