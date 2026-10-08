// Altimeter composition. The markup that shipped, moved here unchanged so a Prism layout cannot
// shift it. Same PracticesPageData as PracticesPageV2.
import { Tile, TILE_GRID } from "@/components/org/shared/ui";
import { BAND } from "@/features/standing/adoption/AdoptionSpectrum";
import { ScopeFilterBar } from "@/components/org/shared/ScopeFilterBar";
import { CopyForLlm } from "@/components/CopyForLlm";
import { FoundationRolloutPanel } from "./foundation/FoundationRolloutPanel";
import { GuidanceCoherenceCard } from "./foundation/GuidanceCoherenceCard";
import { HousePattern } from "./HousePattern";
import { PracticeDriftStrip } from "./PracticeDriftStrip";
import { PracticesView } from "./PracticesView";
import { RegistryPractices } from "./RegistryPractices";
import { RegistrySyncStrip } from "@/features/shared/registry/RegistrySyncStrip";
import { NextMoveLink } from "@/components/org/shared/NextMoveLink";
import { orgTabHref } from "@/lib/org/orgTabs";
import type { PracticesPageData } from "./practicesData";

// Library adoption is a NEUTRAL accent reading, not the red→green maturity ramp: a young library with
// few adopted practices is an expected baseline, not a defect, so scoreHex would paint it alarm-red.
// Same rationale — and the same imported constant — as the Adoption tab's BAND.some.
const READING_HUE = BAND.some;

export function PracticesTabV1({ data }: { data: PracticesPageData }) {
  const { summary } = data;
  const roll = summary.rollout;
  return (
    <div className="space-y-6">
      <RegistrySyncStrip sync={data.sync} slug={data.slug} artifact="practices" />

      <div className="flex flex-wrap items-center justify-end gap-2">
        <ScopeFilterBar segments={[]} segmentId={null} techGroups={data.techGroups} activeStack={data.activeStack} />
        <CopyForLlm text={data.brief} label="Copy practice library brief for LLM" />
      </div>

      {/* W6 — above the generic catalog on purpose: an org's own shared structure is a better answer
          than a template, so it should be the first thing read on this tab. */}
      {data.mined && <HousePattern mined={data.mined} reposWithShape={data.reposWithShape} />}

      {/* The org's OWN agreed practices, straight out of the registry, above the generic catalog. */}
      <RegistryPractices org={data.slug} rows={data.shapeRows} registryBase={data.registryBase} repoOptions={data.repoOptions} />

      <div className={TILE_GRID}>
        <Tile
          label="Practices"
          value={summary.total}
          sub={`${summary.authored} authored · ${summary.mined} mined`}
        />
        <Tile
          label="Fleet adoption"
          value={summary.adoption ? `${summary.adoption.pct}%` : "—"}
          sub={summary.adoption ? `${summary.adoption.strong}/${summary.adoption.measured} repo·practice pairs` : "no scored repos yet"}
          color={summary.adoption ? READING_HUE : undefined}
        />
        <Tile
          label="Could adopt"
          value={summary.couldAdopt.repos}
          sub={`repos below the bar on ${summary.couldAdopt.practices} practice${summary.couldAdopt.practices === 1 ? "" : "s"}`}
        />
        {/* The starter-PR projection is OPTIONAL (attached only to practices actually applied here) —
            with none, this em-dashes rather than reporting a 0 that reads as "tried, nothing landed". */}
        <Tile
          label="PRs in flight"
          value={roll ? roll.open : "—"}
          sub={
            roll
              ? `${roll.merged} landed${roll.lift != null ? ` · +${roll.lift} avg lift` : ""}`
              : "no starter PRs opened yet"
          }
          color={roll && roll.open > 0 ? READING_HUE : undefined}
        />
      </div>

      {/* #33 — beneath the lift strip's tiles, not inside them: "what did this put in motion" and
          "is it still there" are different readings on different bases. Renders nothing on an empty
          ledger. */}
      {data.adoptionLedger && <PracticeDriftStrip slug={data.slug} summary={data.adoptionLedger} />}

      <PracticesView
        slug={data.slug}
        initialPlaybooks={data.playbooks}
        practices={data.practices}
        adoption={data.adoption}
        dimOptions={data.dimOptions}
        repoOptions={data.repoOptions}
        rolloutSlot={
          <>
            <FoundationRolloutPanel slug={data.slug} rows={data.foundationRows} />
            {data.coherence && <GuidanceCoherenceCard rows={data.coherence} />}
          </>
        }
      />

      <NextMoveLink href={orgTabHref(data.slug, "live")} to="live" />
    </div>
  );
}
