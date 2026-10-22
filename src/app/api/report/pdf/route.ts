// GET /api/report/pdf?repo=owner/name[@sha][&org=slug]  -> application/pdf
//
// Server-renders a persisted maturity report as a PDF — the "PDF export" sold on Starter and up
// (planAllowsPdfExport; g1-02). Read-gated by the owning org (public reports are open; private reports
// require org read access), then entitlement-gated by plan for real (non-public) orgs. The parse, org
// rule (a canReadOrg-gated ?org= hint, as on the permalink), gate and STRICT read are the shared export
// door, readReportForExport (src/lib/report/export-read.ts).
// 404 when the repo has no saved scan: export reflects an existing report, it never triggers a scan.

import { createElement, type ReactElement } from "react";
import { NextResponse } from "next/server";
import { reportHandledError, respondError } from "@/lib/api/respond";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { ReportDocument } from "@/lib/pdf/report-document";
import { getCreditState } from "@/lib/db";
import { PUBLIC_ORG } from "@/lib/auth";
import { planAllowsPdfExport } from "@/lib/plans";
import { readReportForExport } from "@/lib/report/export-read";
import { pdfAttachmentResponse } from "@/lib/pdf/export-response";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Server-side PDF rendering (@react-pdf) is CPU-bound and can outrun the platform's default function
// window on a large report; give it the same headroom the other write/render routes take so a slow
// render returns a PDF instead of a truncated 504 (pdf-llm-export #7).
export const maxDuration = 60;

/** PDF export is a paid entitlement (Starter/`pro` and up) - see planAllowsPdfExport. PUBLIC_ORG is
 *  exempt: a public repo's report has always been free/unmetered (entitlement.ts mirrors the same
 *  exclusion for scan credits), so only a REAL org's plan is checked - the org the report is read under. */
async function pdfPlanGate(orgSlug: string): Promise<Response | null> {
  if (orgSlug === PUBLIC_ORG) return null;
  // A FAILED plan read is not "not on Pro": 503 try-again (reported), never the paywall wording.
  let credit: Awaited<ReturnType<typeof getCreditState>>;
  try {
    credit = await getCreditState(orgSlug);
  } catch (err) {
    return respondError(503, "Couldn't check your plan right now. Please try again in a moment.", { cause: err });
  }
  if (!planAllowsPdfExport(credit?.plan)) {
    return NextResponse.json({ error: "PDF export is a Pro-plan feature." }, { status: 403 });
  }
  return null;
}

export async function GET(request: Request) {
  // The plan gate runs between authorization and the read, so a Free org never costs a report read.
  const read = await readReportForExport(request, { label: "report/pdf", noun: "PDF export", beforeRead: pdfPlanGate });
  if (!read.ok) return read.response;
  const { report, stem } = read;

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
    reportHandledError(err, { message: "report/pdf render failed" });
    return NextResponse.json({ error: "Failed to render the PDF." }, { status: 500 });
  }
  // The stem is sanitized by the door: the sha is caller-supplied, so nothing can inject a header.
  const filename = `${stem}.pdf`;
  // `no-store`, matching every sibling export route (org export CSVs). The old `max-age=300` was an
  // implicit render-cost trade-off that could serve a PRE-RESCAN PDF: "Retest" sits right next to
  // "Export PDF" in ReportHeader, and a sha-less export within 5 minutes of a rescan came from browser
  // cache — a stale report sent onward with no indication (pdf-llm-export #3). Double-click re-renders
  // are already prevented client-side by DownloadButton's busy guard.
  return pdfAttachmentResponse(buffer, filename, "private, no-store");
}
