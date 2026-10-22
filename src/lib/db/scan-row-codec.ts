// ONE declaration of how a ScanReport field becomes a Scan column and comes back.
//
// The Scan row used to be written by one hand-list (the scan.create in persistScanReport) and read
// back by another (the return of loadScanReportByCommit). The two drifted: contextHealthJson,
// manifestJson, guidanceGraphJson, practiceShape and platformSignalsJson were written on every scan
// and never decoded, so every report rebuilt from the DB (a DB-tier cache hit, a permalink, a
// foundation PR, a lane install) silently lacked them. This is the parallel-copy defect of row
// mapping: the insert learns a field, one read path does not, and the field round-trips as absent.
//
// SCAN_REPORT_COLUMNS holds one entry per OPTIONAL report field stored in its own column, each with an
// encode half (report -> column) and a decode half (column -> field, or `undefined` = ABSENT). The
// table is typed so an entry without a decode half fails tsc. Every OTHER Scan column is named in
// SCAN_COLUMN_EXCEPTIONS with the reason it is not a codec column, and the type check at the bottom
// fails tsc when a schema column is in neither. scans-persist.test.ts pins the runtime half: a key
// persistScanReport writes with no decode decision fails the suite.
//
// Encoded strings are byte-identical to what the hand-list wrote, so no stored row changes.

import type { Scan } from "@prisma/client";
import type {
  DimensionId,
  Discrepancy,
  Governance,
  PrStats,
  ScanReport,
  ScoreIntegrity,
  TechStack,
} from "@/lib/types";
import { parseStringArray } from "@/lib/db/json-columns";
import { parseSensorFailures } from "@/lib/db/scan-sensor-failures";
import { parsePassportJson } from "@/lib/analyze/passport";
import { parsePlatformSignals } from "@/lib/analyze/platform-carry";
import { parseContextHealthJson } from "@/lib/analyze/context-health-read";
import { parseGuidanceGraphJson } from "@/lib/analyze/guidance-graph";
import { parsePracticeShape } from "@/lib/analyze/practice-shape";
import { parseManifestReadoutJson } from "@/lib/standard/readout";

// ── The JSON-column primitives (moved from scans-read.ts unchanged) ─────────────────────────────

function parseJson<T>(s: string | null | undefined): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch (err) {
    // Every column read here was written by JSON.stringify, so a parse failure is damage: the field
    // reads as absent (the shape guards below), and the log is what tells it apart from "never set".
    console.warn("[scans-read] persisted JSON column unreadable; reading it as absent:", err);
    return null;
  }
}

/**
 * Parse persisted JSON that MUST be a plain object. A valid-JSON-but-wrong-shape row (stored as an
 * array, number, or string) returns null instead of being blindly cast to T, so a corrupted
 * `prStats`/`governance` column can't reach client charts as something that isn't the expected
 * object (where field access / numeric coercion would render NaN or throw).
 */
export function parseJsonObject<T>(s: string | null | undefined): T | null {
  const p = parseJson<unknown>(s);
  return p !== null && typeof p === "object" && !Array.isArray(p) ? (p as T) : null;
}

/**
 * Parse persisted JSON that MUST be an array of finite numbers. Non-array input returns null;
 * non-finite/non-number entries (NaN, strings, an object slipped into the array) are dropped. This
 * guards the commit-activity sparkline from a `.map` on a non-array or a NaN-positioned SVG point
 * when a row was hand-edited or written by an older/buggy path.
 */
export function parseNumberArray(s: string | null | undefined): number[] | null {
  const p = parseJson<unknown>(s);
  if (!Array.isArray(p)) return null;
  return p.filter((n): n is number => typeof n === "number" && Number.isFinite(n));
}

/** Parse the persisted `discrepancies` JSON into validated Discrepancy[]. JSON `[]` is a measured
 *  empty list; null / malformed / non-array return null so unread is not "found none". */
export function parseDiscrepancies(s: string | null | undefined): Discrepancy[] | null {
  const p = parseJson<unknown>(s);
  if (!Array.isArray(p)) return null;
  return p
    .filter((d): d is { dimension: string; claim: string } => !!d && typeof d.dimension === "string" && typeof d.claim === "string")
    .map((d) => ({ dimension: d.dimension as DimensionId, claim: d.claim }));
}

