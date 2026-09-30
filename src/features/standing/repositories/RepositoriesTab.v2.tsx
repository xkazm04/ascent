// The Prism (v2) composition of the Repositories tab (repositories mode). The tab switch becomes a Segmented nav,
// the leaderboard region owns the masthead (it needs the rollup), and the cadence backlog line rides inside it as a
// slot so it keeps its own Suspense boundary. Context Health keeps its boundary and its scope promise. Same scope
// promise, same panels and same gap heights as the Altimeter composition in RepositoriesTab.tsx.
import { Suspense } from "react";
import { OrgTabGap } from "@/components/org/shell/OrgTabGap";
import type { OrgScope } from "@/lib/org/scope";
import { FleetTabs } from "./FleetTabs";
import { QueueDepthLine } from "./QueueDepthLine";
import { RepositoriesLeaderboardPanel } from "./RepositoriesLeaderboardPanel";
import { ContextHealthPanel } from "./context-health/ContextHealthPanel";

type SearchParams = { [key: string]: string | string[] | undefined };

export function RepositoriesTabV2({ slug, sp, scope }: { slug: string; sp: SearchParams; scope: Promise<OrgScope> }) {
  return (
    <div className="stagger-children space-y-8">
      <FleetTabs slug={slug} active="repositories" theme="prism" />
      <Suspense fallback={<OrgTabGap minH="min-h-[40rem]" />}>
        <RepositoriesLeaderboardPanel
          slug={slug}
          sp={sp}
          scope={scope}
          theme="prism"
          queue={
            <Suspense fallback={<OrgTabGap minH="min-h-4" />}>
              <QueueDepthLine slug={slug} className="type-body-sm text-slate-400" />
            </Suspense>
          }
        />
      </Suspense>
      <Suspense fallback={<OrgTabGap minH="min-h-[28rem]" />}>
        <ContextHealthPanel slug={slug} scope={scope} />
      </Suspense>
    </div>
  );
}
