import type { ParseResult } from "@/lib/report/validate";

/** Canonical `owner/repo` key for comparing what we asked for against what a peek returned. */
export function repoKey(input: string): string {
  return input
    .toLowerCase()
    .replace(/^https?:\/\/github\.com\//, "")
    .replace(/^github\.com\//, "")
    .replace(/\.git$/, "")
    .replace(/^\/+|\/+$/g, "");
}

/**
 * True when a peeked/salvaged report is actually for the repo we asked about. Shared by
 * useReportScan's fast-path peek and its quota-salvage peek, which both peek a persisted report
 * and must reject one for a different repo before rendering it (e.g. a stale head-sha match, or
 * the `latest=1` salvage returning someone else's most-recent scan).
 */
export function matchesRequestedRepo(
  parsed: ParseResult,
  requested: string,
): parsed is Extract<ParseResult, { ok: true }> {
  if (!parsed.ok) return false;
  const gotKey = `${parsed.report.repo.owner}/${parsed.report.repo.name}`.toLowerCase();
  return gotKey === repoKey(requested);
}
