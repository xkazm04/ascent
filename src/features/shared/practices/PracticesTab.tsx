// Org dashboard "Practices" tab — Pillar 2's flagship surface. The library itself (authored
// playbooks + mined practices) is a dense client ledger; this server tab fetches it and gives it the
// READING that Governance and Adoption already open with: a tile row of headline numbers and a
// Copy-for-LLM brief (practiceLibraryMarkdown), both folded from the data the ledger already needs —
// no extra query.
//
// SERVER component, filename PINNED as PracticesTab.tsx (docs/ORG-TABS-REFACTOR.md). Takes `slug` +
// the resolved `sp` as props — it is no longer a route. Single <Suspense> boundary at the
// OrgTabChunks call site: the tech-stack scope must resolve before getOrgPractices can be scoped by
// it, so the reads are sequential/coupled rather than independent sources.
//
// Theme picks the composition after the reads: PracticesTab.v1 is the shipped markup, PracticesPageV2
// is the Prism composition. Both receive the same PracticesPageData.

import { getOrgPractices, getOrgRollupShared, getPlaybookAdoption, listOrgRepoNames, listPlaybooks } from "@/lib/db";
import { getFoundationRollout } from "@/lib/db/org-foundation";
import { buildCoherenceRows } from "./foundation/guidanceCoherenceModel";
import { resolveStackScope } from "@/lib/org/scope";
import { buildPracticeLibrarySummary, practiceLibraryMarkdown } from "@/lib/org/practice-library";
import { getOrgPracticeShapes, listOrgPracticeShapeRows } from "@/lib/db/org-practice-shapes";
import { minePracticeShapes } from "@/lib/org/practice-mining";
import { syncHousePatternVersions } from "@/lib/db/house-pattern-versions";
import { getPracticeAdoptionSummary } from "@/lib/db/practice-adoption";
import { DIMENSIONS } from "@/lib/maturity/model";
import { registryBlobBase, getRegistrySync } from "@/lib/org/registry-sync";
import { ScopeFilterBar } from "@/components/org/shared/ScopeFilterBar";
import { getTheme } from "@/lib/theme/server";
import { degraded } from "./practicesDegradedRead";
import { PracticesPageV2 } from "./PracticesPage.v2";
import { PracticesTabV1 } from "./PracticesTab.v1";
import type { PracticesPageData } from "./practicesData";

type SearchParams = { [key: string]: string | string[] | undefined };

export async function PracticesTab({ slug, sp }: { slug: string; sp: SearchParams }) {
  // Optional tech-stack scope (Feature 3b): the MINED library honors a ?stack= param. The page used
  // to resolve this scope and then DISCARD techGroups/activeStack — filtering the library while
  // rendering no control, so ?stack= silently narrowed the table with nothing on screen to explain or
  // clear it (docs/harness/biz-bug-scan-2026-06-29). The selector now renders, same as every sibling
  // tab. No segment selector here: getOrgPractices' segment scope isn't wired on this surface yet.
  const { techGroups, activeStack, techGroupId } = await resolveStackScope(slug, sp);
  const [playbooks, adoption, repoOptions, practices, shapes, sync, shapeRows, foundationRows, rollup, theme] = await Promise.all([
    listPlaybooks(slug),
    getPlaybookAdoption(slug),
    // One column, one query. This used to be a full unscoped `getOrgRollup` whose ONLY consumed field
    // was `repos[].fullName` — the dashboard's heaviest read, bought to fill a repo picker.
    listOrgRepoNames(slug),
    getOrgPractices(slug, null, techGroupId),
    // W6 — the org's OWN structure, for the house-pattern panel. Degrades to null (panel omitted)
    // rather than failing the tab: a missing panel is honest, an empty one would assert the org
    // shares nothing.
    getOrgPracticeShapes(slug).catch(degraded(slug, "practice shapes", null)),
    // Where these practices live (UC2): the strip says it once, and the registry-origin rows below are
    // read-only mirrors. Both degrade to "nothing mapped" rather than failing the tab.
    getRegistrySync(slug),
    listOrgPracticeShapeRows(slug).catch(degraded(slug, "shape rows", [])),
    // The fleet foundation rollout (moonshot #35) and the guidance-coherence measure (#15), moved here
    // from the Repositories tab on 2026-09-15: the shared checklist and its measurement in one place.
    // The rollup is request-cached and scoped the same way the Repositories tab reads it.
    getFoundationRollout(slug),
    getOrgRollupShared(slug, undefined, null, techGroupId).catch(degraded(slug, "coherence rollup", null)),
    getTheme(),
  ]);
  // MOONSHOT #33 — version the org's mined patterns from the read that already mined them, then read
  // the adoption ledger. `syncHousePatternVersions` writes only when the pattern's hash MOVED, so this
  // is a no-op on every render but the first after a shape actually changes; both degrade to a
  // no-strip rather than failing the tab.
  const mined = shapes ? minePracticeShapes(shapes) : null;
  if (mined) await syncHousePatternVersions(slug);
  const adoptionLedger = await getPracticeAdoptionSummary(slug).catch(degraded(slug, "adoption ledger", null));
  const dimOptions = DIMENSIONS.map((d) => ({ id: d.id, label: d.name }));

  const summary = buildPracticeLibrarySummary(slug, practices ?? [], playbooks ?? [], adoption);
  const data: PracticesPageData = {
    slug,
    sync,
    techGroups,
    activeStack,
    brief: practiceLibraryMarkdown(summary),
    mined,
    reposWithShape: shapes?.length ?? 0,
    shapeRows,
    registryBase: registryBlobBase(sync),
    repoOptions,
    summary,
    adoptionLedger,
    playbooks: playbooks ?? [],
    practices: practices ?? [],
    adoption,
    dimOptions,
    foundationRows,
    coherence: rollup && rollup.repos.length > 0 ? buildCoherenceRows(rollup.repos) : null,
  };
  return theme === "prism" ? (
    <PracticesPageV2
      data={data}
      filters={<ScopeFilterBar segments={[]} segmentId={null} techGroups={techGroups} activeStack={activeStack} />}
    />
  ) : (
    <PracticesTabV1 data={data} />
  );
}
