// The Care section of the Contributors tab (docs/REGISTRY-AND-CARE-IMPL.md §5.2).
//
// Contributors is the ORG's view of all developers; the Developer route is a developer's view of
// themself. The care loop's ORG half — how many people set the mentor up, what they kept, what they
// said wastes their time, how sessions look as bands — belongs on this side of that line, and it is
// here rather than on a tab of its own so nobody has to hold two "people" surfaces in their head.
//
// NOTHING PER-PERSON CROSSES. `CareOrgView` has no shape that could carry a login, and the aggregate
// suppresses entirely below `CHAMPION_MIN_POP` — the same floor the rest of this tab is built on.
// The only path from an individual's notebook to this section is that individual choosing `share`.

import { SectionHeader } from "@/components/org/shared/ui";
import { getCareOrgAggregate } from "@/lib/org/developer-view-load";
import {
  CareOrgAdoptionTiles,
  CareOrgAsks,
  CareOrgBands,
  CareOrgFloorNote,
  CareOrgKeptMoves,
  CareOrgOutcomes,
  CareOrgSuppressed,
} from "./CareOrgAggregate";

export async function ContributorsCareSection({ slug }: { slug: string }) {
  const org = await getCareOrgAggregate(slug).catch(() => null);
  if (!org) return null;

  return (
    <div className="mt-10 border-t border-slate-800 pt-8">
      <SectionHeader
        title="Care in this workspace"
        description="Counts of people who set the local mentor up and chose to share an aggregate — never who, and never a per-person row. Your own loop lives on the Developer page."
      />
      <div className="mt-2">
        <CareOrgFloorNote org={org} />
      </div>
      {org.belowFloor ? <CareOrgSuppressed org={org} /> : <CareOrgAdoptionTiles org={org} />}

      {org.belowFloor ? null : (
        <>
          <div className="mt-8">
            <SectionHeader
              size="sm"
              title="What people kept"
              description="The moves developers here tried and chose to keep. The ones that describe an artifact can be authored into the registry."
            />
            <CareOrgKeptMoves org={org} layout="cards" />
          </div>

          <div className="mt-8">
            <SectionHeader
              size="sm"
              title="What people said wastes their time"
              description="Interview themes, anonymized and counted — the registry's backlog, written by the people who feel it."
            />
            <CareOrgAsks org={org} />
          </div>

          <div className="mt-8">
            <SectionHeader
              size="sm"
              title="How sessions look here"
              description="Quartiles across everyone sharing. A developer comparing themselves sees these bands and no names."
            />
            <CareOrgBands org={org} />
          </div>

          <div className="mt-8">
            <SectionHeader
              size="sm"
              title="Did it move anything"
              description="Kept moves against the repository score deltas that followed."
            />
            <CareOrgOutcomes org={org} />
          </div>
        </>
      )}
    </div>
  );
}
