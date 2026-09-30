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
import { RepoMemoryDeadEnds } from "@/features/shared/memory/RepoMemoryDeadEnds";
import { listRepoDeadEnds } from "@/lib/db/repo-memory";
import { MemoryRecallPanelChunk, MemoryReflectPanelChunk } from "@/features/shared/memory/MemoryTabChunks";
import { OrgTabGap } from "@/components/org/shell/OrgTabGap";
import { getMemoryCoverage } from "@/lib/memory/coverage";
import { listOrgMemories } from "@/lib/db";
import { resolveViewerLogin } from "@/lib/access";
import { MEMORY_KINDS } from "@/lib/org/memory-kinds";
import { getRegistrySync, registryBlobBase, type RegistrySync } from "@/lib/org/registry-sync";
import { RegistrySyncStrip } from "@/features/shared/registry/RegistrySyncStrip";
import { resolveMemoryShared, type MemoryShared } from "./memoryTabLoad";

/** The registry strip: one small read, its own boundary, and it never blocks the library. */
async function MemoryRegistryStrip({ slug, sync }: { slug: string; sync: Promise<RegistrySync> }) {
  return <RegistrySyncStrip sync={await sync} slug={slug} artifact="memory" />;
}

async function MemoryCoverageData({ slug }: { slug: string }) {
  // Coverage is an instrument, not the page: a failed read degrades to honest zeros rather than taking
  // down the memory list it decorates.
  const coverage = await getMemoryCoverage(slug).catch(() => null);
  if (!coverage || coverage.totalTrackedRepos === 0) return null;
  return <MemoryCoverageStrip coverage={coverage} />;
}

/** The mirrored dead ends (moonshot #14) — its own boundary and its own read, because it is the one
 *  region of this tab that is useful before anyone in the org has written a single memory by hand.
 *  A failed read degrades to nothing rather than taking the library down with it. */
async function MemoryDeadEndsData({ slug }: { slug: string }) {
  const rows = await listRepoDeadEnds(slug).catch(() => []);
  return <RepoMemoryDeadEnds rows={rows} />;
}

async function MemoryLibraryData({
  slug,
  shared,
  sync,
  viewer: viewerP,
}: {
  slug: string;
  shared: Promise<MemoryShared>;
  sync: Promise<RegistrySync>;
  viewer: Promise<string | null>;
}) {
  // The viewer scopes the very rows we read (private scratch, §4.5). ONE resolve for the whole tab,
  // shared with resolveMemoryShared — the namespace filter and the rows it filters must agree about
  // who is looking, and resolving it twice would also mean two session reads per render.
  const viewer = await viewerP;
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

export async function MemoryTabV1({ slug }: { slug: string }) {
  // NOT awaited here — the promise streams into both consuming regions (see the note at the top).
  const viewer = resolveViewerLogin();
  const shared = resolveMemoryShared(slug, viewer);
  const sync = getRegistrySync(slug);

  return (
    <div className="stagger-children space-y-6">
      <Suspense fallback={null}>
        <MemoryRegistryStrip slug={slug} sync={sync} />
      </Suspense>
      <Suspense fallback={null}>
        <MemoryCoverageData slug={slug} />
      </Suspense>
      <Suspense fallback={null}>
        <MemoryDeadEndsData slug={slug} />
      </Suspense>
      <Suspense fallback={<OrgTabGap minH="min-h-[36rem]" />}>
        <MemoryLibraryData slug={slug} shared={shared} sync={sync} viewer={viewer} />
      </Suspense>
      <Suspense fallback={<OrgTabGap minH="min-h-[24rem]" />}>
        <MemoryRecallReflectData slug={slug} shared={shared} />
      </Suspense>
    </div>
  );
}
