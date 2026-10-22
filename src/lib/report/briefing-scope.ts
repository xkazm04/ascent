// The scoped LLM briefing (export-1): one dimension selection, one composition, shared by the report
// header's BriefingComposer and `GET /api/report/llm?dims=`. Pure and client-safe (types + the pure
// markdown generator only), so the chip and the endpoint compose the SAME bytes by construction.
//
//   parseBriefingScope   ?dims= grammar of /api/report/skill (comma list and/or repeated params);
//                        an id the report does not carry is an error, never a silent widening.
//   scopeReportForBriefing  narrows dimensions (so their evidence and gaps), discrepancies and the
//                        roadmap to the selection. Strengths/risks are report-level strings and stay.
//   briefingScopeNote    the partiality line a pasted text otherwise loses: a scoped briefing says it
//                        is partial, and that the headline score and level are whole-repository.
//   composeBriefing      the ONE call both surfaces make. No selection (or every dimension) is the
//                        whole briefing, byte-identical to reportLlmMarkdown(report, { lifts }).
//   briefingLiftOrg      which org's measured lifts the endpoint may carry: only the org the page
//                        itself reads them under, never more.

import type { DimensionId, ScanReport } from "@/lib/types";
import type { LiftDistribution } from "@/lib/outcomes/aggregate";
import { reportLlmMarkdown } from "@/lib/report/llm-markdown";
import { PUBLIC_ORG } from "@/lib/org-constants";

export type BriefingScope = { ok: true; dims: DimensionId[] | null } | { ok: false; error: string };

/** Parse `?dims=` against the dimensions this report actually carries. Absent = whole report. */
export function parseBriefingScope(params: URLSearchParams, report: ScanReport): BriefingScope {
  const raw = params.getAll("dims").flatMap((v) => v.split(","));
  if (raw.length === 0) return { ok: true, dims: null };
  const tokens = raw.map((t) => t.trim().toUpperCase()).filter(Boolean);
  const known = new Set<string>(report.dimensions.map((d) => d.id));
  const bad = [...new Set(tokens.filter((t) => !known.has(t)))];
  if (tokens.length === 0) return { ok: false, error: "Unknown dimension: (empty)" };
  if (bad.length > 0) return { ok: false, error: `Unknown dimension${bad.length > 1 ? "s" : ""}: ${bad.join(", ")}` };
  // Report order, not click order: the same selection always renders the same bytes.
  const picked = new Set(tokens);
  return { ok: true, dims: report.dimensions.map((d) => d.id).filter((id) => picked.has(id)) };
}

/** A selection that is empty or covers every dimension is not a scope: it is the whole report. */
function isPartial(report: ScanReport, dims: readonly DimensionId[] | null | undefined): dims is readonly DimensionId[] {
  if (!dims || dims.length === 0) return false;
  const picked = new Set(dims);
  return report.dimensions.some((d) => !picked.has(d.id));
}

/** The report narrowed to the selected dimensions (rows keyed by a dimension id are filtered). */
export function scopeReportForBriefing(report: ScanReport, dims: readonly DimensionId[]): ScanReport {
  const keep = new Set<string>(dims);
  return {
    ...report,
    dimensions: report.dimensions.filter((d) => keep.has(d.id)),
    roadmap: report.roadmap.filter((r) => keep.has(r.dimension)),
    ...(report.discrepancies ? { discrepancies: report.discrepancies.filter((d) => keep.has(d.dimension)) } : {}),
  };
}

/** "Scoped briefing: 1 of 9 dimensions (D3). Overall score and level are whole-repository figures." */
export function briefingScopeNote(report: ScanReport, dims: readonly DimensionId[]): string {
  const total = report.dimensions.length;
  const noun = total === 1 ? "dimension" : "dimensions";
  return `Scoped briefing: ${dims.length} of ${total} ${noun} (${dims.join(", ")}). Overall score and level are whole-repository figures.`;
}

/** The briefing both the composer and the endpoint emit for a selection. */
export function composeBriefing(
  report: ScanReport,
  dims: readonly DimensionId[] | null | undefined,
  lifts?: ReadonlyMap<string, LiftDistribution> | null,
): string {
  if (!isPartial(report, dims)) return reportLlmMarkdown(report, { lifts });
  return reportLlmMarkdown(scopeReportForBriefing(report, dims), { lifts, scopeNote: briefingScopeNote(report, dims) });
}

/** `/api/report/llm?repo=...[&dims=D3,D9][&org=...]` - the URL whose body equals the composer's copy. */
export function briefingHref(opts: { repo: string; dims?: readonly string[] | null; org?: string | null }): string {
  const dims = opts.dims?.length ? `&dims=${opts.dims.map(encodeURIComponent).join(",")}` : "";
  const hint = opts.org?.trim();
  return `/api/report/llm?repo=${encodeURIComponent(opts.repo)}${dims}${hint ? `&org=${encodeURIComponent(hint)}` : ""}`;
}

export type BriefingPreview = { lines: number; chars: number; approxTokens: number };

/** Size readout computed from the exact string that will be copied (~4 chars per token). */
export function briefingPreview(text: string): BriefingPreview {
  return { lines: text.split("\n").length, chars: text.length, approxTokens: Math.ceil(text.length / 4) };
}

/**
 * The org whose measured lifts the endpoint may fold in, or null for none.
 *
 * The permalink reads its lift map under `readableOrgForOwner(owner)` (owner-as-slug when readable,
 * else public). The export door reads the report under the same org unless a readable `?org=` hint
 * redirected it. So: the owner org (the door just gated it), or the public org when no hint was in
 * play. A hint that moved the read elsewhere carries NO lifts: the page never showed that org's map.
 */
export function briefingLiftOrg(orgSlug: string, owner: string, hint: string | null | undefined): string | null {
  const ownerLc = owner.trim().toLowerCase();
  if (orgSlug === ownerLc && ownerLc !== PUBLIC_ORG) return orgSlug;
  const h = hint?.trim().toLowerCase();
  if (orgSlug === PUBLIC_ORG && h !== PUBLIC_ORG) return PUBLIC_ORG;
  return null;
}
