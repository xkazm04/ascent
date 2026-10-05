// Card-level briefing blocks shared by the AUTHENTICATED executive page (/org/[slug]/executive) and
// the session-less PUBLIC share page (/share/briefing/[token]). Companion to briefingShared.tsx, which
// owns the row primitives (DimRow / MoveRow / PriorPeriodGrid); this file owns the Card wrappers that
// had been copy-pasted between the two pages.
//
// THE PROP CONTRACT IS DELIBERATELY "PUBLIC BY DEFAULT". Every prop that surfaces something only the
// authenticated view ever showed — deep links into the app, the security dimension, the "Manage goals"
// action, report permalinks — is OPTIONAL and defaults to OFF. Rendering with no optional props gives
// exactly what the anonymous board link showed before this extraction; the exec page opts in. That way
// a future edit to a shared block can't silently widen what the token-authenticated page exposes.

import { Card, SectionHeader } from "@/components/org/shared/ui";
import { DimRow, practiceHref } from "./briefingShared";
import type { BriefingDim } from "@/lib/org/briefing";

// Split across two files to stay under the 200-LOC cap (docs/ORG-TABS-REFACTOR.md); re-exported here
// so this stays the ONE pinned import path for both the exec tab and the public
// /share/briefing/[token] page.
export { BriefingMovementCard, BriefingGoalsCard } from "./briefingCardsMovement";
// Same reason, same contract: the headline tiles moved to a sibling when the period delta gained its
// cohort caption, and this stays the ONE pinned import path for both pages.
export { BriefingTiles } from "./BriefingTilesBlock";

/** Compose an optional page-supplied spacing/layout class with the block's own base classes. */
const cx = (extra: string, base: string) => (extra ? `${extra} ${base}` : base);

/**
 * The side-by-side "Strengths" / "Weakest dimensions" pair.
 *
 * Two exec-only affordances, both off unless explicitly passed:
 *  • `practiceOrgSlug` — makes every row a link to the practice that lifts that dimension, and adds the
 *    "→ practices" hint that explains those links. The public page passes nothing and keeps static rows.
 *  • `security` — the D9 row the exec page surfaces under "Weakest" when the security dim isn't ALREADY
 *    listed (in either column). The public page never showed it, so omitting the prop omits the row.
 */
export function BriefingDimensionCards({
  strengths,
  risks,
  security = null,
  practiceOrgSlug = null,
  className = "",
}: {
  strengths: BriefingDim[];
  risks: BriefingDim[];
  /** Exec-only: the security dimension, appended to "Weakest" when not already shown. */
  security?: BriefingDim | null;
  /** Non-null ⇒ rows deep-link to that org's practice cards. Null (the default) ⇒ static, public-safe. */
  practiceOrgSlug?: string | null;
  className?: string;
}) {
  const hrefFor = (dimId: string) => (practiceOrgSlug ? practiceHref(practiceOrgSlug, dimId) : undefined);
  return (
    <div className={cx(className, "grid gap-6 lg:grid-cols-2")}>
      <Card>
        <SectionHeader size="sm" title="Strengths" />
        <div className="mt-3 space-y-1.5">
          {strengths.map((d) => (
            <DimRow key={d.dimId} dimId={d.dimId} label={d.label} avg={d.avg} href={hrefFor(d.dimId)} />
          ))}
        </div>
      </Card>
      <Card>
        <SectionHeader
          size="sm"
          title="Weakest dimensions"
          right={practiceOrgSlug ? <span className="type-mono-sm text-slate-500">→ practices</span> : undefined}
        />
        <div className="mt-3 space-y-1.5">
          {risks.map((d) => (
            <DimRow key={d.dimId} dimId={d.dimId} label={d.label} avg={d.avg} href={hrefFor(d.dimId)} />
          ))}
          {/* Surface the security dim here only when it isn't ALREADY shown — neither in the risk list
              nor (executive-briefing #4) in Strengths — so a security dim that ranks as a top strength
              isn't simultaneously rendered under "Weakest dimensions". */}
          {security &&
            risks.every((r) => r.dimId !== security.dimId) &&
            strengths.every((s) => s.dimId !== security.dimId) && (
              <DimRow
                dimId={security.dimId}
                label={`${security.label} (security)`}
                avg={security.avg}
                href={hrefFor(security.dimId)}
              />
            )}
        </div>
      </Card>
    </div>
  );
}

type BriefingBrand = { brandName: string | null; brandColor: string | null; logoUrl: string | null };

/** True when at least one stored brand slot is set (the in-app header hides otherwise). */
export function hasBriefingBrand(b: BriefingBrand | null | undefined): b is BriefingBrand {
  return Boolean(b && (b.brandName || b.brandColor || b.logoUrl));
}

/**
 * Compact in-app brand strip for the authenticated briefing. Same three slots as `BriefingDocument`
 * (PDF) and share-page `BrandMark`: logo, brand name, accent kicker. Exec-only — the share page
 * keeps `BrandMark`. Renders only the fields that are set.
 */
export function BriefingBrandHeader({ branding }: { branding: BriefingBrand }) {
  const { brandName, brandColor, logoUrl } = branding;
  return (
    <div className="flex flex-wrap items-center gap-2.5">
      {logoUrl && (
        // eslint-disable-next-line @next/next/no-img-element -- owner-supplied remote logo; next/image needs domain allowlisting
        <img src={logoUrl} alt="" className="h-6 w-6 object-contain" />
      )}
      {brandName && (
        <span className="font-mono type-body font-semibold uppercase tracking-[0.22em] text-white">{brandName}</span>
      )}
      {brandColor && (
        <span className="type-label tracking-widest" style={{ color: brandColor }}>
          Executive briefing
        </span>
      )}
    </div>
  );
}

