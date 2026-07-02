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
  getInstallationIdForOwner,
  isDbConfigured,
  persistScanReport,
  recordQuotaEvent,
  recordScanOutcome,
  setRepoSchedule,
  setRepoWatch,
} from "@/lib/db";
import { getInstallationToken, isAppConfigured } from "@/lib/github/app";
import { isValidHandle, isValidRepoName, listOrgRepos } from "@/lib/github/list";
import { isAuthConfigured } from "@/lib/auth";
import { authGateEnabled, getViewer } from "@/lib/access";
import { requireOrgAccess, sessionHasInstallation, sessionOwnsOrg } from "@/lib/authz";
import { checkScanEntitlement, paymentRequired } from "@/lib/entitlement";
import { logPartialWrites, refundScanCredit, reserveScanCredit, shouldRefundScan } from "@/lib/scan-credit";
import { mapPool, SCAN_CONCURRENCY } from "@/lib/pool";
import { rateLimitRequest, tooManyRequests, ORG_IMPORT_RATE_LIMIT } from "@/lib/rate-limit";
import { SSE_HEADERS, makeSseSend } from "@/lib/sse-server";
import { SCHEDULES as SCAN_SCHEDULES } from "@/components/connect/installationRepoTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // bulk runs are long

const SCHEDULES = new Set<string>(SCAN_SCHEDULES);

// Hard cap on a single import's fan-out. The `count` (listing) path is already Math.min(100, …), but an
// explicit `repos[]` list bypassed that entirely — a caller could POST thousands of coordinates and fan
// out that many GitHub ingests/scans (even mock scans fetch the real snapshot) inside one function,
// hammering GitHub/the box. Mirror the listing cap (and the watch route's MAX_BULK) so both intake paths
// are bounded; a truncated batch is surfaced via a `notice`.
const MAX_IMPORT = 100;

