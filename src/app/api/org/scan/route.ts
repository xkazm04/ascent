// POST /api/org/scan  { org }  — Server-Sent Events.
// Scans every WATCHED repo in the org through its installation token, persisting each,
// emitting per-repo progress, then a final summary. Powers the dashboard's "Scan all".

import { NextResponse } from "next/server";
import { scanRepository } from "@/lib/scan";
import { getInstallationIdForOwner, isByomActive, isDbConfigured, listWatchedRepos, persistScanReport, persistTeamStandings, recordScanOutcome } from "@/lib/db";
// Imported from the sub-module (not the "@/lib/db" barrel) so it is a process-local advisory claim,
// NOT the cron's DB `nextScanAt` lease — see claimRepoScan's rationale in org-watch.ts.
import { claimRepoScan, releaseRepoScan } from "@/lib/db/org-watch";
import { getInstallationToken, isAppConfigured } from "@/lib/github/app";
import { requireFleetOrg, requireOrgAccess } from "@/lib/authz";
import { checkScanEntitlement, paymentRequired } from "@/lib/entitlement";
import { refundScanCredit, reserveScanCredit, shouldRefundScan } from "@/lib/scan-credit";
import { fleetDeadlineAt, mapPoolUntilDeadline, SCAN_CONCURRENCY } from "@/lib/pool";
import { SSE_HEADERS, makeSseSend } from "@/lib/sse-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // bulk runs are long

