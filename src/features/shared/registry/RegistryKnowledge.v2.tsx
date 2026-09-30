import { Frame, HairlineList, ListRow, SectionHead } from "@/components/kit";
import { orgTabHref } from "@/lib/org/orgTabs";
import type { RegistryView } from "@/lib/org/registry-view";

export function RegistryKnowledgeV2({ view, slug }: { view: RegistryView; slug: string }) {
  const c = view.conformance;
  const judged = c ? c.repos.reduce((n, r) => n + r.judged, 0) : 0;
  const pairs = c ? c.repos.reduce((n, r) => n + r.pairs, 0) : 0;
  const line = !c
    ? "No conformance sweep has run yet. Nothing is known about how the fleet tracks against the corpus, which is not the same as a fleet that conforms."
    : `${judged.toLocaleString()} of ${pairs.toLocaleString()} pairs judged across ${c.repos.length} mapped repo${c.repos.length === 1 ? "" : "s"}${
        c.reposWithoutMap ? ` · ${c.reposWithoutMap} with no map` : ""
      }${c.subjects ? ` · ${c.subjects} subjects mirrored` : ""}.`;
  return (
    <Frame>
      <SectionHead eyebrow="Conformance" title="Subject by repo," named="one home." />
      <HairlineList className="mt-4 list-none">
        <ListRow href={orgTabHref(slug, "knowledge")} title="Open the Knowledge base" detail={line} />
      </HairlineList>
    </Frame>
  );
}
