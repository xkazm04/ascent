// GET /api/report/pdf?repo=owner/name[@sha]  -> application/pdf
//
// Server-renders a persisted maturity report as a PDF — the "PDF export" sold on the Private tier.
// Read-gated by the owning org (public reports are open; private reports require org read access).
// 404 when the repo has no saved scan: export reflects an existing report, it never triggers a scan.

import { createElement, type ReactElement } from "react";
import { NextResponse } from "next/server";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import { ReportDocument } from "@/lib/pdf/report-document";
import { getScanReportByCommit, isDbConfigured } from "@/lib/db";
import { readableOrgForOwner } from "@/lib/auth";
import { requireOrgRead } from "@/lib/authz";
import { parseRepoParam } from "@/lib/report/repoParam";
import { safeFilenameSegment } from "@/lib/export/filename";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  const report = await getScanReportByCommit(parsed.owner, parsed.name, { headSha: parsed.sha, orgSlug }).catch(
    () => null,
  );
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
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "private, max-age=300",
    },
  });
}
