// The gallery: the registry's taxonomy as a departure board — one column per subcategory, every
// subject a single line in it, the whole corpus on one screen. Category and name are the metadata
// the gallery carries; a subject's summary, techniques and source live in its scene, one click away.
//
// Won the 2026-09-06 prototype round over a ledger (one table) and the shipped cards. The cards
// carried a summary paragraph each, which made the default page 3981px of prose you had to read to
// find the one subject you came for; as columns the page is one screen and the shape of the
// taxonomy IS the layout — data-display fully showcased, shell-and-navigation not yet.
//
// Subjects sort by name inside each column (the registry's own order governs the columns). A
// category that is out of this repo's scope says so once, under its header, instead of repeating
// the same sentence on eight cards. Server-rendered: no hooks, the catalog is static and the
// freshness map arrives from the tab.

import { HairlineGrid, SectionHeading } from "@/components/ui";
import {
  SURFACE_CATALOG,
  SURFACE_SUBCATEGORIES,
  SURFACE_SUBJECTS,
  isSurfaceOutOfScope,
  surfaceRecord,
  type SurfaceSubjectRef,
} from "@/lib/org/surface-catalog";
import type { SurfaceFreshness } from "@/lib/org/surface-freshness";
import Link from "next/link";
import { buildUrl, clearedTabScopedParams } from "@/lib/org/orgTabs";
import { SurfaceFreshnessBadge, freshnessOf } from "./SurfaceFreshnessBadge";

export function sceneHref(slug: string, subject: string, technique: string | null = null): string {
  return buildUrl(slug, { tab: "surfaces", ...clearedTabScopedParams(), subject, technique }, "");
}

/** One column's subjects, by name ascending — a reader scans a column alphabetically, not by index. */
function columnSubjects(subcategory: SurfaceSubjectRef["subcategory"]): SurfaceSubjectRef[] {
  return [...SURFACE_SUBJECTS.filter((s) => s.subcategory === subcategory)].sort((a, b) => a.title.localeCompare(b.title));
}

export function SurfacesGallery({
  slug,
  freshness,
  focusedSlug,
}: {
  slug: string;
  freshness: SurfaceFreshness;
  /** A `?subject=` that names no showcase: its line is ringed so the deep link lands somewhere. */
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
          const subjects = columnSubjects(sub.id);
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
