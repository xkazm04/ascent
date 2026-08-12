// The Perimeter (W3, real data) — the org's published AI stance as a BOUNDARY DRAWN AROUND THE
// FLEET, read spatially: a checkpoint at the edge (the declared tool/model allowlist vs what was
// observed crossing anyway), four bands descending T0→T3 fed by each repo's REAL autonomy tier
// (the shared passport-autonomy resolver), and the sealed no-AI zones at the centre. Every number
// is declared-vs-observed attribution stamped with the stance version it was evaluated against.

import { Kicker } from "@/components/ui";
import { SectionHeader, Tile, TILE_GRID } from "@/components/org/shared/ui";
import { scoreHex } from "@/lib/ui";
import type { AutonomyTierId } from "@/lib/types";
import { reposByTier, type StanceOverview } from "@/lib/org/stance-overview";
import { CheckpointStrip, PerimeterBand, SealedZones, UnassessedRepos } from "./perimeterParts";
import { StanceApplyControl } from "./StanceApplyControl";

const TIER_ORDER: AutonomyTierId[] = ["T0", "T1", "T2", "T3"];

export function StancePerimeter({ overview, canEdit }: { overview: StanceOverview; canEdit: boolean }) {
  const o = overview;
  const { byTier, unassessed } = reposByTier(o.repos);
  const reviewFor = new Map(o.stance.reviewTiers.map((t) => [t.tier, t.review]));

  return (
    <div className="space-y-6">
      <SectionHeader
        descriptionClassName="max-w-3xl"
        title="AI perimeter"
        description="One line around the fleet: what the stance permits to cross, how deep a change may go without extra review, and what stays sealed. Every scanned repo is placed in the band its REAL autonomy tier puts it in, and every readout compares the declaration with observed git attribution — declared, not enforced."
        right={
          <span className="font-mono text-xs uppercase tracking-[0.18em] text-slate-500">
            v{o.stanceVersion}
            {o.publishedAt ? ` · effective ${o.publishedAt}` : ""}
            {o.publishedBy ? ` · @${o.publishedBy}` : ""}
          </span>
        }
      />

      <div className={TILE_GRID}>
        <Tile label="Inside the line" value={String(o.repos.length)} sub="scanned repos read against the stance" />
        <Tile
          label="Elevated or restricted"
          value={String(o.elevatedCount)}
          color={o.elevatedCount ? "#f97316" : "#10b981"}
          sub="T2+ · real autonomy tier"
        />
        <Tile
          label="Findings"
          value={String(o.findingCount)}
          color={o.findingCount ? "#ef4444" : "#16a34a"}
          sub="observed attribution vs the declaration"
        />
        <Tile label="Acknowledged" value={`${o.ackRate}%`} color={scoreHex(o.ackRate)} sub={`repos on v${o.stanceVersion}`} />
      </div>

      {canEdit && <StanceApplyControl org={o.org} repos={o.repos.map((r) => r.fullName)} version={o.stanceVersion} />}

      <section>
        <Kicker>The checkpoint</Kicker>
        <p className="mb-3 mt-2 max-w-3xl text-base text-slate-300">
          Nothing reaches a band until it clears the edge. Left: what the stance declares permitted. Right: what PR
          attribution shows crossing without a declaration.
        </p>
        <CheckpointStrip stance={o.stance} undeclared={o.undeclaredTools} />
      </section>

      <section className="space-y-3">
        <Kicker>The bands · open to restricted</Kicker>
        {TIER_ORDER.map((tier, i) => (
          <PerimeterBand
            key={tier}
            tier={tier}
            review={reviewFor.get(tier) ?? null}
            repos={byTier[tier]}
            org={o.org}
            version={o.stanceVersion}
            canAck={canEdit}
            tierIndex={i}
          />
        ))}
        <UnassessedRepos repos={unassessed} org={o.org} version={o.stanceVersion} canAck={canEdit} />
      </section>

      <SealedZones zones={o.zones} />
    </div>
  );
}
