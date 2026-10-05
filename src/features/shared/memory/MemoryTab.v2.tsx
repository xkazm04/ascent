// Prism composition of the Memory tab. Same reads and the same Suspense boundaries as Altimeter.
import { Suspense } from "react";
import { Defer } from "@/components/ui/Defer";
import { Masthead } from "@/components/kit";
import { OrgTabGap } from "@/components/org/shell/OrgTabGap";
import { RegistrySyncStrip } from "@/features/shared/registry/RegistrySyncStrip";
import { listOrgMemories } from "@/lib/db";
import { listRepoDeadEnds } from "@/lib/db/repo-memory";
import { getMemoryCoverage } from "@/lib/memory/coverage";
import { resolveViewerLogin } from "@/lib/access";
import { MEMORY_KINDS } from "@/lib/org/memory-kinds";
import { getRegistrySync, registryBlobBase, type RegistrySync } from "@/lib/org/registry-sync";
import { NextMoveLink } from "@/components/org/shared/NextMoveLink";
import { orgTabHref } from "@/lib/org/orgTabs";
import { resolveMemoryShared, type MemoryShared } from "./memoryTabLoad";
import { MemoryCoverageV2 } from "./MemoryCoverage.v2";
import { RepoMemoryDeadEndsV2 } from "./RepoMemoryDeadEnds.v2";
import { MemoryPanelV2 } from "./MemoryPanel.v2";
import { MemoryRecallV2Chunk, MemoryReflectV2Chunk } from "./MemoryTabChunks.v2";

async function MemoryRegistryStrip({ slug, sync }: { slug: string; sync: Promise<RegistrySync> }) {
  return <RegistrySyncStrip sync={await sync} slug={slug} artifact="memory" />;
}

async function MemoryCoverageData({ slug }: { slug: string }) {
  const coverage = await getMemoryCoverage(slug).catch(() => null);
  if (!coverage || coverage.totalTrackedRepos === 0) return null;
  return <MemoryCoverageV2 coverage={coverage} />;
}

async function MemoryDeadEndsData({ slug }: { slug: string }) {
  const rows = await listRepoDeadEnds(slug).catch(() => []);
  return <RepoMemoryDeadEndsV2 rows={rows} />;
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
  const viewer = await viewerP;
  const [memories, gate] = await Promise.all([listOrgMemories(slug, {}, viewer), shared]);
  return (
    <MemoryPanelV2
      slug={slug}
      initial={memories ?? []}
      kinds={MEMORY_KINDS}
      namespaces={gate.namespaces}
      viewerLogin={viewer}
      canWrite={gate.isMember && gate.planAllowed}
      isAdmin={gate.isAdmin}
      planAllowed={gate.planAllowed}
      defaultVisibility={gate.personal ? "private" : "shared"}
      registryBase={registryBlobBase(await sync)}
    />
  );
}

async function MemoryRecallReflectData({ slug, shared }: { slug: string; shared: Promise<MemoryShared> }) {
  const { namespaces, isMember, planAllowed } = await shared;
  const canWrite = isMember && planAllowed;
  return (
    <>
      <Defer strategy="idle">
        <MemoryRecallV2Chunk slug={slug} namespaces={namespaces} kinds={MEMORY_KINDS} />
      </Defer>
      <Defer strategy="idle">
        <MemoryReflectV2Chunk slug={slug} canWrite={canWrite} />
      </Defer>
    </>
  );
}

export async function MemoryTabV2({ slug }: { slug: string }) {
  const viewer = resolveViewerLogin();
  const shared = resolveMemoryShared(slug, viewer);
  const sync = getRegistrySync(slug);
  return (
    <div data-role="memory-v2" className="space-y-2">
      <Masthead
        eyebrow="Shared memory"
        statement="What the org"
        named="remembers"
        pattern="spectral"
        lede="Decisions, findings and procedures that outlive the session they were learned in. Recall packs them into a character budget. Reflect rolls up what repeats."
      />
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
      <NextMoveLink href={orgTabHref(slug, "executive")} to="executive" />
    </div>
  );
}
