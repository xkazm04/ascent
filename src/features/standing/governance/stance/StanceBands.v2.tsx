// The four autonomy bands as one ladder. Status is the step's glyph, word, and lightness.
// Repos with no passport stay out of every band.
import { Caption, Eyebrow, HairlineList, Ladder, VoidMark } from "@/components/kit";
import { reposByTier, type StanceOverview } from "@/lib/org/stance-overview";
import { TIER_META } from "./stanceShared";
import { TIER_ORDER } from "./perimeterLadder";
import { stanceBandSteps } from "./stanceBandLadder";
import { StanceRepoV2 } from "./StanceRepo.v2";

export function StanceBandsV2({ overview, canEdit }: { overview: StanceOverview; canEdit: boolean }) {
  const { byTier, unassessed } = reposByTier(overview.repos);
  const reviewFor = new Map(overview.stance.reviewTiers.map((t) => [t.tier, t.review]));
  const steps = stanceBandSteps(
    TIER_ORDER.map((tier) => ({
      tier,
      declared: reviewFor.get(tier) != null,
      repos: byTier[tier].length,
    })),
  );
  return (
    <div className="mt-8">
      <Ladder label="Autonomy tiers" steps={steps} />
      <div className="mt-8 space-y-8">
        {TIER_ORDER.map((tier) => {
          const repos = byTier[tier];
          const review = reviewFor.get(tier) ?? null;
          const meta = TIER_META[tier];
          const findings = repos.reduce((a, r) => a + r.findings.filter((f) => !f.advisory).length, 0);
          return (
            <section key={tier} aria-label={`${tier} ${meta.name}`}>
              <Eyebrow>{`${tier}, ${meta.name}`}</Eyebrow>
              <p className="mt-2 max-w-[40rem] type-body text-slate-200">
                {review ?? <span className="text-slate-400">No review requirement declared for this tier.</span>}
              </p>
              <Caption className="mt-2">
                {repos.length} repo{repos.length === 1 ? "" : "s"}
                {findings ? `, ${findings} finding${findings === 1 ? "" : "s"}` : ""}
              </Caption>
              {repos.length === 0 ? (
                <p className="mt-3 type-body-sm text-slate-400">No repo currently sits in this band.</p>
              ) : (
                <HairlineList className="mt-3">
                  {repos.map((r) => (
                    <StanceRepoV2 key={r.fullName} repo={r} org={overview.org} version={overview.stanceVersion} canAck={canEdit} />
                  ))}
                </HairlineList>
              )}
            </section>
          );
        })}
      </div>
      {unassessed.length > 0 && (
        <section aria-label="Tier not assessed" className="mt-8">
          <div className="flex items-center gap-2">
            <VoidMark subject="Autonomy tier" label="Tier not assessed" />
            <Eyebrow>Tier not assessed</Eyebrow>
          </div>
          <Caption className="mt-2">
            These repos have no readiness passport on their latest scan, so no autonomy band can honestly be assigned.
            Re-scan to place them.
          </Caption>
          <HairlineList className="mt-3">
            {unassessed.map((r) => (
              <StanceRepoV2 key={r.fullName} repo={r} org={overview.org} version={overview.stanceVersion} canAck={canEdit} />
            ))}
          </HairlineList>
        </section>
      )}
    </div>
  );
}