export async function POST(request: Request) {
  if (!isDbConfigured()) {
    return NextResponse.json({ error: "Org import requires a database (DATABASE_URL)." }, { status: 503 });
  }
  // Bulk scan = up to 100 GitHub ingests + (optionally) LLM completions per call. Rate-limit hard.
  const rl = rateLimitRequest(request, ORG_IMPORT_RATE_LIMIT);
  if (!rl.ok) {
    void recordQuotaEvent("rate_limit", "org-import").catch(() => {}); // QUOTA #2: observability on the bulk-import path
    return tooManyRequests(rl.retryAfterSec);
  }
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

  // Bring this mutating, tenant-scoped route to parity with its siblings (/api/org/scan, /watch,
  // /schedule), which all call requireOrgAccess at the top. Import spends prepaid credits
  // (consumeScanCredit) and writes the watchlist/schedule/Repository rows of `org` — all tenant-
  // scoped mutations — yet was the lone mutating org endpoint with no membership gate, so any
  // signed-in viewer (or anyone, on an auth-off deploy) could drain a victim org's credits and
  // inject repos/scores into its dashboard. requireOrgAccess leaves PUBLIC_ORG and auth-off
  // deployments open, so the free funnel + local seeding are preserved; the finer sessionOwnsOrg
  // token-mint gate below still governs PRIVATE-repo access.
  const denied = await requireOrgAccess(org);
  if (denied) return denied;

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
  let appTokenMinted = false;
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
        if (appToken) {
          token = appToken;
          appTokenMinted = true;
        }
      }
    }
  }

  // Public surfaces are token-less by construction (the README-badge convention,
  // ScanOptions.noAmbientToken): the ambient GITHUB_TOKEN is an operator PAT that commonly
  // carries private `repo` scope, and this route is a deliberately anonymous funnel that accepts
  // an explicit `repos[]` list — scanning with the PAT would let an anonymous caller name
  // "victim/secret" and exfiltrate a PRIVATE repo's report into the open org (confused deputy).
  // So unless a session-gated installation token was minted above, the SCANS run token-less
  // (private repos 404 instead of ingesting); the env token still feeds only the public
  // `listOrgRepos` listing below, for rate-limit relief. Auth-off (local/demo) deployments keep
  // the prior open behavior — they are operator-only by design and this is the documented
  // seeding path (scripts/seed-org.mjs).
  const scanOpts = appTokenMinted || !isAuthConfigured() ? { token, mock } : { noAmbientToken: true, mock };

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
  // Scan capacity for a non-unlimited org = monthly FREE allowance left + prepaid credits. Capping on
  // credits alone wrongly skipped an org's INCLUDED free scans (a Free org with its 10 monthly scans
  // but 0 purchased credits saw slice(0,0) ⇒ "scanned: 0, all insufficient_credits").
  let scanCapacity = 0;
  if (metered) {
    const ent = await checkScanEntitlement(org);
    if (!ent.allowed) return paymentRequired(ent.balance);
    unlimited = ent.unlimited;
    scanCapacity = ent.balance + ent.allowanceRemaining;
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = makeSseSend(controller);
      try {
        // 1. Resolve the repo list.
        let fullNames: { owner: string; name: string; fullName: string; url: string }[];
        if (body.repos?.length) {
          fullNames = body.repos.map((fn) => {
            const [owner = "", name = ""] = fn.includes("/") ? fn.split("/") : [org, fn];
            return { owner, name, fullName: `${owner}/${name}`, url: `https://github.com/${owner}/${name}` };
          });
          // Validate the UNTRUSTED repos[] coordinates before any value is interpolated into a
          // github.com / raw.githubusercontent.com URL. listOrgRepos validates the `org` handle, but
          // this client-supplied path bypassed it — a crafted "../../enterprises/x" or control-char
          // entry reached the GitHub helpers raw (a path-injection / SSRF-shaped surface on the
          // anonymous-capable mock funnel). Reject the whole batch on the first bad coordinate.
          const bad = fullNames.find((r) => !isValidHandle(r.owner) || !isValidRepoName(r.name));
          if (bad) {
            send("error", { error: `Invalid repository "${bad.fullName}". Use owner/name with valid GitHub names.` });
            return;
          }
          // Cap the explicit list to the same ceiling as the listing path so one request can't launch
          // thousands of scans; tell the client what was dropped.
          if (fullNames.length > MAX_IMPORT) {
            const dropped = fullNames.length - MAX_IMPORT;
            fullNames = fullNames.slice(0, MAX_IMPORT);
            send("notice", { reason: "batch_capped", scanning: MAX_IMPORT, dropped });
          }
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
        if (metered && !unlimited && fullNames.length > scanCapacity) {
          skippedForCredits = fullNames.length - scanCapacity;
          fullNames = fullNames.slice(0, scanCapacity);
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
            const reservation = await reserveScanCredit(org, r.fullName);
            if (reservation.skip) {
              skippedForCredits += 1;
              send("repo", { repo: r.fullName, skipped: "insufficient_credits" });
              scanned += 1;
              send("progress", { stage: "scan", repo: r.fullName, index: scanned, total: fullNames.length });
              return;
            }
            reserved = reservation.reserved;
          }
          const refundCredit = () => refundScanCredit(org, reserved);
          send("progress", { stage: "scan", repo: r.fullName, index: scanned, total: fullNames.length });
          try {
            const report = await scanRepository(r.fullName, scanOpts);
            const persisted = await persistScanReport(report, { orgSlug: org });
            logPartialWrites("org/import", r.fullName, persisted);
            // Refund the reservation when nothing billable was produced: either the scan degraded to
            // mock (no real inference) OR the commit was unchanged since the last scan (`deduped` — no
            // new scored row). Mirrors the cron rescan's refund policy: a dedup run is free.
            if (shouldRefundScan(report, persisted)) await refundCredit();
            // Watch/schedule are best-effort bookkeeping AFTER a successful, persisted, already-billed
            // scan. A failure here — notably the lazy Organization upsert in setRepoWatch→ensureOrg
            // racing itself when the first wave of lanes imports a BRAND-NEW org (the watch route
            // serializes precisely to dodge this; the pool reintroduces the concurrency) — must NOT
            // fall through to the outer catch, which would refund a credit for a scan that succeeded
            // AND report the repo as "failed". Isolate it: log and continue, so the repo is reported
            // scanned (it may just be left unwatched until the next toggle) with its credit intact.
            if (watch) {
              try {
                await setRepoWatch(org, r, true);
                if (schedule !== "off") await setRepoSchedule(org, r.fullName, schedule);
              } catch (watchErr) {
                console.error(
                  "[org/import] watch/schedule bookkeeping failed",
                  r.fullName,
                  watchErr instanceof Error ? watchErr.message : watchErr,
                );
              }
            }
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

  return new Response(stream, { headers: SSE_HEADERS });
}
