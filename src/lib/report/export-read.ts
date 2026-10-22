// The one read door every report export passes (PDF, LLM briefing, share card).
//
// Each export used to hand-roll this preamble, and they drifted from the permalink twice: they ignored
// its canReadOrg-gated `?org=` hint, and they never took its STRICT read. The rule here is "export
// what the page shows": the same org rule (./report-org.ts), the same gate, the same strict read.
//
//   parse ?repo  ->  resolve org (hint only after canReadOrg)  ->  requireOrgRead  ->  beforeRead
//   (the PDF plan gate)  ->  strict getScanReportByCommit  ->  404 empty | 503 unavailable
//
// STRICT, because the default reader resolves a configured-but-unreachable DB to null, which would
// answer 404 "Scan it first" and tell the user to spend a scan on a repo that already has a report.
// Pinned by src/app/api/report/export-door.test.ts: no export route reads the report around this door.

import { NextResponse } from "next/server";
import { reportHandledError } from "@/lib/api/respond";
import { getScanReportByCommit, isDbConfigured } from "@/lib/db";
import { requireOrgRead } from "@/lib/authz";
import { parseRepoParam } from "@/lib/report/repoParam";
import { resolveReportOrg } from "@/lib/report/report-org";
import { safeFilenameSegment } from "@/lib/export/filename";
import type { ScanReport } from "@/lib/types";

export type ParsedRepo = { owner: string; name: string; sha?: string };

export type ExportRead =
  | { ok: true; report: ScanReport; orgSlug: string; parsed: ParsedRepo; stem: string }
  | { ok: false; response: Response };

export type ExportReadOptions = {
  /** Log/report tag, e.g. "report/pdf". */
  label: string;
  /** Subject of the no-database 503, e.g. "PDF export". */
  noun: string;
  /** A route's own gate between authorization and the read (the PDF plan check). A Response stops. */
  beforeRead?: (orgSlug: string) => Promise<Response | null>;
};

const fail = (response: Response): ExportRead => ({ ok: false, response });

/** `ascent-{owner}-{name}[-{sha7}]`, every segment sanitized (the sha is caller-supplied). */
export function exportFilenameStem(parsed: ParsedRepo): string {
  const sha = parsed.sha ? "-" + safeFilenameSegment(parsed.sha.slice(0, 7)) : "";
  return `ascent-${safeFilenameSegment(parsed.owner)}-${safeFilenameSegment(parsed.name)}${sha}`;
}

export async function readReportForExport(request: Request, opts: ExportReadOptions): Promise<ExportRead> {
  if (!isDbConfigured()) return fail(NextResponse.json({ error: `${opts.noun} requires a database.` }, { status: 503 }));
  const params = new URL(request.url).searchParams;
  const q = params.get("repo");
  if (!q) return fail(NextResponse.json({ error: "Missing ?repo=owner/name." }, { status: 400 }));
  const parsed = parseRepoParam(q);
  if (!parsed) return fail(NextResponse.json({ error: "Invalid repo. Use owner/name." }, { status: 400 }));

  // Gate BEFORE the read: a private report's export is as sensitive as the report itself.
  const orgSlug = await resolveReportOrg(parsed.owner, params.get("org"));
  const denied = await requireOrgRead(orgSlug);
  if (denied) return fail(denied);
  const stopped = opts.beforeRead ? await opts.beforeRead(orgSlug) : null;
  if (stopped) return fail(stopped);

  let report: ScanReport | null;
  try {
    report = await getScanReportByCommit(parsed.owner, parsed.name, { headSha: parsed.sha, orgSlug, strict: true });
  } catch (err) {
    console.error(`[${opts.label}] report lookup failed`, err);
    reportHandledError(err, { message: `${opts.label} report lookup failed` });
    return fail(
      NextResponse.json({ error: "Couldn't load this report right now. Please try again in a moment." }, { status: 503 }),
    );
  }
  if (!report) {
    return fail(
      NextResponse.json({ error: "No saved scan for this repository yet. Scan it first, then export." }, { status: 404 }),
    );
  }
  return { ok: true, report, orgSlug, parsed, stem: exportFilenameStem(parsed) };
}
