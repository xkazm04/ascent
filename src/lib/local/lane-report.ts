// `.ascent/lane-report.json` — what the AGENT says it did, per item, in a shape a machine can act on.
//
// The lane already had the agent's prose summary and threw everything but its first line away, so
// "which of the five items did you actually skip, and why" was a question nothing could answer. The
// rescan remains the VERDICT — a row closes only when the next scan stops raising the gap and the
// dimension moved — but the agent's own account of a SKIP is information the rescan cannot produce:
// a rescan can see that nothing changed; only the session can say it was blocked on a decision.
//
// VERSIONED `"v": 1` DELIBERATELY. This is the same report shape a remote agent will POST over MCP
// when W4-N builds the agent-neutral work protocol (#3). Versioning it here means that lane extends
// the contract rather than forking a second one.
//
// NEVER THROWS. Every failure mode — no file, unreadable file, `"{"`, a 1 MB blob, an array where an
// object belongs, an id the lane never dispatched — returns `parsed: false` or drops the offending
// entry. A remediation lane must not die because a session wrote bad JSON on its way out.

import { readFile } from "node:fs/promises";
import { join } from "node:path";

export const LANE_REPORT_PATH = ".ascent/lane-report.json";

/** What the agent claims it did with one dispatched item. `attempted` is the honest coercion for a
 *  verdict we do not recognise: the session said something about the id, just not something we can
 *  act on. `absent` is never written by the agent — the lane assigns it to an id nobody mentioned. */
export type LaneVerdict = "resolved" | "skipped" | "needs_human" | "attempted" | "absent";

export const LANE_VERDICTS: readonly LaneVerdict[] = ["resolved", "skipped", "needs_human", "attempted", "absent"];

export interface LaneReportItem {
  recommendationId: string;
  verdict: LaneVerdict;
  /** The agent's own words. `""` means it gave none — never a guess on its behalf. */
  reason: string;
  files: string[];
}

export interface LaneReport {
  v: 1;
  /** False when there was no report, or nothing parseable in it. NOT the same as "zero items". */
  parsed: boolean;
  /** A bounded excerpt of what was actually there when parsing failed — so a malformed report is
   *  debuggable from the row rather than only from a machine nobody still has. */
  raw?: string;
  items: LaneReportItem[];
  lessons: string[];
}

const REASON_MAX = 400;
const FILES_MAX = 20;
const FILE_PATH_MAX = 300;
const LESSONS_MAX = 5;
const LESSON_MAX = 600;
const RAW_EXCERPT_MAX = 8_000;

const EMPTY: LaneReport = { v: 1, parsed: false, items: [], lessons: [] };

const asVerdict = (v: unknown): LaneVerdict =>
  typeof v === "string" && (LANE_VERDICTS as readonly string[]).includes(v) && v !== "absent"
    ? (v as LaneVerdict)
    : "attempted";

const asString = (v: unknown, max: number): string => (typeof v === "string" ? v.trim().slice(0, max) : "");

/**
 * Parse one report against the ids the lane actually dispatched.
 *
 * `batchIds` is not a convenience filter — it is the authorization boundary of the document. An agent
 * cannot adjudicate rows it was never given, and a report naming a stranger's recommendation id would
 * otherwise write a verdict (and a deferral) onto somebody else's backlog item.
 */
export function parseLaneReport(raw: string | null, batchIds: readonly string[]): LaneReport {
  if (!raw || raw.trim() === "") return { ...EMPTY };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...EMPTY, raw: raw.slice(0, RAW_EXCERPT_MAX) };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ...EMPTY, raw: raw.slice(0, RAW_EXCERPT_MAX) };
  }

  const doc = parsed as Record<string, unknown>;
  const allowed = new Set(batchIds);
  const seen = new Set<string>();
  const items: LaneReportItem[] = [];
  const rawItems = Array.isArray(doc.items) ? doc.items : [];
  for (const entry of rawItems) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    const id = asString(e.recommendationId ?? e.id, 100);
    // Not dispatched, or claimed twice — the first claim stands, so a report cannot overwrite its own
    // earlier verdict with a friendlier one further down the file.
    if (!id || !allowed.has(id) || seen.has(id)) continue;
    seen.add(id);
    items.push({
      recommendationId: id,
      verdict: asVerdict(e.verdict),
      reason: asString(e.reason, REASON_MAX),
      files: (Array.isArray(e.files) ? e.files : [])
        .filter((f): f is string => typeof f === "string")
        .slice(0, FILES_MAX)
        .map((f) => f.slice(0, FILE_PATH_MAX)),
    });
  }

  const lessons = (Array.isArray(doc.lessons) ? doc.lessons : [])
    .filter((l): l is string => typeof l === "string")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, LESSONS_MAX)
    .map((l) => l.slice(0, LESSON_MAX));

  // A document that parsed as JSON but carried neither items nor lessons is still `parsed: true`: the
  // agent wrote a well-formed report saying nothing, which is a claim, unlike a missing file.
  return { v: 1, parsed: true, items, lessons };
}

/** Read and parse the report from a lane's worktree. A missing file is `parsed: false`, not an error. */
export async function readLaneReport(dir: string, batchIds: readonly string[]): Promise<LaneReport> {
  let raw: string | null = null;
  try {
    raw = await readFile(join(dir, LANE_REPORT_PATH), "utf8");
  } catch {
    return { ...EMPTY };
  }
  return parseLaneReport(raw, batchIds);
}

/** The paragraph appended to the lane prompt. Kept beside the parser so the ASK and the READ cannot
 *  drift into describing two different files. */
export function laneReportContract(batchIds: readonly string[]): string {
  return [
    "",
    "REPORT BACK — WRITE `.ascent/lane-report.json` BEFORE YOU FINISH:",
    "```json",
    '{ "v": 1, "items": [{ "recommendationId": "<id>", "verdict": "resolved|skipped|needs_human", "reason": "<one sentence>", "files": ["<path>"] }], "lessons": ["<one durable thing this repository taught you>"] }',
    "```",
    `- One entry per dispatched id, and only these ids: ${batchIds.join(", ")}.`,
    "- `skipped` and `needs_human` are FIRST-CLASS answers and are more useful than a hedge: a skip with a reason stops this item being re-dispatched next cycle, while an unexplained attempt does not.",
    "- Your verdict is your account, not the ruling. A row closes only when the next scan stops raising the gap AND the dimension measurably moved.",
    "- `lessons` are for what a future agent working THIS organization's repositories should know. They become reviewable candidates a human decides on; they are not written into memory by you.",
    "- Do NOT commit this file. It is excluded from the branch on purpose.",
  ].join("\n");
}
