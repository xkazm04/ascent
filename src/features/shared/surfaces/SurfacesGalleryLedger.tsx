// VARIANT — LEDGER. Metaphor: the index at the back of the book. One table, 33 rows, in the
// registry's own taxonomy order: category and name are the metadata, and nothing else competes.
//
// Why it differs from the baseline: the baseline gives every subject a card with its full summary,
// so the default page is a wall of prose you have to read to find the one subject you came for.
// A ledger is scanned, not read — the summary belongs to the scene, one click away. The category
// cell prints only when it changes, the way a printed index does, so the eye follows the names.
//
// Server-rendered (no hooks): the catalog is static and the freshness map arrives from the tab.

import { OrgTable } from "@/components/org/shared/ui";
import { SectionHeading } from "@/components/ui";
import {
  SURFACE_CATALOG,
  SURFACE_SUBCATEGORIES,
  SURFACE_SUBJECTS,
  isSurfaceOutOfScope,
  surfaceRecord,
} from "@/lib/org/surface-catalog";
import type { SurfaceFreshness } from "@/lib/org/surface-freshness";
import Link from "next/link";
import { sceneHref } from "./SurfacesGallery";
import { SurfaceFreshnessBadge, freshnessOf } from "./SurfaceFreshnessBadge";

/**
 * Taxonomy order: subcategories as the registry declares them, subjects in catalog order within.
 * `firstOfGroup` is computed here rather than tracked with a mutable cursor during render — the
 * category cell prints once per group, and a `let` reassigned inside a component body is a lint
 * error (react-hooks/immutability) as well as a re-render hazard.
 */
function orderedSubjects() {
  return SURFACE_SUBCATEGORIES.flatMap((sub) => SURFACE_SUBJECTS.filter((s) => s.subcategory === sub.id).map((s) => ({ ...s, group: sub.title }))).map(
    (s, i, arr) => ({ ...s, firstOfGroup: i === 0 || arr[i - 1]?.group !== s.group }),
  );
}

export function SurfacesGalleryLedger({
  slug,
  freshness,
  focusedSlug,
}: {
  slug: string;
  freshness: SurfaceFreshness;
  focusedSlug: string | null;
}) {
  const rows = orderedSubjects();

  return (
    <div className="space-y-4">
      <SectionHeading
        kicker="UI surfaces"
        title="The registry's ui-surfaces subjects, as scenes"
        intro={`${SURFACE_CATALOG.length} of ${SURFACE_SUBJECTS.length} subjects have a composed, interactive showcase. Open one to see every technique as a region you can spotlight, with its mechanism, its source, and where Ascent already does it — or falls short.`}
      />
      <OrgTable
        caption="Every ui-surfaces subject, its category, and whether it has a showcase"
        minWidth={720}
        head={
          <tr>
            <th className="px-4 py-2 text-left">Category</th>
            <th className="px-4 py-2 text-left">Subject</th>
            <th className="px-3 py-2 text-right">Techniques</th>
            <th className="px-4 py-2 text-left">Showcase</th>
          </tr>
        }
      >
        {rows.map((subject) => {
          const record = surfaceRecord(subject.slug);
          const outOfScope = isSurfaceOutOfScope(subject.slug);
          const focused = focusedSlug === subject.slug;
          const groupCell = subject.firstOfGroup ? subject.group : "";
          return (
            <tr
              key={subject.slug}
              id={`surface-${subject.slug}`}
              data-surface={subject.slug}
              data-showcased={record ? "true" : "false"}
              aria-current={focused ? "true" : undefined}
              className={focused ? "bg-accent/5 ring-1 ring-inset ring-accent" : ""}
            >
              <td className="px-4 py-2 align-baseline">
                <span className="type-label uppercase tracking-[0.2em] text-slate-500">{groupCell}</span>
              </td>
              <td className="px-4 py-2 align-baseline">
                {record ? (
                  <Link href={sceneHref(slug, subject.slug)} className="focus-ring type-body-sm font-medium text-white hover:text-accent">
                    {record.title}
                  </Link>
                ) : (
                  <span className="type-body-sm text-slate-400">{subject.title}</span>
                )}
                <span className="ml-2 type-caption text-slate-600">{subject.slug}</span>
              </td>
              <td className="px-3 py-2 text-right align-baseline">
                <span className="type-mono-sm tabular-nums text-slate-400">{record ? record.techniqueSlugs.length : "—"}</span>
              </td>
              <td className="px-4 py-2 align-baseline">
                {record ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <Link href={sceneHref(slug, subject.slug)} className="focus-ring type-caption text-accent hover:text-accent-soft">
                      open scene →
                    </Link>
                    <SurfaceFreshnessBadge label={freshnessOf(record.authoredAgainst.digest, freshness[subject.slug])} />
                  </span>
                ) : outOfScope ? (
                  <span className="type-caption text-slate-600">out of this repo&rsquo;s scope</span>
                ) : (
                  <span className="type-caption text-slate-500">
                    run <span className="text-slate-300">/surface {subject.slug}</span>
                  </span>
                )}
              </td>
            </tr>
          );
        })}
      </OrgTable>
      {focusedSlug && !SURFACE_SUBJECTS.some((s) => s.slug === focusedSlug) ? (
        <p className="type-body-sm text-slate-400">
          <span className="type-caption text-slate-300">{focusedSlug}</span> is not a ui-surfaces subject this catalog knows.
        </p>
      ) : null}
    </div>
  );
}
