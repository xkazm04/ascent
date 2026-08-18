// The practices the org's REGISTRY carries — `practices/<slug>/PRACTICE.md` indexed out of the repo the
// customer owns, listed beside (and above) ascent's own catalog.
//
// Why its own section rather than rows folded into the catalog table: these are not ascent's practices
// to edit or apply-with-one-click. They are files under someone else's review process, so the only
// affordance that can be honest is the file itself. Mixing them into a table whose rows carry "Apply"
// buttons would promise a write ascent must not make.
//
// Renders NOTHING when the org has no registry-origin shapes — before the first index pass, and for
// every org that never mapped a registry, this section simply does not exist.
//
// Server-safe: no hooks, no handlers.

import { Card, SectionHeader } from "@/components/org/shared/ui";
import { DIMENSIONS } from "@/lib/maturity/model";
import { OpenInRegistry, OriginTag, registryBlobHref } from "@/features/shared/registry/RegistryOriginTag";
import type { PracticeShapeRow } from "@/lib/db/org-practice-shapes";

function dimensionLabel(id: string): string {
  return DIMENSIONS.find((d) => d.id === id)?.name ?? id;
}

export function RegistryPractices({
  rows,
  registryBase,
}: {
  /** Every live shape row; this component filters to the registry-origin ones itself. */
  rows: readonly PracticeShapeRow[];
  /** Blob-URL prefix of the mapped registry, or null when nothing is mapped. */
  registryBase: string | null;
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
                <span className="rounded border border-slate-700 px-1.5 py-0.5 font-mono text-xs text-slate-400">
                  {dimensionLabel(r.dimension)}
                </span>
                <OriginTag origin={r.origin} path={r.registryPath} />
              </div>
              {r.appliesWhen && <p className="mt-1 text-sm text-slate-400">{r.appliesWhen}</p>}
            </div>
            <OpenInRegistry href={registryBlobHref(registryBase, r.registryPath)} />
          </li>
        ))}
      </ul>
    </Card>
  );
}
