// POST /api/org/scan  { org }  — Server-Sent Events.
// Scans every WATCHED repo in the org through its installation token, persisting each,
// emitting per-repo progress, then a final summary. Powers the dashboard's "Scan all".
//
// SINCE moonshot #10 the batch is a durable QUEUE, not a loop: every selected repo is enqueued as a
// `ScanJob` under one `runId`, this request drains as many as fit inside its 300s budget, and the
// remainder stays queued for the cron. The old `truncated` frame — which named repos that had been
// dropped on the floor — is now a `queued` frame naming work that is still owed and will be done.

import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { isByomActive, isDbConfigured, listWatchedRepos, persistTeamStandings } from "@/lib/db";
// Deep path, not the barrel: `db/index.ts` is Director-owned and its queue re-export lands at merge.
// This import replaces the process-local `claimRepoScan` — the claim is now a row, so two tabs on two
// instances can no longer both reserve a credit and both run inference for the same repo.
import { enqueueScanJob, JOB_PRIORITY, listJobsForRun } from "@/lib/db/scan-jobs";
import { isAppConfigured } from "@/lib/github/app";
import { requireFleetOrg, requireOrgAccess } from "@/lib/authz";
import { checkScanEntitlement, paymentRequired } from "@/lib/entitlement";
import { drainLane } from "@/lib/scan-queue-worker";
import { fleetDeadlineAt, SCAN_CONCURRENCY } from "@/lib/pool";
import { SSE_HEADERS, makeSseSend } from "@/lib/sse-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // bulk runs are long

