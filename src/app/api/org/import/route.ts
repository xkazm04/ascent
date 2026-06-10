// POST /api/org/import  { org, count?, repos?, mock?, watch?, schedule?, installationId? }  — Server-Sent Events.
//
// Bulk scan of an org's (or user's) repositories, scanning each, persisting under the `org`
// slug, and optionally marking them watched + scheduled.
//
// This powers three things:
//   1. The free-tier funnel: "scan a whole public org" without installing the App.
//   2. Onboarding of PRIVATE repos: when the caller passes an `installationId` (or the org
//      has a stored installation), we mint a short-lived installation token so the scan can
//      read private/org repos. The GitHub source needs a token for any private metadata/tree/
//      contents — even a mock-LLM scan fetches the real snapshot — so without it a private
//      repo would 404. Falls back to GITHUB_TOKEN for the public funnel, unchanged.
//   3. Local demo/seeding (see scripts/seed-org.mjs and docs/ENTERPRISE.md §5).
//
// Needs DATABASE_URL. A GITHUB_TOKEN (env) is strongly recommended to avoid rate limits.

import { NextResponse } from "next/server";
import { scanRepository } from "@/lib/scan";
import {
  consumeScanCredit,
  getInstallationIdForOwner,
  grantCredits,
  isDbConfigured,
  persistScanReport,
  recordScanOutcome,
  setRepoSchedule,
  setRepoWatch,
} from "@/lib/db";
import { getInstallationToken, isAppConfigured } from "@/lib/github/app";
import { listOrgRepos } from "@/lib/github/list";
import { isAuthConfigured } from "@/lib/auth";
import { authGateEnabled, getViewer } from "@/lib/access";
import { sessionHasInstallation, sessionOwnsOrg } from "@/lib/authz";
import { checkScanEntitlement, paymentRequired } from "@/lib/entitlement";
import { mapPool, SCAN_CONCURRENCY } from "@/lib/pool";
import { rateLimitRequest, tooManyRequests, ORG_IMPORT_RATE_LIMIT } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // bulk runs are long

const SCHEDULES = new Set(["off", "daily", "weekly", "monthly"]);

