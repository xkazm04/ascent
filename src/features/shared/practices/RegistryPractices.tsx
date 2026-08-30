// The practices the org's REGISTRY carries — `practices/<slug>/PRACTICE.md` indexed out of the repo the
// customer owns, listed beside (and above) ascent's own catalog.
//
// Why its own section rather than rows folded into the catalog table: these are not ascent's practices
// to EDIT. They are files under someone else's review process, so nothing here writes back to the
// registry and "Open in registry" remains the affordance for changing the practice itself.
//
// MOONSHOT #33 revised the other half of that reasoning. The original note said they are not ascent's
// practices "to apply-with-one-click" either — but copying the org's OWN agreed practice into a repo
// that lacks it, as a draft PR that repo's reviewers must approve, is exactly the reuse a registry
// exists for, and it is not a write into the registry at all. So each row now carries a Copy action
// (RegistryPracticeApply) that runs through `applyPracticeToRepo` — the same writer, admin gate, audit
// row and adoption row as every other apply, and a committed file that says it is a copy.
//
// Renders NOTHING when the org has no registry-origin shapes — before the first index pass, and for
// every org that never mapped a registry, this section simply does not exist.
//
// Server-safe: no hooks, no handlers.

import { Card, SectionHeader } from "@/components/org/shared/ui";
import { DIMENSIONS } from "@/lib/maturity/model";
import { OpenInRegistry, OriginTag, registryBlobHref } from "@/features/shared/registry/RegistryOriginTag";
import { RegistryPracticeApply } from "@/features/shared/practices/RegistryPracticeApply";
import type { PracticeShapeRow } from "@/lib/db/org-practice-shapes";

function dimensionLabel(id: string): string {
  return DIMENSIONS.find((d) => d.id === id)?.name ?? id;
}

export function RegistryPractices({
  rows,
  registryBase,
  repoOptions = [],
}: {
  /** Every live shape row; this component filters to the registry-origin ones itself. */
  rows: readonly PracticeShapeRow[];
  /** Blob-URL prefix of the mapped registry, or null when nothing is mapped. */
  registryBase: string | null;
  /** #33 — the org's repos, for the Copy action. Empty ⇒ no action rendered (nothing to copy into). */
  repoOptions?: string[];
}) {
  const fromRegistry = rows.filter((r) => r.origin === "registry");
  if (fromRegistry.length === 0) return null;

  return (
    <Card>
      <SectionHeader
        size="sm"
        title="From your registry"
        description="Practices your registry repo declares. They are versioned in git and changed by pull request, not here — ascent indexes them so every repo in the fleet can see what the org already agreed on."
      />
      <ul className="mt-3 divide-y divide-slate-800">
        {fromRegistry.map((r) => (
          <li key={r.id} className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 py-2.5">
            <div className="min-w-0">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-medium text-slate-200">{r.title || r.slug}</span>
                <span className="rounded border border-slate-700 px-1.5 py-0.5 type-caption text-slate-400">
                  {dimensionLabel(r.dimension)}
                </span>
                <OriginTag origin={r.origin} path={r.registryPath} />
              </div>
              {r.appliesWhen && <p className="mt-1 type-body-sm text-slate-400">{r.appliesWhen}</p>}
              <RegistryPracticeApply slug={r.slug} title={r.title || r.slug} repoOptions={repoOptions} />
            </div>
            <OpenInRegistry href={registryBlobHref(registryBase, r.registryPath)} />
          </li>
        ))}
      </ul>
    </Card>
  );
}