export async function POST(request: Request) {
  // Anchor the wall-clock budget at the START of the invocation: everything below (auth, entitlement,
  // enqueue) eats into the same 300s ceiling the platform enforces, and a fleet past ~a dozen live
  // repos structurally cannot finish inside it. The drain stops claiming new work before the ceiling
  // so this run can emit an honest "N queued" frame instead of being process-killed silently.
  const invokedAt = Date.now();
  if (!isAppConfigured() || !isDbConfigured()) {
    return NextResponse.json({ error: "Org scanning requires the GitHub App + a database." }, { status: 503 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    org?: string;
    repos?: string[];
    staleOnlyDays?: number;
  };
  // Canonicalize like the import route (body.org?.trim().toLowerCase()): the access gate normalizes
  // internally, but listWatchedRepos / checkScanEntitlement query the raw slug — so a mixed-case
  // `org` passed the gate yet found zero watched repos against the lower-cased org row, returning a
  // misleading "No watched repositories" for a fully-populated watchlist.
  const org = body.org?.trim().toLowerCase();
  if (!org) return NextResponse.json({ error: "Missing 'org'." }, { status: 400 });
  // Authorize before enqueuing anything that will mint the org's installation token: a non-member must
  // not be able to trigger a bulk scan that reads the org's (possibly private) watched repos.
  const denied = await requireOrgAccess(org);
  if (denied) return denied;
  // A bulk scan PERSISTS under this org — for a personal workspace that would fork each public
  // repo's shared series (the lens invariant). Personal rescans ride the public report flow.
  const notFleet = await requireFleetOrg(org);
  if (notFleet) return notFleet;

  let repos = await listWatchedRepos(org);
  // Optional scope so "Scan all watched" isn't the only mode — both avoid burning the org's token
  // budget re-scanning repos that don't need it:
  //   • repos:[...]      — an explicit set (e.g. a single repo's "Rescan" from the leaderboard).
  //   • staleOnlyDays:N  — only repos whose last scan is older than N days (never-scanned always in).
  if (Array.isArray(body.repos) && body.repos.length > 0) {
    const want = new Set(body.repos.map((s) => s.toLowerCase()));
    repos = repos.filter((r) => want.has(r.fullName.toLowerCase()));
  }
  if (typeof body.staleOnlyDays === "number" && body.staleOnlyDays > 0) {
    const cutoff = Date.now() - body.staleOnlyDays * 86_400_000;
    repos = repos.filter((r) => !r.lastScanAt || new Date(r.lastScanAt).getTime() < cutoff);
  }

  // Credit gate for the batch: each watched-repo scan draws one prepaid credit (unless the org is on
  // an unlimited plan). Refuse up front if there are none; if the balance can't cover every repo, scan
  // as many as it allows and report the rest as skipped-for-credits rather than failing the whole run.
  // BYOM (Feature 1): when the org scans on its OWN Bedrock, inference is billed to its AWS account, so
  // the platform never charges a scan credit. Resolved once for the batch.
  const byom = await isByomActive(org).catch(() => false);
  const metered = org.toLowerCase() !== "public" && !byom;
  let scanList = repos;
  let skippedForCredits = 0;
  if (metered) {
    const ent = await checkScanEntitlement(org);
    if (!ent.allowed) return paymentRequired(ent.balance);
    if (!ent.unlimited) {
      // Optimistic cap from a point-in-time read: don't enqueue repos beyond what's free+prepaid. The
      // cap is the monthly FREE allowance left PLUS the prepaid balance — capping on `balance` alone
      // wrongly skipped an org's included free scans. The AUTHORITATIVE enforcement is still the
      // per-repo atomic reservation in the worker (it classifies allowance vs credit vs deny), so two
      // concurrent batches can't both scan the same prepaid slice for free.
      const capacity = ent.balance + ent.allowanceRemaining;
      if (repos.length > capacity) {
        skippedForCredits = repos.length - capacity;
        scanList = repos.slice(0, capacity);
      }
    }
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = makeSseSend(controller);
      try {
        if (repos.length === 0) {
          const scoped = (body.repos?.length ?? 0) > 0 || (body.staleOnlyDays ?? 0) > 0;
          send("error", {
            error: scoped
              ? "No watched repositories matched the scan scope (they may all be fresh)."
              : "No watched repositories. Toggle 'watch' on some repos first.",
          });
          return;
        }
        // Distinct from "no watched repos": the watchlist is non-empty but the prepaid balance sliced
        // scanList to nothing. Without this, the drain runs over zero jobs and the client gets a
        // silent, successful-looking 0/0 result with no actionable stop — surface the real reason.
        if (scanList.length === 0) {
          send("error", { error: `Out of scan credits: ${repos.length} watched repos couldn't be scanned.` });
          return;
        }

        // Tell the client up front when the prepaid balance can't cover every watched repo, so the
        // war-room shows "scanned N · M skipped (out of credits)" rather than silently doing fewer.
        if (skippedForCredits > 0) {
          send("notice", { reason: "insufficient_credits", scanning: scanList.length, skipped: skippedForCredits });
        }

        // ENQUEUE FIRST, then drain. Every selected repo becomes a durable row before any of them is
        // scanned, so the 300s ceiling can no longer lose work. `runId` groups the batch so the client
        // can poll exactly its own remainder (GET /api/org/scan/queue).
        const runId = randomUUID();
        const jobs: { id: string; repo: string }[] = [];
        for (const repo of scanList) {
          const enq = await enqueueScanJob({
            orgSlug: org,
            repoFullName: repo.fullName,
            lane: "rescore",
            reason: "manual",
            bucket: runId,
            runId,
            priority: JOB_PRIORITY.manual,
          }).catch(() => null);
          if (enq) jobs.push({ id: enq.id, repo: repo.fullName });
        }

        // `done` is the progress-denominator index (repos handled, skips included); `scanned` is the
        // OUTCOME metric (repos an actual scan ran for). One variable used to serve both roles, so
        // claim-collision and mid-run credit skips were reported as `scanned` in the final result.
        // (ambiguity-ui 2026-07-16 #4)
        let done = 0;
        const total = scanList.length;
        const step = (repo: string) => {
          done += 1;
          send("progress", { stage: "scan", repo, index: done, total });
        };
        const summary = await drainLane("rescore", {
          concurrency: SCAN_CONCURRENCY,
          deadlineAt: fleetDeadlineAt(invokedAt, maxDuration),
          jobs,
          orgSlug: org,
          // SUB-PROGRESS: the scanner's own stages, forwarded with the SAME index/total as the
          // boundary frame before them, so a consumer that assigns `done = index` (all of them do —
          // none increments) reads them as sub-progress of the current repo and the denominator can
          // never be inflated. `stage:"done"` is dropped: the per-repo `repo` frame is the
          // authoritative end of a repo, and two "finished" signals would be one too many.
          onScanProgress: (repo, p) => {
            if (p.stage === "done") return;
            send("progress", { stage: p.stage, repo, index: done, total, pct: p.pct });
          },
          onRepo: (e) => {
            if (e.stage === "start") {
              send("progress", { stage: "scan", repo: e.repo, index: done, total });
            } else if (e.stage === "done") {
              send("repo", {
                repo: e.repo,
                level: e.level,
                overall: e.overall,
                posture: e.posture,
                adoption: e.adoption,
                rigor: e.rigor,
              });
              step(e.repo);
            } else if (e.stage === "error") {
              // The org paid for a scan it didn't get to keep when the failure landed AFTER inference,
              // so SAY SO on the wire (`charged`) instead of charging silently.
              send("repo", { repo: e.repo, error: e.error, charged: e.charged });
              step(e.repo);
            } else if (e.stage === "skipped") {
              send("repo", { repo: e.repo, skipped: e.reason });
              step(e.repo);
            }
          },
        });
        const scanned = summary.done + summary.failed;
        skippedForCredits += summary.skippedForCredits;

        // The wall-clock budget ran out before every job could be claimed. THAT IS NO LONGER A LOSS:
        // the remainder is queued work the background worker completes, so the frame says `queued`
        // (work still owed) rather than `truncated` (work dropped), and the client polls instead of
        // re-driving the whole fleet — a continuation over already-scanned repos would dedupe-and-
        // refund but still burn the same wall clock and never reach the tail.
        const remaining = (await listJobsForRun(org, runId).catch(() => [])).filter(
          (j) => j.state === "queued" || j.state === "claimed",
        ).length;
        if (remaining > 0) {
          // Also log server-side: `send` swallows enqueue failures on a torn-down controller, and a
          // remainder that only ever existed in a lost frame is exactly the silence this fixes.
          console.warn(`[org/scan] ${org}: ${scanned}/${total} scanned this pass, ${remaining} left queued for the worker`);
          send("queued", { runId, queued: remaining, total });
        }
        // Capture the team-standings decomposition as a durable output of this full org scan
        // (best-effort — a failure here must never break the scan or the SSE result).
        await persistTeamStandings(org).catch(() => {});
        send("result", { runId, scanned, total, skippedForCredits, skippedInProgress: summary.skipped, queued: remaining });
      } catch (err) {
        send("error", { error: err instanceof Error ? err.message : "Bulk scan failed." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
