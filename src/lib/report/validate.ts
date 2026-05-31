// Runtime validation for a streamed/loaded ScanReport — the trust boundary between the
// /api/scan(/stream) payload and ReportView, which dereferences deeply (repo.stars
// .toLocaleString(), dimensions.map(), level.id, …). A malformed, truncated, or
// schema-drifted payload would otherwise throw mid-render and white-screen the page.
//
// Dependency-free by design (the codebase avoids runtime deps): a hand guard that
// validates the fields ReportView actually relies on and returns a friendly message
// instead of a thrown exception.

import type { ScanReport } from "@/lib/types";

export type ParseResult =
  | { ok: true; report: ScanReport }
  | { ok: false; error: string };

const isObj = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isStrArr = (v: unknown): v is string[] => Array.isArray(v) && v.every(isStr);

export function parseScanReport(data: unknown): ParseResult {
  const fail = (error: string): ParseResult => ({ ok: false, error });

  if (!isObj(data)) return fail("The scan returned an unexpected response.");
  // An error object delivered on the result channel — surface its message verbatim.
  if (isStr(data.error)) return fail(data.error);

  const r = data;

  if (!isObj(r.repo)) return fail("The report is missing repository details.");
  if (!isStr(r.repo.owner) || !isStr(r.repo.name) || !isStr(r.repo.url)) {
    return fail("The report's repository info is incomplete.");
  }
  if (!isNum(r.repo.stars)) return fail("The report's repository stats are malformed.");

  if (!isObj(r.level) || !isStr(r.level.id) || !isStr(r.level.name) || !isStr(r.level.description)) {
    return fail("The report's maturity level is malformed.");
  }
  if (!isObj(r.posture) || !isStr(r.posture.label) || !isStr(r.posture.blurb)) {
    return fail("The report's posture is malformed.");
  }
  if (!isObj(r.engine) || !isStr(r.engine.provider) || !isStr(r.engine.model)) {
    return fail("The report's engine info is malformed.");
  }
  if (!isObj(r.aiUsage) || typeof r.aiUsage.detected !== "boolean" || !isNum(r.aiUsage.commitFraction)) {
    return fail("The report's AI-usage summary is malformed.");
  }

  if (
    !isNum(r.overallScore) ||
    !isNum(r.adoptionScore) ||
    !isNum(r.rigorScore) ||
    !isNum(r.confidence)
  ) {
    return fail("The report's scores are malformed.");
  }
  if (!isStr(r.headline) || !isStr(r.archetype) || !isStr(r.scannedAt)) {
    return fail("The report's summary fields are malformed.");
  }
  if (!isStrArr(r.strengths) || !isStrArr(r.risks)) {
    return fail("The report's strengths/risks are malformed.");
  }

  if (!Array.isArray(r.dimensions) || r.dimensions.length === 0) {
    return fail("The report has no dimension scores.");
  }
  for (const d of r.dimensions) {
    if (
      !isObj(d) ||
      !isStr(d.id) ||
      !isStr(d.name) ||
      !isNum(d.score) ||
      !isNum(d.signalScore) ||
      !isNum(d.llmScore) ||
      !isNum(d.weight) ||
      !isStr(d.summary) ||
      !isStrArr(d.evidence) ||
      !isStrArr(d.strengths) ||
      !isStrArr(d.gaps)
    ) {
      return fail("A dimension score is malformed.");
    }
  }

  if (!Array.isArray(r.contributors)) return fail("The report's contributors are malformed.");
  for (const c of r.contributors) {
    if (!isObj(c) || !isStr(c.login) || !isNum(c.commits) || !isNum(c.aiCommits)) {
      return fail("A contributor entry is malformed.");
    }
  }

  if (!Array.isArray(r.roadmap)) return fail("The report's roadmap is malformed.");
  for (const it of r.roadmap) {
    if (!isObj(it) || !isStr(it.title) || !isStr(it.dimension) || !isStr(it.impact) || !isStr(it.effort)) {
      return fail("A roadmap item is malformed.");
    }
  }

  if (!Array.isArray(r.discrepancies)) return fail("The report's discrepancies are malformed.");

  return { ok: true, report: data as unknown as ScanReport };
}
