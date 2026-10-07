// GET /api/org/scan/queue?org=&runId= — one interactive run's job states (moonshot #10).
//
// The "N queued — finishing in the background" poll behind OrgScanButton. A bulk scan that hits the
// 300s ceiling now leaves durable rows rather than a list of repos the user must click "Continue" on,
// so this endpoint is the read side of that promise: it says how much of YOUR run is still owed.
//
// GATE-THEN-CONSTRAIN (AGENTS.md): the caller-supplied `org` is gated, and the resolved org id is
// then passed into the query BESIDE `runId` (inside `listJobsForRun`), so a runId belonging to
// another org is simply not found rather than being authorized by the caller-supplied pair. This is
// not an `[id]` route — the run id is a query parameter — but it is the same discipline.

import { NextResponse } from "next/server";
import { isDbConfigured } from "@/lib/db";
// Deep path, not the barrel: db/index.ts is Director-owned and its queue re-export lands at merge.
import { listJobsForRun } from "@/lib/db/scan-jobs";
import { requireOrgAccess } from "@/lib/authz";
import { reportHandledError } from "@/lib/api/respond";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!isDbConfigured()) return NextResponse.json({ error: "A database is required." }, { status: 503 });
  const url = new URL(request.url);
  const org = url.searchParams.get("org")?.trim().toLowerCase();
  const runId = url.searchParams.get("runId")?.trim();
  if (!org || !runId) return NextResponse.json({ error: "Missing 'org' or 'runId'." }, { status: 400 });

  const denied = await requireOrgAccess(org);
  if (denied) return denied;

  // A failed read is NOT an empty run: total 0 / pending 0 reads as "finished" to both followers
  // (useOrgScanButton, useImportReattach), which would settle a run that still owes jobs. 503 answers
  // no evidence; both followers treat a non-OK poll that way (docs/adr/2026-10-07-failed-read-is-not-absence.md).
  let jobs: Awaited<ReturnType<typeof listJobsForRun>>;
  try {
    jobs = await listJobsForRun(org, runId);
  } catch (err) {
    console.error("[org/scan/queue] run read failed", err instanceof Error ? err.message : err);
    reportHandledError(err, { status: 503, message: "org scan queue run read failed" });
    return NextResponse.json({ error: "The run's queue state could not be read. Try again." }, { status: 503 });
  }
  const queued = jobs.filter((j) => j.state === "queued").length;
  const running = jobs.filter((j) => j.state === "claimed").length;
  const done = jobs.filter((j) => j.state === "done").length;
  const failed = jobs.filter((j) => j.state === "failed").length;
  const skipped = jobs.filter((j) => j.state === "skipped").length;
  return NextResponse.json({
    runId,
    total: jobs.length,
    queued,
    running,
    done,
    failed,
    skipped,
    // Deliberately not a fabricated ETA: the caller knows how many are left, and nothing here can
    // honestly say when the next cron pass runs (the cadence lives in deploy config).
    pending: queued + running,
    repos: jobs.map((j) => ({ repo: j.repoFullName, state: j.state })),
  });
}
