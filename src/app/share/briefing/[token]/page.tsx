// /share/briefing/[token] — a read-only executive briefing authorized by a signed expiring token
// (EXEC-6) instead of a session, so an owner can share it with a board member who has no account.
// Outside the /org layout (no session gate); the token is the capability and carries the window.
// Exposes only what the Briefing tab shows. noindex so a leaked link isn't crawled.

import { Logo } from "@/components/Brand";
import { Card, SectionHeader } from "@/components/org/shared/ui";
import { PriorPeriodGrid } from "@/components/org/executive/briefingShared";
import {
  BriefingDimensionCards,
  BriefingGoalsCard,
  BriefingMovementCard,
  BriefingTiles,
} from "@/components/org/executive/briefingCards";
import { TokenNotice } from "@/components/TokenNotice";
import { buildExecBriefing, engineMixCaveat, engineMixLabel, forecastConfidenceNote, valueRealizedLine } from "@/lib/org/briefing";
import { verifyBriefingShareToken } from "@/lib/briefing-share";
import { resolveWindow } from "@/lib/window";
import { getCreditState, getOrgBranding, getTechGroupIdByKey, isDbConfigured } from "@/lib/db";
import type { OrgBranding } from "@/lib/db/branding";
import { getMembershipRole, roleAtLeast } from "@/lib/db/members";
import { planAllowsWhiteLabel } from "@/lib/plans";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

// EXEC-5 white-label boundary: this anonymous share page is a CLIENT-FACING deliverable (the link a
// reseller hands a board member), so a Team+ org's brand name + logo replace the Ascent mark here,
// exactly like the briefing PDF. The brand ACCENT is deliberately not applied on this dark surface —
// it is validated for readability against the white PDF only, so an arbitrary accent could be
// unreadable here. Falls back to the Ascent mark when the org has no branding / no entitled plan
// (and on the token-invalid notices, where the org isn't trusted yet).
function BrandMark({ branding, className = "" }: { branding?: OrgBranding | null; className?: string }) {
  if (!branding?.brandName && !branding?.logoUrl) return <Logo className={className} />;
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      {branding.logoUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- owner-supplied remote logo; next/image needs domain allowlisting
        <img src={branding.logoUrl} alt="" className="h-6 w-6 object-contain" />
      )}
      {branding.brandName && (
        <span className="font-mono text-base font-semibold uppercase tracking-[0.22em] text-white">{branding.brandName}</span>
      )}
    </span>
  );
}

// A minimal branded frame for the anonymous share view. The full marketing SiteHeader/SiteFooter
// (Pricing / About / Sign-in, the org switcher, footer funnel links) is wrong here: the viewer is a
// board member holding a capability token, with no account and nowhere to sign in — so we show only
// the brand mark and a "shared briefing" label, no navigation into the funnel.
function ShareHeader({ branding }: { branding?: OrgBranding | null }) {
  return (
    <header className="border-b border-divider/70 bg-ink/80 backdrop-blur">
      <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-3.5">
        <BrandMark branding={branding} />
        <span className="font-mono text-xs uppercase tracking-widest text-slate-500">Shared briefing</span>
      </div>
    </header>
  );
}

function ShareFooter({ branding }: { branding?: OrgBranding | null }) {
  const branded = Boolean(branding?.brandName || branding?.logoUrl);
  return (
    <footer className="mt-auto border-t border-divider/70 py-6 text-center">
      <BrandMark branding={branding} className="justify-center opacity-70" />
      {/* The Ascent tagline is part of the identity being white-labelled — drop it when branded. */}
      {!branded && (
        <p className="mt-2 font-mono text-xs uppercase tracking-widest text-slate-500">
          The maturity index for AI-native engineering
        </p>
      )}
    </footer>
  );
}

// The shared TokenNotice panel between this page's own branded frame. Unbranded on purpose: these
// notices fire before the org is trusted (bad/revoked token), so they must never carry its mark.
function Notice({ title, body }: { title: string; body: string }) {
  return (
    <>
      <ShareHeader />
      <TokenNotice title={title} body={body} minHeightClass="min-h-[60vh]" />
      <ShareFooter />
    </>
  );
}

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

  return (
    <>
      <ShareHeader branding={branding} />
      <main id="main" className="mx-auto w-full max-w-5xl px-5 py-10">
        <div className="mb-4 rounded-lg border border-slate-800 bg-slate-900/40 px-4 py-2 font-mono text-sm text-slate-500">
          Read-only shared briefing · {briefing.periodTitle}
          {asOf && <> · data as of {asOf}</>}
        </div>
        <SectionHeader
          descriptionClassName="max-w-3xl"
          title={`${verified.org} — executive briefing`}
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
          className="mt-6"
        />

        {/* executive-briefing 07-16 #4: the audience the "value this period" line was built for
            (leadership/renewal) is exactly the audience holding this link — carry it here like the
            exec page, the LLM markdown and the PDF do, so the three surfaces tell one story. */}
        {valueRealizedLine(briefing.valueRealized) && (
          <div className="mt-4 rounded-xl border border-accent/30 bg-accent/[0.06] px-4 py-3">
            <span className="font-mono text-sm uppercase tracking-widest text-accent">Value this period</span>{" "}
            <span className="text-base text-slate-200">{valueRealizedLine(briefing.valueRealized)}</span>
          </div>
        )}

        {/* Engine-mix provenance — the shared board link must show the same mock-degraded caveat the
            owner's page + PDF do, so a leaked/forwarded read-only link can't hide that some scores were
            produced by the deterministic mock engine rather than the live model. */}
        {briefing.engineMix.length > 0 && (
          <p className="mt-4 font-mono text-sm text-slate-500">
            Scored by {engineMixLabel(briefing.engineMix)}
            {engineMixCaveat(briefing.engineMix) && (
              <span className="text-warn"> · ⚠ {engineMixCaveat(briefing.engineMix)}</span>
            )}
          </p>
        )}

        {/* G5-11: mirror the internal page's regression caveat here too. `regressionCount` is a plain
            number already returned on this page's own `briefing` object (no internal-only field, no
            link) — a board viewer reading a shared link is the LEAST equipped to know a caveat is
            missing, so gate the whole card on either signal, exactly like executive/page.tsx does. */}
        {(briefing.forecastHeadline || briefing.regressionCount > 0) && (
          <Card className="mt-6">
            <SectionHeader size="sm" title="Trajectory" />
            <p className="mt-2 text-base text-slate-300">
              {briefing.forecastHeadline ?? "Not enough history yet to project a trajectory."}
            </p>
            {/* Carry the same trend-confidence hedge the owner's page + PDF show, so a shared board link
                can't present a noisy, low-R² projection as a firm commitment. */}
            {briefing.forecastHeadline && forecastConfidenceNote(briefing.forecastConfidence) && (
              <p className="mt-1 font-mono text-sm text-slate-500">{forecastConfidenceNote(briefing.forecastConfidence)}</p>
            )}
            {briefing.regressionCount > 0 && (
              <p className="mt-1 font-mono text-sm text-orange-300">
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
