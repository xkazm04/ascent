// Shared PDF-attachment response construction for the three PDF export routes (report/pdf,
// org/briefing/pdf, org/security/pdf). All three were hand-rolling the identical `new NextResponse(...)`
// shape (content-type + Content-Disposition), but they have ALREADY DRIFTED on cache-control — that
// drift is preserved here, NOT flattened:
//   - report/pdf passes "private, no-store": a sha-less export can be served from cache within minutes
//     of a "Retest" (Retest sits right next to "Export PDF" in ReportHeader), so ANY caching risks
//     shipping a stale pre-rescan PDF with no indication (pdf-llm-export #3). See report/pdf/route.ts.
//   - org/briefing/pdf and org/security/pdf pass "private, max-age=300": these are dashboard-derived
//     snapshots (no adjacent "Retest" action racing the cache), so a short cache absorbs repeat
//     downloads of the same period without that staleness hazard.
// cache-control is therefore an explicit required parameter, not a shared default, so a future route
// can't accidentally inherit the wrong one.

import { NextResponse } from "next/server";

export function pdfAttachmentResponse(buffer: Buffer, filename: string, cacheControl: string): NextResponse {
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": cacheControl,
    },
  });
}
