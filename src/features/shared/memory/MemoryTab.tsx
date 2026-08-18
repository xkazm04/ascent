// Org dashboard "Memory" tab — the coverage strip, the browsable Shared Org Memory store, and the
// Recall/Reflect surfaces.
//
// SERVER component: the shell is client-side, this tab keeps reading the database directly behind the
// layout's canReadOrg gate. Filename PINNED as MemoryTab.tsx; it takes `slug` as a prop, because it is
// no longer a route and cannot await route params itself.
//
// Three independent data sources → three <Suspense> boundaries:
//   - the coverage strip (one aggregate query, degrades to nothing on failure — an instrument, not the
//     page);
//   - the browsable list + write form (needs the memories themselves, which nothing else does);
//   - Recall/Reflect, which need only `canWrite`/namespaces/kinds to render and do all their real work
//     from client-side button presses — so they code-split via MemoryTabChunks + <Defer> instead of
//     shipping in the initial bundle for a tab most opens are just here to browse.
//
// `namespaces`, member/admin role and plan-allowed are each read ONCE and the PROMISE handed to both the
// library and the recall/reflect regions — same shared-promise pattern as OverviewTab's
// `resolveOrgScope`. Awaiting a promise twice does not re-run the query.
import { Suspense } from "react";
import { Defer } from "@/components/ui/Defer";
import { MemoryPanel } from "@/features/shared/memory/MemoryPanel";
import { MemoryCoverageStrip } from "@/features/shared/memory/MemoryCoverageStrip";
import { MemoryRecallPanelChunk, MemoryReflectPanelChunk } from "@/features/shared/memory/MemoryTabChunks";
import { OrgTabGap } from "@/components/org/shell/OrgTabGap";
import { getMemoryCoverage } from "@/lib/memory/coverage";
import { getCreditState, isPersonalOrg, listOrgMemories, listOrgMemoryNamespaces } from "@/lib/db";
import { hasOrgRole } from "@/lib/authz";
import { resolveViewerLogin } from "@/lib/access";
import { planAllowsMemory } from "@/lib/plans";
import { MEMORY_KINDS } from "@/lib/org/memory-kinds";
import { getRegistrySync, registryBlobBase, type RegistrySync } from "@/lib/org/registry-sync";
import { RegistrySyncStrip } from "@/features/shared/registry/RegistrySyncStrip";

/** The registry strip: one small read, its own boundary, and it never blocks the library. */
async function MemoryRegistryStrip({ slug, sync }: { slug: string; sync: Promise<RegistrySync> }) {
  return <RegistrySyncStrip sync={await sync} slug={slug} artifact="memory" />;
}

/** The reads both the library panel and Recall/Reflect need, resolved once in MemoryTab. */
interface MemoryShared {
  namespaces: string[];
  isMember: boolean;
  isAdmin: boolean;
  planAllowed: boolean;
  personal: boolean;
}

async function resolveMemoryShared(slug: string): Promise<MemoryShared> {
  const [namespaces, credit, isMember, isAdmin, personal] = await Promise.all([
    listOrgMemoryNamespaces(slug),
    getCreditState(slug).catch(() => null),
    hasOrgRole(slug, "member"),
    hasOrgRole(slug, "admin"),
    isPersonalOrg(slug),
  ]);
  // Team+ orgs, or a personal workspace (individual tier: free-with-limits authoring).
  const planAllowed = planAllowsMemory(credit?.plan) || personal;
  return { namespaces, isMember, isAdmin, planAllowed, personal };
}

async function MemoryCoverageData({ slug }: { slug: string }) {
  // Coverage is an instrument, not the page: a failed read degrades to honest zeros rather than taking
  // down the memory list it decorates.
  const coverage = await getMemoryCoverage(slug).catch(() => null);
  if (!coverage || coverage.totalTrackedRepos === 0) return null;
  return <MemoryCoverageStrip coverage={coverage} />;
}

async function MemoryLibraryData({ slug, shared, sync }: { slug: string; shared: Promise<MemoryShared>; sync: Promise<RegistrySync> }) {
  // The viewer is resolved FIRST because it scopes the very rows we read (private scratch, §4.5).
  const viewer = await resolveViewerLogin();
  const [memories, { namespaces, isMember, isAdmin, planAllowed, personal }] = await Promise.all([
    listOrgMemories(slug, {}, viewer),
    shared,
  ]);

  return (
    <MemoryPanel
      slug={slug}
      initial={memories ?? []}
      kinds={MEMORY_KINDS}
      namespaces={namespaces}
      viewerLogin={viewer}
      canWrite={isMember && planAllowed}
      isAdmin={isAdmin}
      planAllowed={planAllowed}
      defaultVisibility={personal ? "private" : "shared"}
      registryBase={registryBlobBase(await sync)}
    />
  );
}

async function MemoryRecallReflectData({ slug, shared }: { slug: string; shared: Promise<MemoryShared> }) {
  const { namespaces, isMember, planAllowed } = await shared;
  const canWrite = isMember && planAllowed;

  return (
    <>
      {/* Recall is a READ, ungated for any member — matching /api/org/memory/recall. */}
      <Defer strategy="idle">
        <MemoryRecallPanelChunk slug={slug} namespaces={namespaces} kinds={MEMORY_KINDS} />
      </Defer>
      {/* Reflect is gated exactly as the route gates it (member + Team plan / personal workspace), so a
          read-only viewer gets the explanation rather than a button that 403s. */}
      <Defer strategy="idle">
        <MemoryReflectPanelChunk slug={slug} canWrite={canWrite} />
      </Defer>
    </>
  );
}

export async function MemoryTab({ slug }: { slug: string }) {
  // NOT awaited here — the promise streams into both consuming regions (see the note at the top).
  const shared = resolveMemoryShared(slug);
  const sync = getRegistrySync(slug);

  return (
    <div className="stagger-children space-y-6">
      <Suspense fallback={null}>
        <MemoryRegistryStrip slug={slug} sync={sync} />
      </Suspense>
      <Suspense fallback={null}>
        <MemoryCoverageData slug={slug} />
      </Suspense>
      <Suspense fallback={<OrgTabGap minH="min-h-[36rem]" />}>
        <MemoryLibraryData slug={slug} shared={shared} sync={sync} />
      </Suspense>
      <Suspense fallback={<OrgTabGap minH="min-h-[24rem]" />}>
        <MemoryRecallReflectData slug={slug} shared={shared} />
      </Suspense>
    </div>
  );
}
