// POST /api/org/import  { org, count?, repos?, mock?, watch?, schedule?, installationId? }  — Server-Sent Events.
//
// Bulk scan of an org's (or user's) repositories, scanning each, persisting under the `org`
// slug, and marking them watched + scheduled BY DEFAULT (watch defaults to true, schedule to
// "weekly" — recurring autoscans are opt-out; pass watch:false / schedule:"off" for a one-shot
// import). An invalid `schedule` is rejected with 400, parity with /api/org/schedule.
//
// This powers three things:
//   1. The free-tier funnel: "scan a whole public org" without installing the App.
//   2. Onboarding of PRIVATE repos: when the caller passes an `installationId` (or the org
//      has a stored installation), we mint a short-lived installation token so the scan can
//      read private/org repos. The GitHub source needs a token for any private metadata/tree/
//      contents — even a mock-LLM scan fetches the real snapshot — so without it a private
//      repo would 404. Falls back to GITHUB_TOKEN for the public funnel, unchanged.
//   3. Local demo/seeding (see scripts/seed-org.mjs and docs/features/fleet/enterprise.md §5).
//
// Needs DATABASE_URL. A GITHUB_TOKEN (env) is strongly recommended to avoid rate limits.

import { NextResponse } from "next/server";
import { scanRepository } from "@/lib/scan";
import {
  getInstallationIdForOwner,
  isByomActive,
  isDbConfigured,
  persistScanReport,
  persistTeamStandings,
  reconcileListedRepos,
  recordQuotaEvent,
  recordScanOutcome,
  setRepoSchedule,
  setRepoWatch,
} from "@/lib/db";
// Imported from the sub-module (not the "@/lib/db" barrel) so it is a process-local advisory claim,
// NOT the cron's DB `nextScanAt` lease — see claimRepoScan's rationale in org-watch.ts. Import repos may
// have no Repository row yet (created mid-scan), so a DB-row claim is impossible on this path.
import { claimRepoScan, releaseRepoScan } from "@/lib/db/org-watch";
import { getInstallationToken, isAppConfigured } from "@/lib/github/app";
import { isValidHandle, isValidRepoName, listOrgRepos } from "@/lib/github/list";
import { isAuthConfigured } from "@/lib/auth";
import { authGateEnabled, getViewer } from "@/lib/access";
import { canMintInstallationToken, requireFleetOrg, requireOrgAccess } from "@/lib/authz";
import { normalizeOrgSlug } from "@/lib/db/org-shared";
import { checkScanEntitlement, paymentRequired } from "@/lib/entitlement";
import {
  consumePublicScanQuota,
  peekPublicScanQuota,
  refundPublicScanQuota,
  type QuotaIdentity,
} from "@/lib/public-scan-quota";
import { refundScanCredit, reserveScanCredit, shouldRefundScan } from "@/lib/scan-credit";
import { mapPool, SCAN_CONCURRENCY } from "@/lib/pool";
import { rateLimitRequestShared, tooManyRequests, ORG_IMPORT_RATE_LIMIT } from "@/lib/rate-limit";
import { SSE_HEADERS, makeSseSend } from "@/lib/sse-server";
import { SCHEDULES as SCAN_SCHEDULES } from "@/components/connect/installationRepoTypes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300; // bulk runs are long

const SCHEDULES = new Set<string>(SCAN_SCHEDULES);

// Cap an explicit caller-supplied repos[] so one (anonymous-capable) request can't fan out into
// hundreds of real GitHub ingests: the request rate-limit caps REQUESTS, not the fan-out WITHIN a
// request, and the metered slice below only bounds metered, non-unlimited orgs — so a public/unlimited
// caller could drive an unbounded batch. The `count` discovery path is already capped at 100; this
// mirrors the sibling /api/org/watch route's MAX_BULK.
const MAX_IMPORT_REPOS = 500;

