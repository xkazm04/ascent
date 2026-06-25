// POST /api/org/scan  { org }  — Server-Sent Events.
// Scans every WATCHED repo in the org through its installation token, persisting each,
// emitting per-repo progress, then a final summary. Powers the dashboard's "Scan all".

import { NextResponse } from "next/server";
import { scanRepository } from "@/lib/scan";
import { getInstallationIdForOwner, isByomActive, isDbConfigured, listWatchedRepos, persistScanReport, recordScanOutcome } from "@/lib/db";
import { getInstallationToken, isAppConfigured } from "@/lib/github/app";
import { requireOrgAccess } from "@/lib/authz";
import { checkScanEntitlement, paymentRequired } from "@/lib/entitlement";
import { logPartialWrites, refundScanCredit, reserveScanCredit, shouldRefundScan } from "@/lib/scan-credit";
import { mapPool, SCAN_CONCURRENCY } from "@/lib/pool";
import { SSE_HEADERS, makeSseSend } from "@/lib/sse-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // bulk runs are long

export async function POST(request: Request) {
  if (!isAppConfigured() || !isDbConfigured()) {
    return NextResponse.json({ error: "Org scanning requires the GitHub App + a database." }, { status: 503 });
  }
  const body = (await request.json().catch(() => ({}))) as {
    org?: string;
    repos?: string[];
    staleOnlyDays?: number;
  };
  const org = body.org;
  if (!org) return NextResponse.json({ error: "Missing 'org'." }, { status: 400 });
  // Authorize before minting the org's installation token: a non-member must not be able to trigger
  // a bulk scan that reads the org's (possibly private) watched repos and spends its token budget.
  const denied = await requireOrgAccess(org);
  if (denied) return denied;

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
          send("error", { error: `Out of scan credits — ${repos.length} watched repos couldn't be scanned.` });
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
        // fleet finishes inside the 300s budget. `done` is incremented in a single-threaded lane, so
        // the count is race-free.
        let done = 0;
        await mapPool(scanList, SCAN_CONCURRENCY, async (repo) => {
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
              return;
            }
            reserved = reservation.reserved;
          }
          const refundCredit = () => refundScanCredit(org, reserved);
          send("progress", { stage: "scan", repo: repo.fullName, index: done, total: scanList.length });
          try {
            const report = await scanRepository(repo.fullName, { token, orgSlug: org });
            const persisted = await persistScanReport(report, { orgSlug: org });
            logPartialWrites("org/scan", repo.fullName, persisted);
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
            // Scan threw — no inference to bill, so refund the reservation.
            await refundCredit();
            const msg = err instanceof Error ? err.message : "scan failed";
            await recordScanOutcome(org, repo.fullName, { ok: false, error: msg }).catch(() => {});
            send("repo", { repo: repo.fullName, error: msg });
          }
          done += 1;
          send("progress", { stage: "scan", repo: repo.fullName, index: done, total: scanList.length });
        });
        send("result", { scanned: done, total: scanList.length, skippedForCredits });
      } catch (err) {
        send("error", { error: err instanceof Error ? err.message : "Bulk scan failed." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
