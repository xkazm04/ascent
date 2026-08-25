// GET /api/cron/athena — Athena's autonomous cycle. Invoked by Vercel Cron (see vercel.json).
//
// For each org with a watched fleet: check nobody is mid-conversation, claim the period at-most-once,
// spend ONE metered completion on a briefing, and let report-or-absorb decide whether any of it is
// worth telling anyone. Guarded by CRON_SECRET. Requires DATABASE_URL.
//
// ── THIS IS THE ONLY HOSTED EXECUTION PATH ATHENA HAS ──────────────────────────────────────────
//
// The other unattended actor in this codebase, the local autopilot, is cloud-UNREACHABLE behind four
// guards: `selfHostGuard()` 404s it on managed cloud (`src/lib/api/self-host.ts:11`), `ASCENT_AUTOPILOT=1`
// must be set (`src/app/api/org/local/autopilot/route.ts:58`), the caller must hold `owner`
// (`:48`), and the repository must be paired to a local working copy on the server's own filesystem
// (`:64`). Nothing on a managed deployment can satisfy those. So this cron is where an Ascent
// deployment's companion actually gets to act on her own — which is exactly why the hosting
// discipline below is written down rather than assumed.
//
// ── THE HOSTING CONTRACT ───────────────────────────────────────────────────────────────────────
//
//   never overlaps itself   at-most-once per period via claimOrgAuditOnce (the digest's precedent)
//   never races a human     an org with a live turn is SKIPPED, never queued, and counted as such
//   declared ceiling        the budget is anchored at invocation and the untouched tail is `remaining`
//   degraded is not green   any error, any truncation, any engine-less org → 207, never a green 200

import { NextResponse } from "next/server";
import { getOrgId, isDbConfigured, listOrgsWithWatchedRepos } from "@/lib/db";
// Direct submodule import: the atomic once-per-window claim helpers are not re-exported through the
// @/lib/db barrel. Same call the weekly digest makes (digest/route.ts:213-225).
import { claimOrgAuditOnce, releaseAuditClaim } from "@/lib/db/scans-audit";
import { requireCronAuth } from "@/lib/cron-auth";
import { PUBLIC_ORG } from "@/lib/auth";
import { fleetDeadlineAt, mapPoolUntilDeadline } from "@/lib/pool";
import {
  ATHENA_CYCLE_ACTION,
  ATHENA_CYCLE_CONCURRENCY,
  ATHENA_CYCLE_PERIOD_MS,
  runOrgCycle,
  type CycleSkipReason,
} from "@/lib/athena/cycle";
import { buildOrgCycleDeps } from "./deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// COUPLED CONSTANT: this literal MUST equal ATHENA_CYCLE_MAX_DURATION_S in src/lib/athena/cycle.ts —
// the fan-out's soft deadline is derived from it (cap − FLEET_FINALIZE_RESERVE_MS) so the run stops
// issuing new orgs and RETURNS a summary instead of being process-killed with no response body.
// Next.js requires this segment config to be a statically-analyzable literal, so it cannot import the
// constant; route.test.ts pins the equality instead. Plan caveat: the platform honors 300s only up to
// the deployment plan's function cap.
export const maxDuration = 300;

