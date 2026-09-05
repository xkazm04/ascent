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
import { buildExecBriefing, briefingTrajectoryNote, engineMixCaveat, engineMixLabel, mockDisclosure, valueRealizedHeading, valueRealizedLine } from "@/lib/org/briefing";
import { briefingFigureDigest, shareIntegrity, verifyBriefingShareToken } from "@/lib/briefing-share";
import { Notice, ShareFooter, ShareHeader } from "./shareChrome";
import { resolveWindow } from "@/lib/window";
import { getCreditState, getOrgBranding, getOrgId, getTechGroupIdByKey, isDbConfigured, recordAudit } from "@/lib/db";
import { isBriefingShareRevoked } from "@/lib/db/org-share";
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
    const minterRole = await getMembershipRole(verified.org, verified.mintedBy).catch(() => null);
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
  if (verified.jti && (await isBriefingShareRevoked(verified.jti))) {
    return <Notice title="Link revoked" body="This shared briefing link has been revoked. Ask an org owner for a fresh one." />;
  }

  const period = resolveWindow({ range: verified.range, from: verified.from, to: verified.to });
  // Finding B (clock-drift): use the ABSOLUTE window the owner froze at mint time, not one recomputed
  // against this viewer's clock. `winEnd` is present on every frozen token (an open-ended end was pinned
  // to the mint instant), so its presence is the "frozen" signal; `winStart` absent = an all-time (null)
  // start. A legacy link carries neither → fall back to `period` (the pre-fix behavior that re-floats to
  // the viewer's clock — kept so already-minted live links keep working). `period.title` stays the label.
  const frozen = verified.winEnd != null;
  const start = frozen ? (verified.winStart ? new Date(verified.winStart) : null) : period.start;
  const end = frozen ? new Date(verified.winEnd!) : period.end;
  // executive-briefing 07-16 #5: Finding B froze the DATA at mint time but kept the floating
  // "last 90 days" label — so a viewer on day 6 of the TTL reads "last 90 days" over numbers that
  // provably aren't. Anchor the presentation with the absolute end of the frozen window; legacy
  // (unfrozen) tokens keep the plain title, which for them stays accurate.
  const asOf = frozen ? new Date(verified.winEnd!).toISOString().slice(0, 10) : null;
  // EXEC #1: re-run scoped to the segment the owner shared (carried in the signed token), so a reseller's
  // per-client read-only link shows that client's data — not the whole org. Feature 3b: the same for the
  // tech-stack scope (resolve the carried KEY → group id within the org).
  // FAIL CLOSED on an unresolvable stack scope: the resolver returns null both for "no scope requested"
  // and for "requested but renamed/deleted/DB hiccup" — and a null filter means the WHOLE org. A link
  // the owner deliberately narrowed must never widen to full-fleet numbers, so treat an unresolvable
  // key like an invalid token instead of proceeding unscoped.
  const stackKey = verified.stack ?? null;
  const techGroupId = await getTechGroupIdByKey(verified.org, stackKey).catch(() => null);
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
  const [briefing, rawBranding, credit] = await Promise.all([
    buildExecBriefing(verified.org, { start, end }, period.title, verified.segment ?? null, techGroupId).catch(() => null),
    getOrgBranding(verified.org).catch(() => null),
    getCreditState(verified.org).catch(() => null),
  ]);
  const branding = planAllowsWhiteLabel(credit?.plan) ? rawBranding : null;
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
    const orgId = await getOrgId(verified.org).catch(() => null);
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
        {/* #26: say plainly which of the two this is. A recipient must never be shown different numbers
            in silence — when the fingerprint the sender's link carries no longer matches what this
            period now produces, that is stated here, above the figures, not left to be discovered. */}
        {integrity === "changed" && (
          <div className="mb-4 rounded-lg border border-warn/40 bg-warn/[0.08] px-4 py-3 type-body-sm text-slate-200">
            <span className="font-mono uppercase tracking-widest text-warn">⚠ Figures moved</span> — the period below is the
            one that was shared and is frozen, but its numbers are no longer the ones the sender saw (a benchmark, goal,
            repository set or retained scan changed underneath it). These are current. Ask the sender for a fresh link before
            quoting a figure back to them.
          </div>
        )}
        <SectionHeader
          descriptionClassName="max-w-3xl"
          title={`${verified.org}: executive briefing`}
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
          realScoredCount={briefing.realScoredCount}
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
      {valueRealizedLine(briefing.valueRealized, briefing.realScoredCount) && (
          <div className="mt-4 rounded-xl border border-accent/30 bg-accent/[0.06] px-4 py-3">
            <span className="type-mono-sm uppercase tracking-widest text-accent">{valueRealizedHeading(briefing.valueRealized)}</span>{" "}
            <span className="type-body text-slate-200">{valueRealizedLine(briefing.valueRealized, briefing.realScoredCount)}</span>
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

        {/* G5-11: mirror the internal page's regression caveat here too. `regressionCount` is a plain
            number already returned on this page's own `briefing` object (no internal-only field, no
            link) — a board viewer reading a shared link is the LEAST equipped to know a caveat is
            missing, so gate the whole card on either signal, exactly like executive/page.tsx does. */}
        {(briefing.forecastHeadline || briefing.forecastInsufficiency || briefing.regressionCount > 0) && (
          <Card className="mt-6">
            <SectionHeader size="sm" title="Trajectory" />
            <p className="mt-2 type-body text-slate-300">
              {briefing.forecastHeadline ?? briefing.forecastInsufficiency ?? "Not enough history yet to project a trajectory."}
            </p>
            {/* MC-B1: the same composed line the owner's page, the board PDF and the markdown get. A
                board viewer reading a shared link is the least equipped to notice a missing caveat, so
                the hedge travels with the claim rather than being guarded on a nullable figure. */}
            {briefing.forecastHeadline && briefingTrajectoryNote(briefing) && (
              <p className="mt-1 type-mono-sm text-slate-500">{briefingTrajectoryNote(briefing)}</p>
            )}
            {briefing.regressionCount > 0 && (
              <p className="mt-1 type-mono-sm text-orange-300">
                ⚠ {briefing.regressionCount} repo{briefing.regressionCount > 1 ? "s" : ""} regressed{" "}
                {start ? "this period" : "since last scan"}.
              </p>
            )}
          </Card>
        )}

        {priorPeriod && (
          <Card className="mt-6">
            <SectionHeader size="sm" title="vs previous period" />
            <PriorPeriodGrid prior={priorPeriod} now={maturity} />
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
          className="mt-6"
        />

        <BriefingGoalsCard goals={briefing.goals} emptyText="No goals set for this org." className="mt-6" />
      </main>
      <ShareFooter branding={branding} />
    </>
  );
}
