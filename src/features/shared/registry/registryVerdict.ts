// The Registry tab's one-line verdict, and the two totals it reads. Pure: no JSX, no hooks. Moved out
// of ./registryModel (which re-exports all three, so no call site changes) to keep that module under
// the 200-line cap for src/features.

import type { RegistryView } from "@/lib/org/registry-view";

export function migratedTotals(v: RegistryView): { moved: number; total: number } {
  return Object.values(v.migration).reduce((acc, m) => ({ moved: acc.moved + m.moved, total: acc.total + m.total }), { moved: 0, total: 0 });
}

export function hostedOnlyTotal(v: RegistryView): number {
  return v.counts.skills.hostedOnly + v.counts.practices.hostedOnly + v.counts.memory.hostedOnly;
}

/**
 * The adoption tail. Adoption BY HASH (in_sync / stale / diverged / local_only) has no pass that
 * measures it, so a live view carries four zeros, and four zeros are "not measured", never "every
 * pointing repo in sync". Only a view that actually carries adoption counts may claim either.
 */
function adoptionTail(adoption: RegistryView["fleet"]["adoption"]): string {
  const { inSync, stale, diverged, localOnly } = adoption;
  if (inSync + stale + diverged + localOnly === 0) return " · adoption by hash not measured yet";
  const behind = stale + diverged;
  return behind > 0 ? ` · ${behind} repo${behind === 1 ? "" : "s"} behind the catalog` : " · every pointing repo in sync";
}

/** The one-line honest summary the masthead/verdict slot shows in every variant. */
export function registryVerdict(v: RegistryView): string {
  if (v.status === "unmapped") {
    const n = hostedOnlyTotal(v);
    return n === 0
      ? "Hosted only: nothing in a registry yet, and nothing to move."
      : `Hosted only: ${n} artifact${n === 1 ? "" : "s"} live in ascent's tables, nothing in a registry yet.`;
  }
  if (v.status === "scaffolding") return "Scaffolding the registry layout.";
  if (v.status === "scaffold_pr_open") return "Scaffold PR is open: a CODEOWNER merge turns it into your registry.";
  if (v.status === "error") return v.error?.message ?? "The last index attempt failed.";
  if (v.registry?.mode === "hosted_mirror") return "Hosted mirror: ascent stays the writer; the repo is a read-only copy.";
  const { moved, total } = migratedTotals(v);
  const pointing = v.fleet.reposPointing;
  if (typeof pointing !== "number") return `${moved}/${total} artifacts in the registry · fleet pointing not measured yet`;
  return `${moved}/${total} artifacts in the registry · ${pointing}/${v.fleet.reposTotal} repos pointing${adoptionTail(v.fleet.adoption)}`;
}
