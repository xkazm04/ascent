// VARIANT — COLUMNS. Metaphor: the registry's taxonomy as a departure board. One column per
// subcategory, every subject a single line in it, the whole corpus on one screen.
//
// Why it differs from the baseline: the baseline groups by subcategory too, but each group is a row
// of three-across cards carrying a summary paragraph, so the five groups stack into a very long
// page and the shape of the taxonomy is invisible. As columns the shape IS the layout — you can see
// at a glance that data-display is fully showcased and shell-and-navigation is not.
//
// A category that is out of this repo's scope says so once, under its header, instead of repeating
// the same sentence on eight cards. Server-rendered (no hooks).

import { HairlineGrid, SectionHeading } from "@/components/ui";
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

export function SurfacesGalleryColumns({
  slug,
  freshness,
  focusedSlug,
}: {
  slug: string;
  freshness: SurfaceFreshness;
  focusedSlug: string | null;
}) {
  return (
    <div className="space-y-4">
      <SectionHeading
        kicker="UI surfaces"
        title="The registry's ui-surfaces subjects, as scenes"
        intro={`${SURFACE_CATALOG.length} of ${SURFACE_SUBJECTS.length} subjects have a composed, interactive showcase — one column per subcategory, in the registry's own order.`}
      />
      <HairlineGrid className="grid-cols-1 sm:grid-cols-2 xl:grid-cols-5">
        {SURFACE_SUBCATEGORIES.map((sub) => {
          const subjects = SURFACE_SUBJECTS.filter((s) => s.subcategory === sub.id);
          const showcased = subjects.filter((s) => surfaceRecord(s.slug)).length;
          const scopedOut = subjects.every((s) => isSurfaceOutOfScope(s.slug));
          return (
            <section key={sub.id} className="bg-ink p-4" aria-labelledby={`surfaces-col-${sub.id}`}>
              <h3 id={`surfaces-col-${sub.id}`} className="type-body-sm font-semibold text-white">
                {sub.title}
              </h3>
              <p className="mt-0.5 type-caption tabular-nums text-slate-500">
                {showcased} / {subjects.length} showcased
              </p>
              {scopedOut ? (
                <p className="mt-2 type-caption text-slate-600">
                  Out of this repo&rsquo;s scope (<span className="text-slate-500">.ai/manifest.yaml</span>) — no scenes planned.
                </p>
              ) : null}
              <ul className="mt-3 divide-y divide-divider border-t border-divider">
                {subjects.map((subject) => {
                  const record = surfaceRecord(subject.slug);
                  const focused = focusedSlug === subject.slug;
                  return (
                    <li
                      key={subject.slug}
                      id={`surface-${subject.slug}`}
                      data-surface={subject.slug}
                      data-showcased={record ? "true" : "false"}
                      aria-current={focused ? "true" : undefined}
                      className={focused ? "ring-1 ring-inset ring-accent" : ""}
                    >
                      {record ? (
                        <Link
                          href={sceneHref(slug, subject.slug)}
                          className="focus-ring group flex items-baseline justify-between gap-2 py-2 transition hover:bg-surface/60"
                        >
                          <span className="type-body-sm text-slate-200 group-hover:text-accent">{record.title}</span>
                          <span className="type-caption tabular-nums text-slate-600">{record.techniqueSlugs.length}</span>
                        </Link>
                      ) : (
                        <div className="flex items-baseline justify-between gap-2 py-2">
                          <span className="type-body-sm text-slate-500">{subject.title}</span>
                          <span className="type-caption text-slate-700">—</span>
                        </div>
                      )}
                      {record ? (
                        <div className="pb-2">
                          <SurfaceFreshnessBadge label={freshnessOf(record.authoredAgainst.digest, freshness[subject.slug])} />
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
              {!scopedOut && showcased < subjects.length ? (
                <p className="mt-3 type-caption text-slate-600">
                  Unshowcased: run <span className="text-slate-400">/surface &lt;slug&gt;</span>
                </p>
              ) : null}
            </section>
          );
        })}
      </HairlineGrid>
      {focusedSlug && !SURFACE_SUBJECTS.some((s) => s.slug === focusedSlug) ? (
        <p className="type-body-sm text-slate-400">
          <span className="type-caption text-slate-300">{focusedSlug}</span> is not a ui-surfaces subject this catalog knows.
        </p>
      ) : null}
    </div>
  );
}
