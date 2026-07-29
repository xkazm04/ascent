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

import { Card, SectionHeader, Tile, TILE_GRID } from "@/components/org/shared/ui";
import { DimRow, practiceHref } from "./briefingShared";
import { scoreHex } from "@/lib/ui";
import type { BriefingDim, ExecBriefing } from "@/lib/org/briefing";

// Split across two files to stay under the 200-LOC cap (docs/ORG-TABS-REFACTOR.md); re-exported here
// so this stays the ONE pinned import path for both the exec tab and the public
// /share/briefing/[token] page.
export { BriefingMovementCard, BriefingGoalsCard } from "./briefingCardsMovement";

/** Compose an optional page-supplied spacing/layout class with the block's own base classes. */
const cx = (extra: string, base: string) => (extra ? `${extra} ${base}` : base);

/**
 * The four headline tiles (maturity, adoption, rigor, corpus percentile).
 *
 * `orgSlug` is the link switch: pass it and each tile becomes a deep link to the tab that explains it
 * (the exec page's behavior); leave it null and the tiles are static cells — the public share page must
 * not lead a board member into the authenticated app. `deltaLabel` is likewise exec-only (the share
 * page renders the delta badge with no "vs …" suffix, matching its frozen-window framing).
 */
export function BriefingTiles({
  maturity,
  benchmark,
  delta,
  deltaLabel,
  orgSlug = null,
  className = "",
}: {
  maturity: ExecBriefing["maturity"];
  benchmark: ExecBriefing["benchmark"];
  delta?: number | null;
  /** Exec-only suffix next to the delta badge, e.g. "vs 90d ago". */
  deltaLabel?: string;
  /** Non-null ⇒ tiles deep-link into the org dashboard. Null (the default) ⇒ static, public-safe. */
  orgSlug?: string | null;
  className?: string;
}) {
  return (
    <div className={cx(className, TILE_GRID)}>
      <Tile
        label="Org maturity"
        value={maturity.overall}
        sub={`${maturity.levelId} · ${maturity.levelName}`}
        color={scoreHex(maturity.overall)}
        delta={delta ?? undefined}
        deltaLabel={deltaLabel}
        href={orgSlug ? `/org/${orgSlug}` : undefined}
      />
      <Tile
        label="AI Adoption"
        value={maturity.adoption}
        color={scoreHex(maturity.adoption)}
        href={orgSlug ? `/org/${orgSlug}/adoption` : undefined}
      />
      <Tile
        label="Engineering Rigor"
        value={maturity.rigor}
        color={scoreHex(maturity.rigor)}
        href={orgSlug ? `/org/${orgSlug}/delivery` : undefined}
      />
      <Tile
        label="Corpus percentile"
        value={benchmark?.percentile != null ? `${benchmark.percentile}` : "—"}
        sub={benchmark && benchmark.corpusRepos > 0 ? `vs ${benchmark.corpusRepos} repos` : "no corpus yet"}
        color={benchmark?.percentile != null ? scoreHex(benchmark.percentile) : undefined}
        href={orgSlug ? "/leaderboard" : undefined}
      />
    </div>
  );
}

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
          right={practiceOrgSlug ? <span className="font-mono text-sm text-slate-500">→ practices</span> : undefined}
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

