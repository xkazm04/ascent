// /share/briefing/[token] — a read-only executive briefing authorized by a signed expiring token
// (EXEC-6) instead of a session, so an owner can share it with a board member who has no account.
// Outside the /org layout (no session gate); the token is the capability and carries the window.
// Exposes only what the Briefing tab shows. noindex so a leaked link isn't crawled.

import { Logo } from "@/components/Brand";
import { Card, InlineEmpty, Meter, SectionHeader, Tile, TILE_GRID } from "@/components/org/shared/ui";
import { DimRow, PriorPeriodGrid } from "@/components/org/executive/briefingShared";
import { buildExecBriefing, engineMixCaveat, engineMixLabel, forecastConfidenceNote } from "@/lib/org/briefing";
import { verifyBriefingShareToken } from "@/lib/briefing-share";
import { resolveWindow } from "@/lib/window";
import { getCreditState, getOrgBranding, getTechGroupIdByKey, isDbConfigured } from "@/lib/db";
import type { OrgBranding } from "@/lib/db/branding";
import { getMembershipRole, roleAtLeast } from "@/lib/db/members";
import { planAllowsWhiteLabel } from "@/lib/plans";
import { scoreHex } from "@/lib/ui";

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

function Notice({ title, body }: { title: string; body: string }) {
  return (
    <>
      <ShareHeader />
      <main id="main" className="mx-auto flex min-h-[60vh] max-w-lg flex-col items-center justify-center px-5 text-center">
        <h1 className="text-xl font-bold text-white">{title}</h1>
        <p className="mt-2 text-base text-slate-400">{body}</p>
      </main>
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
        </div>
        <SectionHeader
          descriptionClassName="max-w-3xl"
          title={`${verified.org} — executive briefing`}
          description={`AI-native engineering maturity standing over ${briefing.periodTitle.toLowerCase()}.`}
        />

        <div className={`mt-6 ${TILE_GRID}`}>
          <Tile label="Org maturity" value={maturity.overall} sub={`${maturity.levelId} · ${maturity.levelName}`} color={scoreHex(maturity.overall)} delta={briefing.periodDelta ?? undefined} />
          <Tile label="AI Adoption" value={maturity.adoption} color={scoreHex(maturity.adoption)} />
          <Tile label="Engineering Rigor" value={maturity.rigor} color={scoreHex(maturity.rigor)} />
          <Tile label="Corpus percentile" value={benchmark?.percentile != null ? `${benchmark.percentile}` : "—"} sub={benchmark && benchmark.corpusRepos > 0 ? `vs ${benchmark.corpusRepos} repos` : "no corpus yet"} color={benchmark?.percentile != null ? scoreHex(benchmark.percentile) : undefined} />
        </div>

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

        {briefing.forecastHeadline && (
          <Card className="mt-6">
            <SectionHeader size="sm" title="Trajectory" />
            <p className="mt-2 text-base text-slate-300">{briefing.forecastHeadline}</p>
            {/* Carry the same trend-confidence hedge the owner's page + PDF show, so a shared board link
                can't present a noisy, low-R² projection as a firm commitment. */}
            {forecastConfidenceNote(briefing.forecastConfidence) && (
              <p className="mt-1 font-mono text-sm text-slate-500">{forecastConfidenceNote(briefing.forecastConfidence)}</p>
            )}
          </Card>
        )}

        {priorPeriod && (
          <Card className="mt-6">
            <SectionHeader size="sm" title="vs previous period" />
            <PriorPeriodGrid prior={priorPeriod} now={maturity} />
          </Card>
        )}

        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <Card>
            <SectionHeader size="sm" title="Strengths" />
            <div className="mt-3 space-y-1.5">
              {briefing.strengths.map((d) => (
                <DimRow key={d.dimId} dimId={d.dimId} label={d.label} avg={d.avg} />
              ))}
            </div>
          </Card>
          <Card>
            <SectionHeader size="sm" title="Weakest dimensions" />
            <div className="mt-3 space-y-1.5">
              {briefing.risks.map((d) => (
                <DimRow key={d.dimId} dimId={d.dimId} label={d.label} avg={d.avg} />
              ))}
            </div>
          </Card>
        </div>

        <Card className="mt-6">
          <SectionHeader size="sm" title="Goals" />
          {briefing.goals.length === 0 ? (
            <InlineEmpty>No goals set for this org.</InlineEmpty>
          ) : (
            <div className="mt-3 space-y-2.5">
              {briefing.goals.map((g) => (
                <div key={g.label} className="flex items-center gap-3 text-base">
                  <span className="min-w-0 flex-1 truncate text-slate-300">{g.label}</span>
                  <Meter className="w-32 shrink-0" value={g.pct} color={scoreHex(g.pct)} />
                  <span className="w-28 shrink-0 text-right font-mono text-sm text-slate-400">{g.current}/{g.target}{g.etaDays != null ? ` · ~${g.etaDays}d` : ""}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </main>
      <ShareFooter branding={branding} />
    </>
  );
}