/** Wrap a parser that never logs: a non-empty column it cannot read is damage, so say so once. The
 *  parsers that already log their own JSON failures (context health, guidance graph, platform signals) are not
 *  wrapped, so a corrupt blob warns exactly once either way. */
function logged<T>(column: string, parse: (raw: string | null) => T | null | undefined) {
  return (raw: string | null): T | undefined => {
    const v = parse(raw);
    if (v != null) return v;
    if (raw) console.warn(`[scan-row-codec] persisted ${column} unreadable; reading it as absent`);
    return undefined;
  };
}

const json = (v: unknown): string | null => (v ? JSON.stringify(v) : null);

// ── The table ───────────────────────────────────────────────────────────────────────────────────

/** One column's two halves. A union over report fields, so `decode` is typed by the entry's `field`. */
type ColumnCodec<C extends keyof Scan> = {
  [F in keyof ScanReport]-?: {
    field: F;
    encode: (report: ScanReport) => Scan[C];
    decode: (raw: Scan[C]) => ScanReport[F] | undefined;
  };
}[keyof ScanReport];

export const SCAN_REPORT_COLUMNS = {
  // Pull-request process signals; null when the scan had no token. Read back as null (not absent),
  // which the report renders as "not measured".
  prStats: { field: "prStats", encode: (r) => json(r.prStats), decode: (raw) => parseJsonObject<PrStats>(raw) },
  governance: { field: "governance", encode: (r) => json(r.governance), decode: (raw) => parseJsonObject<Governance>(raw) },
  commitActivity: { field: "commitActivity", encode: (r) => json(r.commitActivity), decode: (raw) => parseNumberArray(raw) },
  techStackJson: {
    field: "techStack",
    encode: (r) => json(r.techStack),
    decode: (raw) => parseJsonObject<TechStack>(raw) ?? undefined,
  },
  // The RAW passport. Owner overrides live on Repository, so the reconstruction applies them on top.
  passportJson: { field: "passport", encode: (r) => json(r.passport), decode: (raw) => parsePassportJson(raw) ?? undefined },
  // The ScoreIntegrity record: the levers that move a headline on an UNCHANGED commit. Null = the
  // row predates the column ("not recorded", never "nothing fired").
  scoreIntegrityJson: {
    field: "scoreIntegrity",
    encode: (r) => json(r.scoreIntegrity),
    decode: (raw) => parseJsonObject<ScoreIntegrity>(raw) ?? undefined,
  },
  // What this scan could see of the GITHUB-side folds (observed / carried / unavailable). Null = the
  // question was never asked, which is UNKNOWN and not "unavailable".
  platformSignalsJson: {
    field: "platformSignals",
    encode: (r) => json(r.platformSignals),
    decode: (raw) => parsePlatformSignals(raw),
  },
  // The GitHub sensors whose read THREW. `[]` is written as "[]" (nothing threw); a report that never
  // carried the list stays NULL, which is UNKNOWN, and decodes ABSENT.
  sensorFailuresJson: {
    field: "sensorFailures",
    encode: (r) => (r.sensorFailures ? JSON.stringify(r.sensorFailures) : null),
    decode: (raw) => parseSensorFailures(raw),
  },
  // Context Health (W4). Display-only (never scored). NULL reads as "not assessed", never as absent
  // context, so it decodes ABSENT.
  contextHealthJson: {
    field: "contextHealth",
    encode: (r) => json(r.contextHealth),
    decode: (raw) => parseContextHealthJson(raw) ?? undefined,
  },
  // #13: what this scan read in the repo's own .ai/manifest.yaml. NULL is "not assessed by this
  // scan", never a repo that declares no contract.
  manifestJson: { field: "manifest", encode: (r) => json(r.manifest), decode: logged("manifestJson", parseManifestReadoutJson) },
  // #15: the guidance arbiter's verdict. NULL (and every pre-r11 row) is "not assessed", never coherence 0.
  guidanceGraphJson: {
    field: "guidanceGraph",
    encode: (r) => json(r.guidanceGraph),
    decode: (raw) => parseGuidanceGraphJson(raw) ?? undefined,
  },
  // W6: practice shape. NULL is "not extracted", never "this repo has no structure".
  practiceShape: { field: "practiceShape", encode: (r) => json(r.practiceShape), decode: logged("practiceShape", parsePracticeShape) },
  // Reliability caveats (degrade-to-mock / low-coverage / no-token / stack-fit), so a reloaded scan
  // keeps its disclosure. The reconstruction merges the stack-fit backstop for legacy rows.
  warningsJson: {
    field: "warnings",
    encode: (r) => (r.warnings?.length ? JSON.stringify(r.warnings) : null),
    decode: (raw) => parseStringArray(raw) ?? undefined,
  },
} satisfies { [C in keyof Scan]?: ColumnCodec<C> };