export async function POST(request: Request) {
  if (!isDbConfigured()) {
    return NextResponse.json({ error: "Org import requires a database (DATABASE_URL)." }, { status: 503 });
  }
  // Bulk scan = up to 100 GitHub ingests + (optionally) LLM completions per call. Rate-limit hard.
  const rl = rateLimitRequest(request, ORG_IMPORT_RATE_LIMIT);
  if (!rl.ok) return tooManyRequests(rl.retryAfterSec);
  const body = (await request.json().catch(() => ({}))) as {
    org?: string;
    count?: number;
    repos?: string[];
    mock?: boolean;
    watch?: boolean;
    schedule?: string;
    installationId?: string;
  };
  const org = body.org?.trim().toLowerCase();
  if (!org) return NextResponse.json({ error: "Missing 'org'." }, { status: 400 });

  const count = Math.min(100, Math.max(1, body.count ?? 20));
  const mock = body.mock ?? true;
  const watch = body.watch ?? true;
  const schedule = body.schedule && SCHEDULES.has(body.schedule) ? body.schedule : "weekly";

  // Mint an installation token (PRIVATE-repo access) ONLY for a caller who owns this org. Without
  // this gate an anonymous request could pass any `installationId` (or rely on the org's stored
  // install) to mint a token and read another tenant's PRIVATE repos. The public funnel is
  // unaffected: an anonymous caller's ownsOrg is false, so no token is minted and only public repos
  // resolve via the env GITHUB_TOKEN. Auth-off (local/demo) deployments keep the prior open behavior.
  let token = process.env.GITHUB_TOKEN || undefined;
  if (isAppConfigured()) {
    const ownsOrg = !isAuthConfigured() || (await sessionOwnsOrg(org));
    if (ownsOrg) {
      // A caller-supplied installationId must belong to the session (when auth is on); otherwise
      // fall back to the org's own stored installation.
      const supplied = body.installationId?.trim();
      let installationId: string | undefined;
      if (supplied && (!isAuthConfigured() || (await sessionHasInstallation(supplied)))) {
        installationId = supplied;
      }
      if (!installationId) installationId = (await getInstallationIdForOwner(org)) || undefined;
      if (installationId) {
        const appToken = await getInstallationToken(installationId).catch(() => undefined);
        if (appToken) token = appToken;
      }
    }
  }

  // Credits: a real-LLM import into a private org dashboard draws on prepaid credits. The default mock
  // import and the public funnel are free (mock runs no inference). Refuse up front when out of credits;
  // the per-repo slice below caps the batch to the balance. Enterprise is unlimited.
  const metered = !mock && org !== "public";
  // Supabase login wall on the PRIVATE/metered import path only — a real-inference import into a
  // tenant org is a gated "org feature". The free funnel (mock import, or the shared public org)
  // stays open / no-signup. Mirrors the scan-route gate (orgSlug !== "public").
  if (metered && authGateEnabled() && !(await getViewer())) {
    return NextResponse.json({ error: "Sign in to import a private organization." }, { status: 401 });
  }
  let unlimited = true;
  let creditBalance = 0;
  if (metered) {
    const ent = await checkScanEntitlement(org);
    if (!ent.allowed) return paymentRequired(ent.balance);
    unlimited = ent.unlimited;
    creditBalance = ent.balance;
  }

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
        // 1. Resolve the repo list.
        let fullNames: { owner: string; name: string; fullName: string; url: string }[];
        if (body.repos?.length) {
          fullNames = body.repos.map((fn) => {
            const [owner = "", name = ""] = fn.includes("/") ? fn.split("/") : [org, fn];
            return { owner, name, fullName: `${owner}/${name}`, url: `https://github.com/${owner}/${name}` };
          });
        } else {
          send("progress", { stage: "list", message: `Listing public repos for ${org}…` });
          const repos = await listOrgRepos(org, count, token);
          fullNames = repos.map((r) => ({ owner: r.owner, name: r.name, fullName: r.fullName, url: r.url }));
        }

        if (fullNames.length === 0) {
          send("error", { error: `No public repositories found for "${org}".` });
          return;
        }

        // Cap the batch to what the prepaid balance covers (metered, non-unlimited imports only) and
        // tell the client how many were left for credits.
        let skippedForCredits = 0;
        if (metered && !unlimited && fullNames.length > creditBalance) {
          skippedForCredits = fullNames.length - creditBalance;
          fullNames = fullNames.slice(0, creditBalance);
          send("notice", { reason: "insufficient_credits", scanning: fullNames.length, skipped: skippedForCredits });
        }
        send("progress", { stage: "found", total: fullNames.length, mock, watch, schedule });

        // 2. Scan + persist each, with bounded concurrency (each lane emits its own per-repo events
        // as it resolves; the SSE consumer keys off each message's repo, not arrival order). A
        // realistic org import finishes in a fraction of the serial wall-clock and is far likelier
        // to fit the 300s budget. `scanned` is incremented in single-threaded lanes — race-free.
        let scanned = 0;
        await mapPool(fullNames, SCAN_CONCURRENCY, async (r) => {
          // RESERVE the credit BEFORE scanning (metered, non-unlimited, non-mock imports). The atomic
          // conditional decrement enforces the prepaid balance even under concurrency, so two in-flight
          // imports can't both scan the same slice for free — the old path scanned first and only
          // best-effort-debited afterwards (failure swallowed). Refunded below if the scan degrades to
          // mock or throws.
          let reserved = false;
          if (metered && !unlimited) {
            const res = await consumeScanCredit(org, { repoFullName: r.fullName }).catch(() => null);
            if (!res || (!res.unlimited && !res.ok)) {
              skippedForCredits += 1;
              send("repo", { repo: r.fullName, skipped: "insufficient_credits" });
              scanned += 1;
              send("progress", { stage: "scan", repo: r.fullName, index: scanned, total: fullNames.length });
              return;
            }
            reserved = res.ok && !res.unlimited;
          }
          const refundCredit = async () => {
            if (reserved) await grantCredits(org, 1, { reason: "refund", actor: "system" }).catch(() => {});
          };
          send("progress", { stage: "scan", repo: r.fullName, index: scanned, total: fullNames.length });
          try {
            const report = await scanRepository(r.fullName, { token, mock });
            const persisted = await persistScanReport(report, { orgSlug: org });
            if (persisted && (persisted.failures.audit || persisted.failures.contributors > 0)) {
              console.warn("[org/import] persisted with partial write failures", {
                repo: r.fullName,
                scanId: persisted.scanId,
                failures: persisted.failures,
              });
            }
            // No real inference billed (degraded to mock) — refund the reservation made above.
            if (report.engine.provider === "mock") await refundCredit();
            if (watch) await setRepoWatch(org, r, true);
            if (watch && schedule !== "off") await setRepoSchedule(org, r.fullName, schedule);
            send("repo", {
              repo: r.fullName,
              level: report.level.id,
              overall: report.overallScore,
              posture: report.posture.id,
              adoption: report.adoptionScore,
              rigor: report.rigorScore,
              contributors: report.contributors?.length ?? 0,
            });
            // Only record an outcome once the repo row exists (watch=true upserts it above); the
            // public funnel (watch=false) may not have persisted a Repository row, so skip then.
            if (watch) await recordScanOutcome(org, r.fullName, { ok: true }).catch(() => {});
          } catch (err) {
            // Scan threw — no inference to bill, so refund the reservation made above.
            await refundCredit();
            const msg = err instanceof Error ? err.message : "scan failed";
            if (watch) await recordScanOutcome(org, r.fullName, { ok: false, error: msg }).catch(() => {});
            send("repo", { repo: r.fullName, error: msg });
          }
          scanned += 1;
          send("progress", { stage: "scan", repo: r.fullName, index: scanned, total: fullNames.length });
        });
        send("result", { org, scanned, total: fullNames.length, skippedForCredits, dashboard: `/org/${org}` });
      } catch (err) {
        send("error", { error: err instanceof Error ? err.message : "Org import failed." });
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
