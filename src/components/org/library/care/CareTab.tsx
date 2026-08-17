// Org dashboard "Care" tab — UC3 "individual care" (docs/REGISTRY-AND-CARE-IMPL.md §5).
//
// SERVER component, filename PINNED as CareTab.tsx, `slug` + `sp` as props (it is not a route and
// cannot await route params itself) — the same shell contract as SkillsTab / MemoryTab.
//
// ONE tab id, TWO modes. The mode is decided HERE (inside the tab, by `Organization.kind`) rather than
// in the shell, so `OrgTabChunks` stays ignorant of workspace kind exactly as it is for every other
// panel. The variants below are the prototype round: three directions behind a client switcher.
//
// `?demo=` selects a fixture view model while the direction is being chosen; without it the loader
// returns the honest empty state (nothing shared yet / below the population floor).

import { Suspense } from "react";
import { OrgTabGap } from "@/components/org/shell/OrgTabGap";
import { CarePanelSwitcher } from "./CarePanelSwitcher";
import { getCareView } from "@/lib/org/care-view-load";

type SearchParams = { [key: string]: string | string[] | undefined };

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

async function CareData({ slug, demo }: { slug: string; demo?: string }) {
  const view = await getCareView(slug, { demo });
  return <CarePanelSwitcher view={view} slug={slug} />;
}

export async function CareTab({ slug, sp }: { slug: string; sp: SearchParams }) {
  const demo = first(sp.demo);
  return (
    <div className="stagger-children space-y-6">
      <Suspense fallback={<OrgTabGap minH="min-h-[36rem]" />}>
        <CareData slug={slug} demo={demo} />
      </Suspense>
    </div>
  );
}