export type CodecColumn = keyof typeof SCAN_REPORT_COLUMNS;

/**
 * Every Scan column that is NOT a codec column, with the reason. A required report field is read by
 * the reconstruction directly (it can never be ABSENT, so the codec's absent-means-unknown rule does
 * not fit it); a composite field is built from several columns; a write-only column has no report
 * field to land on.
 */
export const SCAN_COLUMN_EXCEPTIONS = {
  id: "db-managed: the row's own key",
  createdAt: "db-managed: insertion time, used only as an ordering tie-break",
  repoId: "write-only: the owning repository, resolved by the read before the scan is found",
  headSha: "write-only: the lookup key; the reconstruction copies it onto repo.headSha",
  dedupKey: "write-only: the sha-less idempotency key, never a report field",
  levelName: "write-only: the level's display name, re-derived from LEVEL_BY_ID on read",
  inputTokens: "write-only basis: the CACHE-AWARE billable count, not report.usage.inputTokens as the scan saw it",
  overallScore: "required scalar, read directly",
  level: "composite: LEVEL_BY_ID with a levelForScore fallback",
  archetype: "required scalar, read directly",
  adoptionScore: "required scalar, read directly",
  rigorScore: "required scalar, read directly",
  posture: "composite: the frozen posture id with a postureFor fallback",
  confidence: "required scalar, read directly",
  engineProvider: "composite: report.engine",
  engineModel: "composite: report.engine",
  engineByom: "composite: report.engine",
  engineDegraded: "composite: report.engine",
  rubricVersion: "composite: report.engine (written from the stamped rubric, not only the report's)",
  outputTokens: "composite: report.usage",
  llmLatencyMs: "composite: report.usage",
  headline: "required scalar, read directly",
  strengths: "required list, read directly with a [] fallback",
  risks: "required list, read directly with a [] fallback",
  discrepancies: "required list, read directly with a [] fallback",
  aiUsageJson: "composite: report.aiUsage, with a reconstruction from prStats + contributors for legacy rows",
  scannedAt: "required timestamp, read directly as an ISO string",
} satisfies { [C in keyof Scan]?: string };

// Compile-time completeness: a Scan column in neither list, or in both, fails tsc here.
type Undecided = Exclude<keyof Scan, CodecColumn | keyof typeof SCAN_COLUMN_EXCEPTIONS>;
type Doubled = Extract<CodecColumn, keyof typeof SCAN_COLUMN_EXCEPTIONS>;
const _everyColumnDecided: [Undecided, Doubled] extends [never, never] ? true : never = true;
void _everyColumnDecided;

/** The columns persistScanReport may write with no codec entry (everything in the exceptions list). */
export function undecidedColumns(writtenKeys: readonly string[]): string[] {
  return writtenKeys.filter((k) => !(k in SCAN_REPORT_COLUMNS) && !(k in SCAN_COLUMN_EXCEPTIONS));
}

/** The codec columns for a scan.create payload. Byte-identical to the former hand-list. */
export function encodeScanColumns(report: ScanReport): { [C in CodecColumn]: Scan[C] } {
  const out: Record<string, unknown> = {};
  for (const [column, codec] of Object.entries(SCAN_REPORT_COLUMNS)) out[column] = codec.encode(report);
  return out as { [C in CodecColumn]: Scan[C] };
}

export type DecodedScanColumns = Partial<Pick<ScanReport, (typeof SCAN_REPORT_COLUMNS)[CodecColumn]["field"]>>;

/** The report fields the codec columns carry. An `undefined` decode leaves the key ABSENT, so "not
 *  assessed by this scan" stays distinguishable from a measured empty. Never throws. */
export function decodeScanColumns(row: Pick<Scan, CodecColumn>): DecodedScanColumns {
  const out: Record<string, unknown> = {};
  for (const [column, codec] of Object.entries(SCAN_REPORT_COLUMNS)) {
    const v = (codec.decode as (raw: unknown) => unknown)(row[column as CodecColumn]);
    if (v !== undefined) out[codec.field] = v;
  }
  return out as DecodedScanColumns;
}
