// The Perimeter (W3, real data) — the org's published AI stance as a BOUNDARY DRAWN AROUND THE
// FLEET, read spatially: a checkpoint at the edge (the declared tool/model allowlist vs what was
// observed crossing anyway), four bands descending T0→T3 fed by each repo's REAL autonomy tier
// (the shared passport-autonomy resolver), and the sealed no-AI zones at the centre. Every number
// is declared-vs-observed attribution stamped with the stance version it was evaluated against.
//
// Org UX redesign §2: the panel now OPENS on that boundary as a `BandLadder` — nested bands, a
// dashed outline where the stance is declared but nothing has been read against it, and an arrow at
// the outer edge for what crossed with no declaration behind it. The 304-character paragraph that
// used to describe this picture is deleted; its two load-bearing clauses are the dashed stroke and
// the legend hint the kit generates from `STATE_HINT.declared`.

import { SectionHeader, Tile, TILE_GRID } from "@/components/org/shared/ui";
import { BandLadder, Legend } from "@/components/org/viz";
import { Kicker } from "@/components/ui";
import { scoreHex } from "@/lib/ui";
import { reposByTier, type StanceOverview } from "@/lib/org/stance-overview";
import { unenforceableClauses } from "@/lib/org/admission";
import { CheckpointStrip, PerimeterBand, SealedZones, UnassessedRepos } from "./perimeterParts";
import { TIER_ORDER, perimeterBands, perimeterEdge, perimeterStates } from "./perimeterLadder";
import { UnenforceableClauses } from "./UnenforceableClauses";
import { StanceApplyControl } from "./StanceApplyControl";
import { AdmissionColumn } from "./admission/AdmissionColumn";

export function StancePerimeter({ overview, canEdit }: { overview: StanceOverview; canEdit: boolean }) {
  const o = overview;
  const { byTier, unassessed } = reposByTier(o.repos);
  const reviewFor = new Map(o.stance.reviewTiers.map((t) => [t.tier, t.review]));
  const bands = perimeterBands(byTier, reviewFor);
  const edge = perimeterEdge(o.undeclaredTools);

  return (
    <div className="space-y-6">
      <SectionHeader
        title="AI perimeter"
        description={`${o.repos.length} scanned repos · 4 autonomy bands`}
        right={
          <span className="font-mono type-micro uppercase tracking-[0.18em] text-slate-500">
            v{o.stanceVersion}
            {o.publishedAt ? ` · effective ${o.publishedAt}` : ""}
            {o.publishedBy ? ` · @${o.publishedBy}` : ""}
          </span>
        }
      />

      {/* §2.2 — the topmost element under the header is the boundary itself. */}
      <div className="max-w-md">
        <BandLadder bands={bands} edge={edge} title="AI perimeter" />
        <Legend className="mt-3" states={perimeterStates(bands, edge)} />
      </div>

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

      <section className="space-y-3">
        {/* The lede that sat here ("Nothing reaches a band until it clears the edge…") is the arrow
            on the ladder above: it named the picture instead of drawing it. */}
        <Kicker>The checkpoint</Kicker>
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

      {/* moonshot #8 — the decision layer, directly under the bands that show the measurement it
          departs from. Its own client island: it owns its read so it can refresh after its own write. */}
      <AdmissionColumn org={o.org} canEdit={canEdit} />

      <SealedZones zones={o.zones} />

      {/* The honest half, from the SAME builder `compileStance` uses for the MCP tools — the agent
          was told which clauses only it can honour; the owner publishing them was not. Facts are null
          because this is the org-wide reading: no repository has been compiled at this altitude. */}
      <UnenforceableClauses clauses={unenforceableClauses(o.stance, null)} />
    </div>
  );
}
