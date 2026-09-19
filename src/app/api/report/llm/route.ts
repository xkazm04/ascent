// GET /api/report/llm?repo=owner/name[@sha]  -> text/markdown
//
// The machine-readable twin of the report header's "Copy for LLM" chip (G5-17): the same briefing a
// human copies out of the page, fetchable by a script, a CI step, or an agent that was handed a repo
// name instead of a browser. Both surfaces call `reportLlmMarkdown` — one generator, so the endpoint
// can never drift from the button (pinned in route.test.ts by comparing the two byte-for-byte).
//
// ACCESS. Read-gated exactly like the sibling PDF/skill exports: `readableOrgForOwner` resolves the
// owning org for THIS viewer (an unauthenticated caller resolves to PUBLIC_ORG, so a private repo's
// report is simply not found) and `requireOrgRead` is applied before the report is read.
//
// NOT PLAN-GATED, deliberately, unlike `/api/report/pdf`. The PDF is a rendered artifact sold as a Pro
// entitlement — a distinct deliverable. This markdown is the exact text the free in-page copy button
// already puts on any viewer's clipboard, so gating the endpoint would gate the TRANSPORT of something
// the viewer can already have, not a capability: it would only tax automation while a human with the
// same access clicks a button. If the copy chip ever becomes a paid surface, this route must move with
// it — the entitlement belongs to the payload, not to the fetch.
//
// 404 when the repo has no saved scan: like every export route, this reflects an existing report and
// never triggers a scan.

import { NextResponse } from "next/server";
import { getScanReportByCommit, isDbConfigured } from "@/lib/db";
import { readableOrgForOwner } from "@/lib/auth";
import { requireOrgRead } from "@/lib/authz";
import { parseRepoParam } from "@/lib/report/repoParam";
import { reportLlmMarkdown } from "@/lib/report/llm-markdown";
import { safeFilenameSegment } from "@/lib/export/filename";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isDbConfigured())
    return NextResponse.json({ error: "Markdown export requires a database." }, { status: 503 });
  const params = new URL(request.url).searchParams;
  const q = params.get("repo");
  if (!q) return NextResponse.json({ error: "Missing ?repo=owner/name." }, { status: 400 });
  const parsed = parseRepoParam(q);
  if (!parsed) return NextResponse.json({ error: "Invalid repo. Use owner/name." }, { status: 400 });

  // Gate BEFORE the read — a private report's briefing is as sensitive as the report itself.
  const orgSlug = await readableOrgForOwner(parsed.owner);
  const denied = await requireOrgRead(orgSlug);
  if (denied) return denied;

  // Distinguish "no saved scan" (a genuine 404) from "the lookup FAILED" (transient infra), matching
  // the PDF route: collapsing both into 404 tells a caller to re-scan a repo that already has a report.
  let report;
  try {
    report = await getScanReportByCommit(parsed.owner, parsed.name, { headSha: parsed.sha, orgSlug });
  } catch (err) {
    console.error("[report/llm] report lookup failed", err);
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

  const body = reportLlmMarkdown(report);
  // `inline` (not `attachment`): the primary caller is a script/agent piping the body into a prompt,
  // and a browser hitting the URL should be able to read it. The filename still rides along so a
  // "save as" lands on a sensible name. Every interpolated segment is sanitized first — the sha is
  // caller-supplied and unvalidated, so it must not be able to inject a header.
  const filename = `ascent-${safeFilenameSegment(parsed.owner)}-${safeFilenameSegment(parsed.name)}${
    parsed.sha ? "-" + safeFilenameSegment(parsed.sha.slice(0, 7)) : ""
  }.md`;
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