export async function POST(request: Request) {
  if (!isDbConfigured()) {
    return NextResponse.json({ error: "Org import requires a database (DATABASE_URL)." }, { status: 503 });
  }
  // Bulk scan = up to 100 GitHub ingests + (optionally) LLM completions per call. Rate-limit hard.
  const rl = await rateLimitRequestShared(request, ORG_IMPORT_RATE_LIMIT);
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
    /** Opt in to public-funnel metering (free monthly public-scan allowance instead of credits).
     *  Honored only for a token-less, non-mock run — see the `publicFunnel` derivation below. */
    publicFunnel?: boolean;
  };
  const org = body.org ? normalizeOrgSlug(body.org) : undefined;
  if (!org) return NextResponse.json({ error: "Missing 'org'." }, { status: 400 });

  // Bring this mutating, tenant-scoped route to parity with its siblings (/api/org/scan, /watch,
  // /schedule), which all call requireOrgAccess at the top. Import spends prepaid credits
  // (consumeScanCredit) and writes the watchlist/schedule/Repository rows of `org` — all tenant-
  // scoped mutations — yet was the lone mutating org endpoint with no membership gate, so any
  // signed-in viewer (or anyone, on an auth-off deploy) could drain a victim org's credits and
  // inject repos/scores into its dashboard. requireOrgAccess leaves PUBLIC_ORG and auth-off
  // deployments open, so the free funnel + local seeding are preserved; the finer
  // canMintInstallationToken gate below still governs PRIVATE-repo access.
  const denied = await requireOrgAccess(org);
  if (denied) return denied;
  // Import scans + persists a whole repo set UNDER this org — for a personal workspace that would
  // fork public repos' shared series and bypass /api/me/watch's verify + cap (the lens invariant).
  const notFleet = await requireFleetOrg(org);
  if (notFleet) return notFleet;

  const count = Math.min(100, Math.max(1, body.count ?? 20));
  const mock = body.mock ?? true;
  // DEFAULTS ARE OPT-OUT by design: a bare { org } import watches every imported repo and enrolls it
  // in WEEKLY recurring autoscans (a standing credit draw for metered orgs) — the onboarding funnel
  // wants a live, self-updating fleet, and the client echoes { watch, schedule } on the "found"
  // progress event so the choice is visible. Pass watch:false / schedule:"off" to import passively.
  const watch = body.watch ?? true;
  // Validate rather than coerce (ambiguity-ui 2026-07-16 #3): the sibling /api/org/schedule 400s on
  // an invalid cadence, but this route silently rewrote "biweekly"/"Weekly"/typos to weekly — a
  // caller's explicit cadence intent became a recurring credit spend with a 200 and no signal.
  if (body.schedule !== undefined && !SCHEDULES.has(body.schedule)) {
    return NextResponse.json({ error: "Invalid schedule (off|daily|weekly|monthly)." }, { status: 400 });
  }
  const schedule = body.schedule ?? "weekly";

  // Mint an installation token (PRIVATE-repo access) ONLY for a caller with real standing in this org.
  //
  // The old gate was `!isAuthConfigured() || sessionOwnsOrg(org)`. isAuthConfigured() keys on the
  // DORMANT custom-OAuth env, unset in production, so `!false` made ownsOrg true for EVERY caller and
  // the supplied-installationId check below was equally short-circuited. Since requireOrgAccess leaves
  // PUBLIC_ORG open to any signed-in viewer, a signed-in caller could POST { org: "public",
  // installationId: <victim's enumerable id> } and mint the victim's token — the confused deputy the
  // comment below describes. canMintInstallationToken resolves real membership against the ACTIVE
  // Supabase wall and never allows PUBLIC_ORG.
  let token = process.env.GITHUB_TOKEN || undefined;
  let appTokenMinted = false;
  if (isAppConfigured() && (await canMintInstallationToken(org))) {
    // A caller-supplied installationId is only ever a hint for THIS org; honoring an arbitrary id was
    // the cross-tenant mint. Fall back to the org's own stored installation.
    const stored = (await getInstallationIdForOwner(org)) || undefined;
    const supplied = body.installationId?.trim();
    const installationId = supplied && stored && supplied === String(stored) ? supplied : stored;
    if (installationId) {
      const appToken = await getInstallationToken(installationId).catch(() => undefined);
      if (appToken) {
        token = appToken;
        appTokenMinted = true;
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
  //
  // The escape hatch used to be `!isAuthConfigured()`, the DORMANT predicate — true in production, so
  // the ambient PAT was handed to every scan and the confused deputy above was fully reachable. Key it
  // on "no auth stack is live at all" instead, which is what "auth-off local/demo" actually means.
  const authOff = !authGateEnabled() && !isAuthConfigured();
  // `orgSlug` mirrors /api/org/scan: scanRepository resolves the LLM provider via
  // getProviderForOrg(opts.orgSlug) (BYOM orgs run on their OWN Bedrock) and reads the org's standing
  // decisions (decisionSlug defaults to orgSlug). Omitting it made every import run on the PLATFORM
  // provider — even for a BYOM org whose inference is billed to its AWS account.
  const scanOpts = appTokenMinted || authOff
    ? { token, mock, orgSlug: org }
    : { noAmbientToken: true, mock, orgSlug: org };

  // Credits: a real-LLM import into a private org dashboard draws on prepaid credits. The default mock
  // import and the public funnel are free (mock runs no inference). Refuse up front when out of credits;
  // the per-repo slice below caps the batch to the balance. Enterprise is unlimited.
  // BYOM (parity with /api/org/scan and /api/cron/rescan): when the org scans on its OWN Bedrock,
  // inference is billed to its AWS account, so the platform never charges a scan credit — without this
  // term a BYOM org's import reserved platform credits per repo (or truncated the batch at balance 0).
  const byom = await isByomActive(org).catch(() => false);
  // G7-17. The PUBLIC FUNNEL: a real scan billed against the free monthly public-scan allowance
  // instead of prepaid credits, which is what let the onboarding wizard stop fabricating previews.
  //
  // It requires BOTH halves, and the second is the safety one:
  //   • the caller ASKS for it (`publicFunnel: true`) — an explicit opt-in, so no existing metered
  //     caller silently changes billing mode; and
  //   • the run is token-less (no installation token minted, not the auth-off operator/seeding path),
  //     which means `scanOpts.noAmbientToken` is set and a private repo 404s. So the mode is only ever
  //     granted to a run that is STRUCTURALLY incapable of scanning anything non-public.
  //
  // Asking for it on a run that DID mint a token is simply ignored (it stays credit-metered) — the flag
  // can't be used to scan private repos for free.
  const publicFunnel = body.publicFunnel === true && !mock && !appTokenMinted && !authOff;
  const metered = !mock && org !== "public" && !byom && !publicFunnel;
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

  // G7-17: the token-less public path draws on the FREE monthly public-scan allowance, not on credits.
  // The viewer is resolved HERE, in the route body — a cookie-scoped read inside the SSE `start()`
  // returns null, which would silently bucket a signed-in caller as anonymous (and at the anonymous,
  // lower limit). The peek is non-consuming; each repo consumes its own slot in the lane below.
  const publicQuotaIdentity: QuotaIdentity | null = publicFunnel
    ? { viewerId: (await getViewer().catch(() => null))?.id ?? null }
    : null;
  let publicScanCapacity = Number.POSITIVE_INFINITY;
  if (publicQuotaIdentity) {
    const peek = await peekPublicScanQuota(request, publicQuotaIdentity);
    if (peek.enforced) publicScanCapacity = peek.remaining;
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
          // Bound the client-supplied list length (see MAX_IMPORT_REPOS) and surface the truncation,
          // like the credit cap below does, so the caller isn't left thinking the dropped repos scanned.
          if (fullNames.length > MAX_IMPORT_REPOS) {
            const dropped = fullNames.length - MAX_IMPORT_REPOS;
            fullNames = fullNames.slice(0, MAX_IMPORT_REPOS);
            send("notice", { reason: "too_many_repos", scanning: fullNames.length, skipped: dropped });
          }
        } else {
          send("progress", { stage: "list", message: `Listing public repos for ${org}…` });
          const { repos, truncated } = await listOrgRepos(org, count, token);
          fullNames = repos.map((r) => ({ owner: r.owner, name: r.name, fullName: r.fullName, url: r.url }));
          // The listing's page budget ran out with more pages available (fork/archive-heavy org):
          // surface it like the other batch caps so a short import isn't read as the org's whole reality.
          if (truncated) {
            send("notice", { reason: "listing_truncated", scanning: fullNames.length });
          }
          // Reconcile the watchlist against this listing — the ONLY place a repo that was renamed,
          // transferred, deleted or turned private on GitHub can be noticed. Absence is evidence only
          // when the listing is COMPLETE, which is stricter than `!truncated`: a listing that filled
          // its `count` window stopped early for a different reason, and everything past the window
          // would be flagged as vanished. `repos.length < count` is the "walked the org to exhaustion"
          // proof. Best-effort — a bookkeeping failure must never break the import.
          const listingComplete = !truncated && repos.length < count;
          if (listingComplete) {
            await reconcileListedRepos(
              org,
              repos.map((r) => r.fullName),
            ).catch(() => ({ marked: 0, cleared: 0 }));
          }
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

        // The same cap for the public path, against the monthly free allowance rather than credits.
        // Disclosed as a `notice` exactly like the credit cap, so a short batch is never read as "these
        // repos scanned and scored nothing".
        let skippedForQuota = 0;
        if (publicQuotaIdentity && fullNames.length > publicScanCapacity) {
          skippedForQuota = fullNames.length - publicScanCapacity;
          fullNames = fullNames.slice(0, Math.max(0, publicScanCapacity));
          send("notice", { reason: "monthly_quota", scanning: fullNames.length, skipped: skippedForQuota });
        }
        if (fullNames.length === 0) {
          // Allowance fully spent. Say so — a real-scan funnel must not quietly substitute a preview.
          send("error", {
            error:
              "You've used your free public scans for this month. Add scan credits or install the GitHub App to keep scanning.",
          });
          return;
        }
        send("progress", { stage: "found", total: fullNames.length, mock, watch, schedule });

        // 2. Scan + persist each, with bounded concurrency (each lane emits its own per-repo events
        // as it resolves; the SSE consumer keys off each message's repo, not arrival order). A
        // realistic org import finishes in a fraction of the serial wall-clock and is far likelier
        // to fit the 300s budget. Counters are incremented in single-threaded lanes — race-free.
        //
        // `processed` is the progress-denominator index ("repos handled so far", skips included);
        // `scanned` is the OUTCOME metric (repos an actual scan ran for). The old code used one
        // variable for both, so claim-collision and mid-run credit skips were reported as `scanned`
        // in the final result — a run where every repo was claimed elsewhere emitted a
        // perfect-looking "scanned: N" with zero scans. (ambiguity-ui 2026-07-16 #4)
        let processed = 0;
        let scanned = 0;
        let skippedInProgress = 0;
        await mapPool(fullNames, SCAN_CONCURRENCY, async (r) => {
          // CLAIM this repo BEFORE reserving a credit or scanning — the run-level dedup guard the import
          // path was missing. If another in-flight run (a second import tab, another member, or an
          // overlapping /api/org/scan) already holds a live claim for (org, repo), skip: reserving +
          // scanning here would debit a second credit and burn a second real-LLM ingest for the SAME
          // repo (reserveScanCredit bounds TOTAL spend, not per-repo duplication). Released in the
          // finally below on EVERY exit path — including a hard TTL self-heal if this process is killed.
          const claim = claimRepoScan(org, r.fullName);
          if (claim === null) {
            send("repo", { repo: r.fullName, skipped: "in_progress" });
            skippedInProgress += 1;
            processed += 1;
            send("progress", { stage: "scan", repo: r.fullName, index: processed, total: fullNames.length });
            return;
          }
          try {
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
                processed += 1;
                send("repo", { repo: r.fullName, skipped: "insufficient_credits" });
                send("progress", { stage: "scan", repo: r.fullName, index: processed, total: fullNames.length });
                return; // finally releases the claim
              }
              reserved = reservation.reserved;
            }
            // The public path's equivalent of reserving a credit: consume one monthly free-scan slot
            // BEFORE the ingest, value-keyed so the refund below removes exactly this lane's slot.
            let quotaChargedAt: number | null = null;
            if (publicQuotaIdentity) {
              const q = await consumePublicScanQuota(request, publicQuotaIdentity);
              if (q.enforced && !q.allowed) {
                skippedForQuota += 1;
                processed += 1;
                send("repo", { repo: r.fullName, skipped: "monthly_quota" });
                send("progress", { stage: "scan", repo: r.fullName, index: processed, total: fullNames.length });
                return; // finally releases the claim
              }
              quotaChargedAt = q.chargedAt;
            }
            const refundQuota = async () => {
              if (publicQuotaIdentity && quotaChargedAt != null) {
                const at = quotaChargedAt;
                quotaChargedAt = null; // at most one refund per consumed slot
                await refundPublicScanQuota(request, publicQuotaIdentity, at);
              }
            };
            // One refund verb for both meters: whichever one this run charged, "nothing chargeable was
            // produced" must give it back. A caller that remembered only credits would silently burn a
            // free public slot on a deduped or degraded scan.
            const refundCredit = async () => {
              await refundScanCredit(org, reserved);
              await refundQuota();
            };
            send("progress", { stage: "scan", repo: r.fullName, index: processed, total: fullNames.length });
            // Set the moment `scanRepository` returns a REAL (non-mock) report: the inference is
            // already spent at that point. A failure AFTER it (persist, bookkeeping) must not refund —
            // see the catch below. A mock import leaves this false, so it still refunds. (Mock and BYOM
            // imports never reserve in the first place, so their refund is a no-op either way.)
            let inferenceBilled = false;
            try {
              const report = await scanRepository(r.fullName, scanOpts);
              inferenceBilled = report.engine.provider !== "mock";
              const persisted = await persistScanReport(report, { orgSlug: org });
              // Refund the reservation when nothing billable was produced: either the scan degraded to
              // mock (no real inference) OR the commit was unchanged since the last scan (`deduped` — no
              // new scored row). Mirrors the cron rescan's refund policy: a dedup run is free.
              if (shouldRefundScan(report, persisted)) await refundCredit();
              // Watchlist + schedule writes are bookkeeping AFTER a billable, persisted scan, so keep them
              // in their OWN best-effort try: a failure here must NOT reach the outer catch (which refunds
              // the credit and reports the repo as { error }). The notable failure is the lazy Organization
              // upsert inside setRepoWatch losing a P2002 create race on a brand-new org's first parallel
              // import — previously that refunded a genuinely-billed, persisted scan and flagged a scored
              // repo "error". The sibling /api/org/watch route keeps these writes serial for the same reason.
              if (watch) {
                try {
                  await setRepoWatch(org, r, true);
                  if (schedule !== "off") await setRepoSchedule(org, r.fullName, schedule);
                } catch (werr) {
                  console.error("[org/import] watchlist write failed", r.fullName, werr instanceof Error ? werr.message : werr);
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
              // Refund a PRE-inference failure only. Once scanRepository has returned a real report the
              // inference is paid for; refunding a persist failure would let a transient DB error hand
              // back a credit for work that really ran (and the retry re-bills it). Report `charged` so
              // the importer can see it paid for a repo whose report didn't land.
              if (!inferenceBilled) await refundCredit();
              const msg = err instanceof Error ? err.message : "scan failed";
              if (watch) await recordScanOutcome(org, r.fullName, { ok: false, error: msg }).catch(() => {});
              send("repo", { repo: r.fullName, error: msg, charged: inferenceBilled && reserved });
            }
            scanned += 1; // a scan actually ran for this repo (scored or failed) — never a skip
            processed += 1;
            send("progress", { stage: "scan", repo: r.fullName, index: processed, total: fullNames.length });
          } finally {
            // Release on EVERY exit — normal completion, the insufficient-credits early return, or a
            // throw from reserveScanCredit (which mapPool rethrows). A leaked claim would bar this repo
            // from re-import for the whole TTL; only a hard process kill relies on the TTL self-heal.
            releaseRepoScan(org, r.fullName, claim);
          }
        });
        // Capture the team-standings decomposition as a durable output of this full org import
        // (best-effort — every repo is persisted by now, so the rollup is fresh; a failure here must
        // never break the scan or the SSE result).
        await persistTeamStandings(org).catch(() => {});
        send("result", { org, scanned, total: fullNames.length, skippedForCredits, skippedForQuota, skippedInProgress, dashboard: `/org/${org}` });
      } catch (err) {
        send("error", { error: err instanceof Error ? err.message : "Org import failed." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
