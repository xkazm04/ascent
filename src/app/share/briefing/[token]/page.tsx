// /share/briefing/[token] — a read-only executive briefing authorized by a signed expiring token
// (EXEC-6) instead of a session, so an owner can share it with a board member who has no account.
// Outside the /org layout (no session gate); the token is the capability and carries the window.
// Exposes only what the Briefing tab shows. noindex so a leaked link isn't crawled.

import { Card, SectionHeader } from "@/components/org/shared/ui";
import { PriorPeriodGrid } from "@/features/bought/executive/briefingShared";
import { BriefingProofBanner } from "@/features/bought/executive/BriefingProofBanner";
import { BriefingBasisNote } from "@/features/bought/executive/BriefingBasisNote";
import {
  BriefingDimensionCards,
  BriefingGoalsCard,
  BriefingMovementCard,
  BriefingTiles,
} from "@/features/bought/executive/briefingCards";
import { ExecutiveTrajectoryCard } from "@/features/bought/executive/ExecutiveTrajectoryCard";
import { briefingSubject } from "@/lib/org/briefing-format";
import { buildExecBriefing, engineMixCaveat, engineMixLabel, mockDisclosure, valueRealizedHeading, valueRealizedLine } from "@/lib/org/briefing";
import { briefingFigureDigest, shareIntegrity, verifyBriefingShareToken } from "@/lib/briefing-share";
import { FiguresMovedNotice, Notice, ShareFooter, ShareHeader, tryAgainNotice } from "./shareChrome";
import { inclusiveEnd, resolveWindow } from "@/lib/window";
import { orgWindowBounds } from "@/lib/org/period";
import { getCreditState, getOrgBranding, getOrgId, getTechGroupIdByKey, isDbConfigured, recordAudit } from "@/lib/db";
import type { OrgWindow } from "@/lib/db";
import { briefingShareLinkState } from "@/lib/db/org-share";
import { reportHandledError } from "@/lib/api/respond";
import { degradedRead, noteReadFailure } from "@/lib/org/degraded-read";
import { getMembershipRole, roleAtLeast } from "@/lib/db/members";
import { planAllowsWhiteLabel } from "@/lib/plans";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

