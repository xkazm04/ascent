// POST /api/org/scan  { org }  — Server-Sent Events.
// Scans every WATCHED repo in the org through its installation token, persisting each,
// emitting per-repo progress, then a final summary. Powers the dashboard's "Scan all".

import { NextResponse } from "next/server";
import { scanRepository } from "@/lib/scan";
import { getInstallationIdForOwner, isDbConfigured, listWatchedRepos, persistScanReport, recordScanOutcome } from "@/lib/db";
import { getInstallationToken, isAppConfigured } from "@/lib/github/app";
import { requireOrgAccess } from "@/lib/authz";
import { mapPool, SCAN_CONCURRENCY } from "@/lib/pool";

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

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (event: string, data: unknown) => {
        try {
          controller.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
        } catch {
          /* closed */
        }
      };
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
        const token = installationId ? await getInstallationToken(installationId).catch(() => undefined) : undefined;

        // Scan with bounded concurrency rather than strictly serially: each lane sends its own
        // per-repo events as it resolves (the SSE consumer already keys off each message's repo,
        // not arrival order), so the war-room fills in a fraction of the wall-clock and a realistic
        // fleet finishes inside the 300s budget. `done` is incremented in a single-threaded lane, so
        // the count is race-free.
        let done = 0;
        await mapPool(repos, SCAN_CONCURRENCY, async (repo) => {
          send("progress", { stage: "scan", repo: repo.fullName, index: done, total: repos.length });
          try {
            const report = await scanRepository(repo.fullName, { token });
            const persisted = await persistScanReport(report, { orgSlug: org });
            if (persisted && (persisted.failures.audit || persisted.failures.contributors > 0)) {
              console.warn("[org/scan] persisted with partial write failures", {
                repo: repo.fullName,
                scanId: persisted.scanId,
                failures: persisted.failures,
              });
            }
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
            const msg = err instanceof Error ? err.message : "scan failed";
            await recordScanOutcome(org, repo.fullName, { ok: false, error: msg }).catch(() => {});
            send("repo", { repo: repo.fullName, error: msg });
          }
          done += 1;
          send("progress", { stage: "scan", repo: repo.fullName, index: done, total: repos.length });
        });
        send("result", { scanned: done, total: repos.length });
      } catch (err) {
        send("error", { error: err instanceof Error ? err.message : "Bulk scan failed." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
