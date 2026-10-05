// The permalink's unfurl strings, lifted out of page.tsx.
//
// TWO REASONS THIS IS ITS OWN MODULE. First, page.tsx was at 298 of its 300-line cap, so the drift
// read could not land beside an inline metadata builder. Second, and the point: the description is
// the claim this product makes to a reader who never opens the app. A Slack, X or GitHub unfurl of a
// seven-month-old reading used to assert "scores 50/100" with no date at all, in the present tense.
// Dating it is a provenance rule, not a formatting detail, so it is testable on its own.
//
// The dated clause is appended ONLY once the reading is past the window the scan pipeline itself
// enforces (`scanMaxCacheAgeMs()`), or when no scan date was recorded. A current reading's
// description is byte-identical to the undated one it has always been, so the common case is not
// made noisier to fix the misleading one.

import type { Metadata } from "next";
import { scanMaxCacheAgeMs } from "@/lib/scan-cache";
import { freshnessWindowLabel, reportFreshnessState } from "@/components/report/reportFreshness";

/** Just the fields the unfurl reads - deliberately narrower than ScanReport so the cold/failed
 *  branches can be exercised without building a whole report. */
export type UnfurlReport = {
  overallScore: number;
  level: { id: string; name: string };
  scannedAt?: string | null;
};

/** The as-of suffix for a reading that cannot honestly be presented as present-tense. Empty for a
 *  current one, which is what keeps that description byte-identical. */
function asOfClause(scannedAt: string | null | undefined, now?: number): string {
  const windowMs = scanMaxCacheAgeMs();
  const state = reportFreshnessState({ scannedAt, windowMs, now });
  if (state.tier === "unknown") return " The scan date is not recorded for this reading.";
  if (state.tier !== "stale") return "";
  const day = new Date(scannedAt as string).toISOString().slice(0, 10);
  return ` Scanned as of ${day}, which is older than the ${freshnessWindowLabel(windowMs)} window Ascent re-scans on.`;
}

/**
 * The full metadata triplet for a report permalink. `report` null + `lookupFailed` false is a cold
 * permalink (never scanned); `lookupFailed` true is a read that threw, which must never be
 * advertised as never-scanned (G4).
 */
export function reportMetadata({
  ref,
  report,
  lookupFailed,
  sha,
  now,
}: {
  ref: string;
  report: UnfurlReport | null;
  lookupFailed: boolean;
  sha?: string;
  now?: number;
}): Metadata {
  const title = report
    ? `${ref}: ${report.level.id} ${report.level.name} · Ascent`
    : lookupFailed
      ? `${ref}: report unavailable · Ascent`
      : `No report yet for ${ref} · Ascent`;
  const description = report
    ? `${ref} scores ${report.overallScore}/100 (${report.level.id} ${report.level.name}) on Ascent's AI-native maturity index${sha ? ` at ${sha.slice(0, 7)}` : ""}.${asOfClause(report.scannedAt, now)}`
    : lookupFailed
      ? `Ascent could not load a scan for ${ref} right now. Try again in a moment.`
      : `${ref} has not been scanned on Ascent yet.`;

  return {
    title,
    description,
    openGraph: { title, description, type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
}
