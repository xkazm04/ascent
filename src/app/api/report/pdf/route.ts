// GET /api/report/pdf?repo=owner/name[@sha]  -> application/pdf
//
// Server-renders a persisted maturity report as a PDF — the "PDF export" sold on Pro and up
// (planAllowsPdfExport; g1-02). Read-gated by the owning org (public reports are open; private reports
// require org read access), then entitlement-gated by plan for real (non-public) orgs.
// 404 when the repo has no saved scan: export reflects an existing report, it never triggers a scan.

import { createElement, type ReactElement } from "react";
import { NextResponse } from "next/server";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { ReportDocument } from "@/lib/pdf/report-document";
import { getCreditState, getScanReportByCommit, isDbConfigured } from "@/lib/db";
import { PUBLIC_ORG, readableOrgForOwner } from "@/lib/auth";
import { requireOrgRead } from "@/lib/authz";
import { planAllowsPdfExport } from "@/lib/plans";
import { parseRepoParam } from "@/lib/report/repoParam";
import { safeFilenameSegment } from "@/lib/export/filename";
import { pdfAttachmentResponse } from "@/lib/pdf/export-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Server-side PDF rendering (@react-pdf) is CPU-bound and can outrun the platform's default function
// window on a large report; give it the same headroom the other write/render routes take so a slow
// render returns a PDF instead of a truncated 504 (pdf-llm-export #7).
export const maxDuration = 60;

export async function GET(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "PDF export requires a database." }, { status: 503 });
  const q = new URL(request.url).searchParams.get("repo");
  if (!q) return NextResponse.json({ error: "Missing ?repo=owner/name." }, { status: 400 });
  const parsed = parseRepoParam(q);
  if (!parsed) return NextResponse.json({ error: "Invalid repo. Use owner/name." }, { status: 400 });

  // Resolve the owning org and gate the read — a private report's PDF is as sensitive as the report.
  const orgSlug = await readableOrgForOwner(parsed.owner);
  const denied = await requireOrgRead(orgSlug);
  if (denied) return denied;

  // PDF export is a paid entitlement (Pro and up) — see planAllowsPdfExport. PUBLIC_ORG is exempt: a
  // public repo's report has always been free/unmetered (entitlement.ts mirrors the same exclusion for
  // scan credits), so only a REAL org's plan is checked here.
  if (orgSlug !== PUBLIC_ORG) {
    const credit = await getCreditState(orgSlug).catch(() => null);
    if (!planAllowsPdfExport(credit?.plan)) {
      return NextResponse.json({ error: "PDF export is a Pro-plan feature." }, { status: 403 });
    }
  }

  // Distinguish "no saved scan" (genuine 404) from "lookup FAILED" (transient infra, e.g. a DSQL IAM
  // token expiry). The old `.catch(() => null)` collapsed both into null → a transient error was shown
  // as 404 "Scan it first", telling the user to re-scan a repo that already HAS a report (wasting a
  // scan) and masking real incidents. Let a successful-but-empty lookup 404; surface an error as 503.
  let report;
  try {
    report = await getScanReportByCommit(parsed.owner, parsed.name, { headSha: parsed.sha, orgSlug });
  } catch (err) {
    console.error("[report/pdf] report lookup failed", err);
    return NextResponse.json(
      { error: "Couldn't load this report right now. Please try again in a moment." },
      { status: 503 },
    );
  }
  if (!report) {
    return NextResponse.json(
      { error: "No saved scan for this repository yet. Scan it first, then export." },
      { status: 404 },
    );
  }

  // ReportDocument returns a <Document>; the wrapper-component element type doesn't structurally match
  // renderToBuffer's ReactElement<DocumentProps> param, so narrow it through unknown (no `any`).
  const element = createElement(ReportDocument, { report }) as unknown as ReactElement<DocumentProps>;
  let buffer: Buffer;
  try {
    buffer = await renderToBuffer(element);
  } catch (err) {
    // A render failure (a malformed field, a @react-pdf edge case) must not escape as an unhandled 500
    // with a raw stack — return a clean error the client can show.
    console.error("[report/pdf] render failed", err);
    return NextResponse.json({ error: "Failed to render the PDF." }, { status: 500 });
  }
  // Sanitize every interpolated segment before it reaches the Content-Disposition header: owner/name
  // come from a real persisted report (clean) but the sha is caller-supplied and unvalidated — keep
  // only filename-safe chars so nothing can inject a header or a path separator.
  const filename = `ascent-${safeFilenameSegment(parsed.owner)}-${safeFilenameSegment(parsed.name)}${parsed.sha ? "-" + safeFilenameSegment(parsed.sha.slice(0, 7)) : ""}.pdf`;
  // `no-store`, matching every sibling export route (org export CSVs). The old `max-age=300` was an
  // implicit render-cost trade-off that could serve a PRE-RESCAN PDF: "Retest" sits right next to
  // "Export PDF" in ReportHeader, and a sha-less export within 5 minutes of a rescan came from browser
  // cache — a stale report sent onward with no indication (pdf-llm-export #3). Double-click re-renders
  // are already prevented client-side by DownloadButton's busy guard.
  return pdfAttachmentResponse(buffer, filename, "private, no-store");
}