export default async function SharedBriefingPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const verified = verifyBriefingShareToken(token);
  if (!verified) {
    return <Notice title="Link expired or invalid" body="This shared briefing link is no longer valid. Ask an org owner for a fresh one." />;
  }
  if (!isDbConfigured()) return <Notice title="No data" body="This deployment has no database configured." />;

  // briefing-share #5: a per-link revocation lever. A token bound to its minting owner (mintedBy, set
  // under the Supabase wall) is honored only while that owner still holds owner access — so removing or
  // demoting them kills their shared links instead of letting a stateless token outlive their authority.
  // Legacy / stateless tokens (no mintedBy) keep the prior behavior. Fail-closed on a lookup error.
  if (verified.mintedBy) {
    // A FAILED read is not "the sharer lost access": still closed, but honest try-again wording.
    let minterRole: Awaited<ReturnType<typeof getMembershipRole>>;
    try {
      minterRole = await getMembershipRole(verified.org, verified.mintedBy);
    } catch (err) {
      noteReadFailure("briefing share minter role", err);
      return tryAgainNotice();
    }
    if (!roleAtLeast(minterRole, "owner")) {
      return (
        <Notice
          title="Link revoked"
          body="The person who shared this briefing no longer has access to the organization. Ask a current owner for a fresh link."
        />
      );
    }
  }
  // #13: the PER-GRANT kill switch, enforced on read like the live war-room's shared page does. The
  // check above revokes the minter's WHOLE set; this one kills a single leaked link. Only a token
  // carrying a `jti` has a handle (legacy ones keep the prior TTL-only behavior). Fails closed on a
  // lookup error — a shared briefing this page cannot vouch for is not shown.
  // Through the shared lookup, not an inlined ledger read: it fails closed BY CONSTRUCTION, so
  // this page cannot be the caller that forgets the .catch and quietly serves a revoked link.
  // `unreadable` (a ledger outage, already reported) stays closed but is not worded as a revocation.
  const linkState = verified.jti ? await briefingShareLinkState(verified.org, verified.jti) : "live";
  if (linkState === "unreadable") return tryAgainNotice();
  if (linkState === "revoked") {
    return <Notice title="Link revoked" body="This shared briefing link has been revoked. Ask an org owner for a fresh one." />;
  }

  const period = resolveWindow({ range: verified.range, from: verified.from, to: verified.to });
  // Finding B (clock-drift): use the ABSOLUTE window the owner froze at mint time, not one recomputed
  // against this viewer's clock. `winEnd` is present on every frozen token (an open-ended end was pinned
  // to the mint instant), so its presence is the "frozen" signal; `winStart` absent = an all-time (null)
  // start. A legacy link carries neither → fall back to `period` (the pre-fix behavior that re-floats to
  // the viewer's clock — kept so already-minted live links keep working). `period.title` stays the label.
  //
  // Direction 3 — the bounds are resolved through `orgWindowBounds`, the half-open dialect every
  // other org call site speaks. A token minted since then carries `winEndX`, the exclusive bound.
  // A token minted BEFORE it carries only the inclusive `winEnd`, and keeps it: such a link still
  // verifies (the payload gained a field, it never lost one, so the HMAC covers what it always did)
  // and still renders the same numbers, because it is still queried with the `lte` it was minted
  // for. Converting it here would move its window by a millisecond on a link already in an inbox.
  const frozen = verified.winEnd != null;
  const bounds = orgWindowBounds(period);
  const start = frozen ? (verified.winStart ? new Date(verified.winStart) : null) : bounds.start;
  /** The window this page re-runs the briefing over — half-open wherever the token can say so. */
  const shareWindow: OrgWindow = !frozen
    ? bounds
    : verified.winEndX
      ? { start, endExclusive: new Date(verified.winEndX) }
      : { start, end: new Date(verified.winEnd!) };
  /** The window's LAST INCLUDED instant, for the "data as of" label. */
  const lastInstant = frozen ? (verified.winEndX ? inclusiveEnd(new Date(verified.winEndX))! : new Date(verified.winEnd!)) : null;
  // executive-briefing 07-16 #5: Finding B froze the DATA at mint time but kept the floating
  // "last 90 days" label — so a viewer on day 6 of the TTL reads "last 90 days" over numbers that
  // provably aren't. Anchor the presentation with the absolute end of the frozen window; legacy
  // (unfrozen) tokens keep the plain title, which for them stays accurate.
  // The label names the window's LAST INCLUDED day: an exclusive bound is the next day's midnight
  // and would date a quarter's briefing one day into the following quarter.
  const asOf = lastInstant ? lastInstant.toISOString().slice(0, 10) : null;
  // EXEC #1: re-run scoped to the segment the owner shared (carried in the signed token), so a reseller's
  // per-client read-only link shows that client's data — not the whole org. Feature 3b: the same for the
  // tech-stack scope (resolve the carried KEY → group id within the org).
  // FAIL CLOSED on an unresolvable stack scope: the resolver returns null both for "no scope requested"
  // and for "requested but renamed/deleted/DB hiccup" — and a null filter means the WHOLE org. A link
  // the owner deliberately narrowed must never widen to full-fleet numbers, so treat an unresolvable
  // key like an invalid token instead of proceeding unscoped.
  const stackKey = verified.stack ?? null;
  let techGroupId: string | null = null;
  if (stackKey) {
    try {
      techGroupId = await getTechGroupIdByKey(verified.org, stackKey);
    } catch (err) {
      // A failed read is not "the scope no longer exists": closed, but try-again wording.
      noteReadFailure("briefing share stack scope", err);
      return tryAgainNotice();
    }
  }
  if (stackKey && !techGroupId) {
    return (
      <Notice
        title="Link expired or invalid"
        body="The scope this briefing was shared with no longer exists. Ask an org owner for a fresh link."
      />
    );
  }
  // White-label (EXEC-5): this share link is the artifact a reseller hands a client, so it renders the
  // org's brand mark instead of Ascent's. Entitlement is RE-CHECKED here like the PDF route — the brand
  // columns survive a plan downgrade, so applying them unconditionally would keep delivering a paid
  // feature after the org stopped paying for it.
  // A thrown build is not an empty fleet. Both used to render "Nothing to show yet", so a board
  // holding the link was told the organization had no scans when the read had failed.
  const [built, rawBranding, credit] = await Promise.all([
    buildExecBriefing(verified.org, shareWindow, period.title, verified.segment ?? null, techGroupId).then(
      (briefing) => ({ ok: true as const, briefing }),
      (err: unknown) => {
        console.error("[briefing/share] build failed", err instanceof Error ? err.message : err);
        reportHandledError(err, { message: "briefing share build failed" });
        return { ok: false as const };
      },
    ),
    getOrgBranding(verified.org).catch(degradedRead("briefing share branding", null)),
    getCreditState(verified.org).catch(degradedRead("briefing share credit state", null)),
  ]);
  const branding = planAllowsWhiteLabel(credit?.plan) ? rawBranding : null;
  if (!built.ok) {
    return (
      <Notice
        title="Briefing unavailable"
        body="This briefing could not be loaded just now. Ask the sender to try the link again."
      />
    );
  }
  const briefing = built.briefing;
  if (!briefing) {
    return <Notice title="Nothing to show yet" body={`No scanned repositories for ${verified.org} yet.`} />;
  }
  const { maturity, benchmark, priorPeriod } = briefing;
  // #26: compare the figures the sender saw (fingerprint carried in the signed token) against the ones
  // just rendered. This page is a LIVE RE-RENDER of a frozen period, not a stored document — the full
  // reasoning, and why a snapshot was NOT chosen, is in lib/briefing-share.ts (briefingFigureDigest).
  const integrity = shareIntegrity(verified.fig, briefingFigureDigest(briefing));
  // #13: the record that this grant was opened — the "was the briefing read, and how many times"
  // answer a stateless token could never give. Swallowed on failure by recordAudit; never blocks the read.
  if (verified.jti) {
    const orgId = await getOrgId(verified.org).catch(degradedRead("briefing share audit org id", null));
    await recordAudit("briefing.share.opened", { jti: verified.jti, integrity }, { orgId: orgId ?? undefined });
  }

  return (
    <>
      <ShareHeader branding={branding} />
      <main id="main" className="mx-auto w-full max-w-5xl px-5 py-10">
        <div className="mb-4 rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-2 type-mono-sm text-slate-500">
          Read-only shared briefing · {briefing.periodTitle}
          {asOf && <> · data as of {asOf}</>}
          {integrity === "unchanged" && <> · figures unchanged since this link was created</>}
        </div>
        {/* #26: say plainly which of the two this is, above the figures (see FiguresMovedNotice). */}
        {integrity === "changed" && <FiguresMovedNotice />}
        <SectionHeader
          descriptionClassName="max-w-3xl"
          // Named for the CLIENT on a per-client link: the segment comes from the signed token (never the
          // query string), and buildExecBriefing resolved its name org-constrained (briefingSubject).
          title={`${briefingSubject(briefing)}: executive briefing`}
          description={`AI-native engineering maturity standing over ${briefing.periodTitle.toLowerCase()}${asOf ? `, as of ${asOf} (window frozen when the link was created)` : ""}.`}
        />

        {/* No `orgSlug`: the tiles stay static cells (non-null orgSlug is what turns them into deep
            links into the authenticated app). `deltaLabel` IS passed (G5-12) — it's a plain comparison
            string ("vs last 90 days"), not a link or internal identifier, so it's safe on a public
            link and gives a board viewer the "vs what" context the internal page already shows. */}
        <BriefingTiles
          maturity={maturity}
          benchmark={benchmark}
          delta={briefing.periodDelta}
          deltaLabel={`vs ${briefing.periodTitle.toLowerCase()}`}
          movement={briefing.periodMovement}
          realScoredCount={briefing.realScoredCount}
          benchmarkOmitted={!!briefing.accountFiguresNotice}
          className="mt-6"
        />

        {/* Coverage + score basis (Direction 1 + 2). The board member holding this link is the reader
            LEAST able to notice that "62/100" was averaged over four of eleven repositories — and the
            one most likely to quote it — so the two denominators travel with the figures here exactly
            as they do in the PDF. */}
        <BriefingBasisNote briefing={briefing} className="mt-3" />

        {/* executive-briefing 07-16 #4: the audience the "value this period" line was built for
            (leadership/renewal) is exactly the audience holding this link — carry it here like the
            exec page, the LLM markdown and the PDF do, so the three surfaces tell one story. */}
        {/* UAT DANA-L1-010 — heading follows the sign; the number is never hidden (G1). */}
      {valueRealizedLine(briefing.valueRealized, briefing.realScoredCount, briefing.periodMovement?.cohortSize) && (
          <div className="mt-4 rounded-xl border border-accent/30 bg-accent/[0.06] px-4 py-3">
            <span className="type-mono-sm uppercase tracking-widest text-accent">{valueRealizedHeading(briefing.valueRealized)}</span>{" "}
            <span className="type-body text-slate-200">
              {valueRealizedLine(briefing.valueRealized, briefing.realScoredCount, briefing.periodMovement?.cohortSize)}
            </span>
          </div>
        )}

        {/* The rollout proof travels with the shared board link too — plain numbers, no links into
            the app (the banner component carries none), same line the exec tab and PDF render. */}
        <BriefingProofBanner proof={briefing.proof} loopProof={briefing.loopProof} className="mt-4" />

        {/* Engine-mix provenance — the shared board link must show the same mock-degraded caveat the
            owner's page + PDF do, so a leaked/forwarded read-only link can't hide that some scores were
            produced by the deterministic mock engine rather than the live model. */}
        {briefing.engineMix.length > 0 && (
          <p className="mt-4 type-mono-sm text-slate-500">
            Scored by {engineMixLabel(briefing.engineMix)}
            {engineMixCaveat(briefing.engineMix) && (
              <span className="text-warn"> · ⚠ {engineMixCaveat(briefing.engineMix)}</span>
            )}
          </p>
        )}

        {/* Direction 1 — the mock disclosure sits beside the engine-mix provenance, from the one
            composer, for the same reason the PDF carries both: they are different claims about
            different sets of scans (see mockDisclosure). */}
        {mockDisclosure(briefing) && <p className="mt-2 type-mono-sm text-warn">⚠ {mockDisclosure(briefing)}</p>}

        {/* G12: the same Trajectory card the Briefing tab mounts — headline, hedge, regression
            caveat. `periodHasStart` is the frozen window's start (or the live 90d start), so
            "this period" vs "since last scan" matches the token, not the viewer's clock. */}
        <ExecutiveTrajectoryCard briefing={briefing} periodHasStart={!!start} className="mt-6" />

        {priorPeriod && (
          <Card className="mt-6">
            <SectionHeader size="sm" title="vs previous period" />
            <PriorPeriodGrid
              prior={priorPeriod}
              now={maturity}
              nowScoredCount={briefing.realScoredCount}
              priorScoredCount={priorPeriod.realScoredCount}
            />
          </Card>
        )}

        {/* No `practiceOrgSlug` (static rows, no links into the app) and no `security` — this public
            view has never listed the security dimension and must not start now. */}
        <BriefingDimensionCards strengths={briefing.strengths} risks={briefing.risks} className="mt-6" />

        {/* Movement this period — the scale line + capped top movers the exec page and PDF carry.
            `reportLinks` is left off so rows render WITHOUT fullName and no report links leak out of the
            read-only surface (briefingShared's recorded intent: links stay inside the authenticated app). */}
        <BriefingMovementCard
          gainers={briefing.topGainers}
          regressions={briefing.topRegressions}
          movement={briefing.movement}
          liveScoredRepos={briefing.realScoredCount}
          className="mt-6"
        />

        {/* No goals and no notice: omit the section (goals are read-only; nothing to invite). */}
        {(briefing.goals.length > 0 || briefing.accountFiguresNotice) && (
          <BriefingGoalsCard goals={briefing.goals} emptyText={briefing.accountFiguresNotice} className="mt-6" />
        )}
      </main>
      <ShareFooter branding={branding} />
    </>
  );
}
