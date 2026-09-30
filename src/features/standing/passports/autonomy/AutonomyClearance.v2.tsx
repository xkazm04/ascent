"use client";

// Prism clearance register. Tiers are a Ladder: glyph, word, lightness. No score hue.
// Tier tiles are a stat strip. Each repo is a RepoRow, and its rail is the same Ladder.
import { Caption, Frame, GhostAction, HairlineList, Ladder, Lede, SectionHead, StatStrip, StatTile } from "@/components/kit";
import { TIERS, TIER_META, type RepoAutonomy } from "./autonomyModel";
import { clearanceLadderSteps } from "./clearanceSteps";
import { ClearanceEntryV2 } from "./ClearanceEntry.v2";
import { PromotionPlanV2 } from "./PromotionPlan.v2";
import { useClearanceRegister } from "./useClearanceRegister";

export function AutonomyClearanceV2({ repos }: { repos: RepoAutonomy[] }) {
  const { filter, setFilter, condition, setCondition, counts, plan, visible, bands, edge, sorted } = useClearanceRegister(repos);

  if (repos.length === 0) {
    return (
      <Frame>
        <Lede>
          No passports yet for this view, so no clearances can be issued. Scan this org&apos;s repositories and each scan
          registers its repo here.
        </Lede>
      </Frame>
    );
  }

  const scope =
    condition !== null
      ? `${visible.length} carry "${condition.label}" toward ${TIER_META[condition.to].code}`
      : filter === null
        ? `${repos.length} repo${repos.length === 1 ? "" : "s"} on the register`
        : `${visible.length} at ${TIER_META[filter].code} · ${TIER_META[filter].label}`;

  return (
    <div className="space-y-10">
      <Frame aria-label="Clearances held across the fleet">
        <SectionHead
          eyebrow="Autonomy clearance"
          title="Clearance"
          named="register."
          lede="Left to right: observe-only through scheduled autonomy."
        />
        <div className="mt-6">
          <Ladder label="Clearances held across the fleet" steps={clearanceLadderSteps(bands, edge)} />
        </div>
      </Frame>

      <StatStrip cols={4}>
        {TIERS.map((t) => {
          const meta = TIER_META[t];
          const active = filter === t;
          return (
            <button key={t} type="button" onClick={() => setFilter(active ? null : t)} aria-pressed={active} className="focus-ring block text-left">
              <StatTile label={`${meta.code} · ${meta.label}`} value={counts[t]} sub={meta.grant} />
            </button>
          );
        })}
      </StatStrip>

      <PromotionPlanV2 plan={plan} selected={condition} onSelect={setCondition} />

      <Frame edge="both" aria-label="Clearance register">
        <SectionHead
          eyebrow="Register"
          title="Repos at"
          named="this clearance."
          actions={
            <>
              {condition !== null && (
                <GhostAction onClick={() => setCondition(null)} aria-label={`Clear the condition filter: ${condition.label}`}>
                  ✕ {condition.label}
                </GhostAction>
              )}
              {filter !== null && <GhostAction onClick={() => setFilter(null)}>✕ show all clearances</GhostAction>}
            </>
          }
        />
        <Caption className="mt-3">{scope}</Caption>
        <div className="mt-4">
          {sorted.length === 0 ? (
            <Lede>
              {condition !== null
                ? "No repo at that clearance carries this condition in this scope."
                : "No repo currently holds that clearance in this scope."}
            </Lede>
          ) : (
            <HairlineList>
              {sorted.map((r) => (
                <ClearanceEntryV2 key={r.fullName} repo={r} />
              ))}
            </HairlineList>
          )}
        </div>
      </Frame>
    </div>
  );
}