export async function GET(request: Request) {
  // Anchor the budget at invocation start, before any await — the deadline the pool honors is measured
  // from HERE, not from whenever the org list happens to come back.
  const invokedAt = Date.now();

  // Fail-closed CRON_SECRET gate (503 when unset/empty, 401 on a bad credential), header-only and
  // compared in constant time. FIRST statement of the handler: this route spends real model budget on
  // every org in the fleet with nobody watching, so it must not be reachable without the secret.
  const denied = requireCronAuth(request);
  if (denied) return denied;

  if (!isDbConfigured()) {
    // A DB-unconfigured deploy must NOT report a green 200 — the same invariant the purge states
    // (purge/route.ts:34-47): cron monitors watch only the HTTP status, so a deploy that loses
    // DATABASE_URL would keep returning 200 daily while the companion silently stopped running.
    return NextResponse.json(
      { error: "Database is not configured (DATABASE_URL unset)." },
      { status: 503 },
    );
  }

  // The public funnel org has no companion (gateAthenaOrg refuses it explicitly), so it is not a
  // candidate here either — a briefing written for an org nobody owns has no reader.
  const orgs = (await listOrgsWithWatchedRepos()).filter((o) => o.toLowerCase() !== PUBLIC_ORG);
  const since = new Date(invokedAt - ATHENA_CYCLE_PERIOD_MS);

  let briefed = 0;
  let absorbedRuns = 0;
  let proposalsRaised = 0;
  let absorbedOutcomes = 0;
  let skippedAlreadyRan = 0;
  let skippedNoOrg = 0;
  const skips: Record<CycleSkipReason, number> = { no_landing: 0, live_turn: 0, no_standing: 0, no_engine: 0 };
  const errors: string[] = [];

  const { remaining, truncated } = await mapPoolUntilDeadline(
    orgs,
    ATHENA_CYCLE_CONCURRENCY,
    fleetDeadlineAt(invokedAt, maxDuration),
    async (org) => {
      let claimId: string | null = null;
      try {
        const orgId = await getOrgId(org);
        if (!orgId) {
          skippedNoOrg += 1;
          return;
        }

        // AT-MOST-ONCE, ATOMICALLY, BEFORE THE SPEND. One conditional insert whose affected-row count
        // decides the winner, so two overlapping invocations (a platform retry, a re-fired schedule)
        // cannot both brief the same org for the same period. Losing the claim is not an error — it
        // means a concurrent run already owns this window.
        const claim = await claimOrgAuditOnce(ATHENA_CYCLE_ACTION, org, since, {
          period: "day",
          since: since.toISOString(),
        });
        if (!claim.claimed) {
          skippedAlreadyRan += 1;
          return;
        }
        claimId = claim.id;

        const result = await runOrgCycle({
          orgSlug: org,
          signal: request.signal,
          deps: buildOrgCycleDeps({ org, orgId, signal: request.signal }),
        });

        if (result.skipped) skips[result.skipped] += 1;
        if (result.landed) briefed += 1;
        else if (!result.skipped) absorbedRuns += 1;
        proposalsRaised += result.proposals;
        absorbedOutcomes += result.absorbed;

        // RELEASE unless the cycle genuinely finished this org's period. Every skip and every failed
        // land left the window's work undone, and a window falsely marked done silences the org until
        // tomorrow — the same reasoning the digest releases on a failed dispatch (digest/route.ts).
        // An ABSORBED run holds its claim: the work WAS done and the answer was "nothing to say".
        if (!result.claimHeld) {
          await releaseAuditClaim(claimId);
          claimId = null;
        }
      } catch (err) {
        // The claim is released on the way out so a thrown org retries next tick rather than being
        // marked done by a run that produced nothing.
        await releaseAuditClaim(claimId).catch(() => {});
        errors.push(`${org}: ${err instanceof Error ? err.message : "failed"}`);
      }
    },
  );

  const body = {
    orgs: orgs.length,
    briefed,
    absorbedRuns,
    absorbedOutcomes,
    proposalsRaised,
    skippedAlreadyRan,
    skippedNoOrg,
    skippedLiveTurn: skips.live_turn,
    skippedNoLanding: skips.no_landing,
    skippedNoStanding: skips.no_standing,
    skippedNoEngine: skips.no_engine,
    remaining: remaining.length,
    truncated,
    errors,
  };

  // A DEGRADED run must not report a green 200: a non-2xx is the only thing a cron monitor watches.
  // Three channels trip it, and each is a different fixable fact —
  //   errors          an org threw;
  //   truncated       the wall-clock budget stopped the fan-out before every org was reached;
  //   skippedNoEngine no model would answer, so the cycle's whole reason for existing did nothing.
  // The last one is the analogue of the purge's DB-unconfigured branch: a deployment with no provider
  // would otherwise return a cheerful 200 every day while the companion never once ran.
  if (errors.length > 0 || truncated || skips.no_engine > 0) {
    console.warn("[cron/athena] completed degraded", {
      errors,
      truncated,
      remaining: remaining.length,
      skippedNoEngine: skips.no_engine,
    });
    return NextResponse.json(body, { status: 207 });
  }
  return NextResponse.json(body);
}
