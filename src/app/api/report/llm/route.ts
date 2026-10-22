// GET /api/report/llm?repo=owner/name[@sha][&org=slug][&dims=D3,D9]  -> text/markdown
//
// The machine-readable twin of the report header's "Copy for LLM" chip (G5-17): the same briefing a
// human copies out of the page, fetchable by a script, a CI step, or an agent that was handed a repo
// name instead of a browser. Both surfaces call `reportLlmMarkdown` — one generator, so the endpoint
// can never drift from the button (pinned in route.test.ts by comparing the two byte-for-byte).
//
// ACCESS. Read through the shared export door, `readReportForExport` (src/lib/report/export-read.ts):
// the org is resolved by the permalink's own rule (a `?org=` hint only after canReadOrg, else the
// owner's readable org - an unauthenticated caller resolves to PUBLIC_ORG, so a private repo's report
// is simply not found), gated before the read, and read STRICT (an outage is a 503, never a 404). So
// under `?org=` the body is the briefing the chip on that same permalink copied.
//
// NOT PLAN-GATED, deliberately, unlike `/api/report/pdf`. The PDF is a rendered artifact sold as a Pro
// entitlement — a distinct deliverable. This markdown is the exact text the free in-page copy button
// already puts on any viewer's clipboard, so gating the endpoint would gate the TRANSPORT of something
// the viewer can already have, not a capability: it would only tax automation while a human with the
// same access clicks a button. If the copy chip ever becomes a paid surface, this route must move with
// it — the entitlement belongs to the payload, not to the fetch.
//
// SCOPE + LIFTS (export-1). `?dims=` takes /api/report/skill's grammar (comma list and/or repeated
// params) and narrows the briefing to those dimensions, which then opens with a line saying it is
// partial; an id the report does not carry is a 400, never a silent whole-report widening (the
// org/export rule for an explicit scope that does not resolve). The body is `composeBriefing`, the
// exact call the header's BriefingComposer makes, so the composer's "Copy URL" fetches what it
// copies. The org's measured lifts ride along only under the org the page itself reads them under
// (`briefingLiftOrg`: the gated owner org, or public with no hint in play) - never more than the
// viewer already sees on the roadmap. A failed lift read degrades to the unmeasured briefing. With
// no ?dims and no lifts the body is byte-identical to reportLlmMarkdown(report) (route.test.ts).
//
// 404 when the repo has no saved scan: like every export route, this reflects an existing report and
// never triggers a scan.

import { NextResponse } from "next/server";
import { readReportForExport } from "@/lib/report/export-read";
import { briefingLiftOrg, composeBriefing, parseBriefingScope } from "@/lib/report/briefing-scope";
import { EMPTY_LIFTS, getOrgExpectedLifts } from "@/lib/outcomes/expected-lift-load";
import { degradeTo } from "@/lib/scan-read-door";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const read = await readReportForExport(request, { label: "report/llm", noun: "Markdown export" });
  if (!read.ok) return read.response;

  const params = new URL(request.url).searchParams;
  const scope = parseBriefingScope(params, read.report);
  if (!scope.ok) return NextResponse.json({ error: scope.error }, { status: 400 });
  const liftOrg = briefingLiftOrg(read.orgSlug, read.parsed.owner, params.get("org"));
  const lifts = liftOrg
    ? await getOrgExpectedLifts(liftOrg).catch(degradeTo("report/llm: getOrgExpectedLifts", EMPTY_LIFTS))
    : EMPTY_LIFTS;
  const body = composeBriefing(read.report, scope.dims, lifts);
  // `inline` (not `attachment`): the primary caller is a script/agent piping the body into a prompt,
  // and a browser hitting the URL should be able to read it. The filename still rides along so a
  // "save as" lands on a sensible name. The door sanitizes every stem segment - the sha is
  // caller-supplied and unvalidated, so it must not be able to inject a header.
  const filename = `${read.stem}.md`;
  return new NextResponse(body, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `inline; filename="${filename}"`,
      // `no-store`, matching the PDF route: "Retest" sits beside the export controls, so a cached
      // body could hand a caller a PRE-RESCAN briefing with no indication it was stale.
      "cache-control": "private, no-store",
    },
  });
}