export async function POST(request: Request) {
  // Anchor the wall-clock budget at the START of the invocation: everything below (auth, entitlement,
  // token mint) eats into the same 300s ceiling the platform enforces, and a fleet past ~a dozen live
  // repos structurally cannot finish inside it. The batch loop stops issuing new work before the
  // ceiling so this run can emit an honest truncation frame instead of being process-killed silently.
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
  // internally, but listWatchedRepos / getInstallationIdForOwner / checkScanEntitlement query the raw
  // slug — so a mixed-case `org` passed the gate yet found zero watched repos against the lower-cased
  // org row, returning a misleading "No watched repositories" for a fully-populated watchlist.
  const org = body.org?.trim().toLowerCase();
  if (!org) return NextResponse.json({ error: "Missing 'org'." }, { status: 400 });
  // Authorize before minting the org's installation token: a non-member must not be able to trigger
  // a bulk scan that reads the org's (possibly private) watched repos and spends its token budget.
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
  const installationId = await getInstallationIdForOwner(org);

  // Credit gate for the batch: each watched-repo scan draws one prepaid credit (unless the org is on
  // an unlimited plan). Refuse up front if there are none; if the balance can't cover every repo, scan
  // as many as it allows and report the rest as skipped-for-credits rather than failing the whole run.
  // BYOM (Feature 1): when the org scans on its OWN Bedrock, inference is billed to its AWS account, so
  // the platform never charges a scan credit (enterprise is already unlimited; this is explicit + future-
  // proof). Resolved once for the batch.
  const byom = await isByomActive(org).catch(() => false);
  const metered = org.toLowerCase() !== "public" && !byom;
  let unlimited = true;
  let scanList = repos;
  let skippedForCredits = 0;
  if (metered) {
    const ent = await checkScanEntitlement(org);
    if (!ent.allowed) return paymentRequired(ent.balance);
    unlimited = ent.unlimited;
    if (!ent.unlimited) {
      // Optimistic cap from a point-in-time read: don't attempt repos beyond what's free+prepaid. The
      // cap is the monthly FREE allowance left PLUS the prepaid balance — capping on `balance` alone
      // wrongly skipped an org's included free scans (a Free org with its 10 monthly scans but 0
      // purchased credits saw slice(0,0) ⇒ everything skipped). The AUTHORITATIVE enforcement is still
      // the per-repo atomic reservation in the loop below (it classifies allowance vs credit vs deny),
      // so two concurrent batches can't both scan the same prepaid slice for free.
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
        // scanList to nothing. Without this, the pool runs over zero items and the client gets a
        // silent, successful-looking 0/0 result with no actionable stop — surface the real reason.
        if (scanList.length === 0) {
          send("error", { error: `Out of scan credits: ${repos.length} watched repos couldn't be scanned.` });
          return;
        }
        const token = installationId ? await getInstallationToken(installationId).catch(() => undefined) : undefined;

        // Tell the client up front when the prepaid balance can't cover every watched repo, so the
        // war-room shows "scanned N · M skipped (out of credits)" rather than silently doing fewer.
        if (skippedForCredits > 0) {
          send("notice", { reason: "insufficient_credits", scanning: scanList.length, skipped: skippedForCredits });
        }

        // Scan with bounded concurrency rather than strictly serially: each lane sends its own
        // per-repo events as it resolves (the SSE consumer already keys off each message's repo,
        // not arrival order), so the war-room fills in a fraction of the wall-clock and a realistic
        // fleet finishes inside the 300s budget. Counters are incremented in single-threaded lanes,
        // so they are race-free.
        //
        // `done` is the progress-denominator index (repos handled, skips included); `scanned` is the
        // OUTCOME metric (repos an actual scan ran for). One variable used to serve both roles, so
        // claim-collision and mid-run credit skips were reported as `scanned` in the final result.
        // (ambiguity-ui 2026-07-16 #4)
        let done = 0;
        let scanned = 0;
        let skippedInProgress = 0;
        const { remaining, truncated } = await mapPoolUntilDeadline(scanList, SCAN_CONCURRENCY, fleetDeadlineAt(invokedAt, maxDuration), async (repo) => {
          // CLAIM this repo BEFORE reserving a credit or scanning — the run-level dedup guard the manual
          // path was missing. If another in-flight run (a second tab, another member, or an overlapping
          // import) already holds a live claim, skip: reserving + scanning here would debit a second
          // credit and burn a second set of LLM tokens for the SAME repo (reserveScanCredit only bounds
          // TOTAL spend, not per-repo duplication). Released in the finally below on EVERY exit path.
          const claim = claimRepoScan(org, repo.fullName);
          if (claim === null) {
            send("repo", { repo: repo.fullName, skipped: "in_progress" });
            skippedInProgress += 1;
            done += 1;
            send("progress", { stage: "scan", repo: repo.fullName, index: done, total: scanList.length });
            return;
          }
          try {
            // RESERVE the credit BEFORE scanning (metered, non-unlimited plans). consumeScanCredit is an
            // atomic conditional decrement (WHERE scanCredits > 0), so two concurrent batches can't both
            // spend the same credit. A failed reservation means the balance was exhausted (often by
            // another in-flight batch) — skip this repo rather than scan it for free, which is what the
            // old "scan first, best-effort debit afterwards" path silently did. Refunded below if the
            // scan degrades to mock or throws (no real inference billed).
            let reserved = false;
            if (metered && !unlimited) {
              const reservation = await reserveScanCredit(org, repo.fullName);
              if (reservation.skip) {
                skippedForCredits += 1;
                send("repo", { repo: repo.fullName, skipped: "insufficient_credits" });
                done += 1;
                send("progress", { stage: "scan", repo: repo.fullName, index: done, total: scanList.length });
                return; // finally releases the claim
              }
              reserved = reservation.reserved;
            }
            const refundCredit = () => refundScanCredit(org, reserved);
            send("progress", { stage: "scan", repo: repo.fullName, index: done, total: scanList.length });
            // Set the moment `scanRepository` returns a REAL (non-mock) report: the inference is
            // already spent and billed to the platform at that point. Everything after it (persist,
            // bookkeeping) can still throw, and the catch below must NOT refund then — a refund there
            // hands back a credit for inference that genuinely ran, and the retry re-runs and
            // re-bills the same inference. A mock report never bills, so it leaves this false and a
            // later failure still refunds. (BYOM/unmetered orgs never reserved, so refund is a no-op.)
            let inferenceBilled = false;
            try {
              // SUB-PROGRESS. The fleet stream used to fall silent for the whole duration of a repo's
              // scan — which on a live LLM run is minutes, and reads as a hung wall. Forwarding the
              // scanner's own stages closes that gap WITHOUT changing the run's arithmetic: every
              // sub-stage frame carries the SAME `index`/`total` as the `stage:"scan"` frame emitted
              // just above it, so a consumer that assigns `done = index` (all of them do — none
              // increments) treats these as sub-progress of the current repo and the denominator can
              // never be inflated by them. `stage:"done"` is dropped: the `repo` frame below is the
              // authoritative end of this repo, and two "finished" signals would be one too many.
              const report = await scanRepository(repo.fullName, {
                token,
                orgSlug: org,
                onProgress: (p) => {
                  if (p.stage === "done") return;
                  send("progress", { stage: p.stage, repo: repo.fullName, index: done, total: scanList.length, pct: p.pct });
                },
              });
              inferenceBilled = report.engine.provider !== "mock";
              const persisted = await persistScanReport(report, { orgSlug: org });
              // Refund the reservation when nothing billable was produced: either the scan degraded to
              // mock (no real inference) OR the commit was unchanged since the last scan (`deduped` — no
              // new scored row). Mirrors the cron rescan's refund policy: a dedup run is free.
              if (shouldRefundScan(report, persisted)) await refundCredit();
              send("repo", {
                repo: repo.fullName,
                level: report.level.id,
                overall: report.overallScore,
                posture: report.posture.id,
                adoption: report.adoptionScore,
                rigor: report.rigorScore,
              });
              await recordScanOutcome(org, repo.fullName, { ok: true }).catch(() => {});
            } catch (err) {
              // PRE-inference failure (scanRepository threw, or it degraded to mock): nothing billable
              // was produced, so refund. POST-inference failure (the persist or a step after it threw):
              // the inference already ran and cost real money — keep the credit, or a DB serialization
              // conflict would silently mint a free scan on every retry. The org paid for a scan it
              // didn't get to keep, so SAY SO on the wire (`charged`) instead of charging silently.
              if (!inferenceBilled) await refundCredit();
              const msg = err instanceof Error ? err.message : "scan failed";
              await recordScanOutcome(org, repo.fullName, { ok: false, error: msg }).catch(() => {});
              send("repo", { repo: repo.fullName, error: msg, charged: inferenceBilled && reserved });
            }
            scanned += 1; // a scan actually ran for this repo (scored or failed) — never a skip
            done += 1;
            send("progress", { stage: "scan", repo: repo.fullName, index: done, total: scanList.length });
          } finally {
            // Release on EVERY exit — normal completion, the insufficient-credits early return, or a
            // throw from reserveScanCredit (which mapPool rethrows). A leaked claim would bar this repo
            // from future scans for the whole TTL; only a hard process kill relies on the TTL self-heal.
            releaseRepoScan(org, repo.fullName, claim);
          }
        });
        // The wall-clock budget ran out before every repo could be issued. The remainder was NEVER
        // touched — no claim, no credit, no scan, and pointedly NO recordScanOutcome, so an unreached
        // repo must not be reported (or persisted) as failed. Name the remainder explicitly so the
        // client's "Continue" walks exactly what's left instead of re-driving the whole fleet: a
        // continuation over already-scanned repos would dedupe-and-refund (free, see shouldRefundScan)
        // but would still burn the same wall clock and never reach the tail.
        if (truncated) {
          // Also log server-side: `send` swallows enqueue failures on a torn-down controller, and a
          // truncation that only ever existed in a lost frame is exactly the silence this fixes.
          console.warn(`[org/scan] ${org}: time budget reached — ${scanned}/${scanList.length} scanned, ${remaining.length} left`);
          send("truncated", {
            reason: "time_budget",
            scanned,
            done,
            remaining: remaining.length,
            total: scanList.length,
            repos: remaining.map((r) => r.fullName),
          });
        }
        // Capture the team-standings decomposition as a durable output of this full org scan
        // (best-effort — a failure here must never break the scan or the SSE result).
        await persistTeamStandings(org).catch(() => {});
        send("result", { scanned, total: scanList.length, skippedForCredits, skippedInProgress, truncated, remaining: remaining.length });
      } catch (err) {
        send("error", { error: err instanceof Error ? err.message : "Bulk scan failed." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
