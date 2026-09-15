// The Care section of the Contributors tab (docs/REGISTRY-AND-CARE-IMPL.md §5.2).
//
// Contributors is the ORG's view of all developers; the Developer route is a developer's view of
// themself. The care loop's ORG half — how many people set the mentor up, what they kept, what they
// said wastes their time, how sessions look as bands — belongs on this side of that line, and it is
// here rather than on a tab of its own so nobody has to hold two "people" surfaces in their head.
//
// NOTHING PER-PERSON CROSSES. `CareOrgView` has no shape that could carry a login, and the aggregate
// suppresses entirely below `CHAMPION_MIN_POP`. The only path from an individual's notebook to this
// section is that individual choosing `share`. That guarantee is now the section's first sight — the
// privacy ledger's right-hand column of voids — instead of the four header paragraphs that used to
// carry it, and the pointer to the developer's own loop is an affordance rather than a sentence.

import { SectionHeader } from "@/components/org/shared/ui";
import { getCareOrgAggregate } from "@/lib/org/developer-view-load";
import { orgTabHref } from "@/lib/org/orgTabs";
import {
  CareOrgAdoptionTiles,
  CareOrgAsks,
  CareOrgKeptMoves,
  CareOrgOutcomes,
  CareOrgSuppressed,
} from "./CareOrgAggregate";
import { CareOrgBands } from "./CareOrgBandStrips";
import { CarePrivacyLedger } from "./CarePrivacyLedger";

export async function ContributorsCareSection({ slug }: { slug: string }) {
  const org = await getCareOrgAggregate(slug).catch(() => null);
  if (!org) return null;

  return (
    <div className="mt-10 border-t border-slate-800 pt-8">
      <SectionHeader
        title="Care in this workspace"
        right={
          <a
            href={orgTabHref(slug, "developer")}
            className="focus-ring rounded-md px-2 py-1 type-mono-sm uppercase tracking-widest text-accent transition-colors hover:bg-accent/10"
          >
            Your own loop →
          </a>
        }
      />
      <CarePrivacyLedger org={org} />
      {org.belowFloor ? <CareOrgSuppressed org={org} /> : <CareOrgAdoptionTiles org={org} />}

      {org.belowFloor ? null : (
        <>
          <div className="mt-8">
            <SectionHeader size="sm" title="What people kept" />
            <CareOrgKeptMoves org={org} layout="cards" />
          </div>

          <div className="mt-8">
            <SectionHeader size="sm" title="What people said wastes their time" />
            <CareOrgAsks org={org} />
          </div>

          <div className="mt-8">
            <SectionHeader size="sm" title="How sessions look here" />
            <CareOrgBands org={org} />
          </div>

          <div className="mt-8">
            <SectionHeader size="sm" title="Did it move anything" description="avg repo score delta after a kept move" />
            <CareOrgOutcomes org={org} />
          </div>
        </>
      )}
    </div>
  );
}
