// The gallery: every ui-surfaces subject as a card, grouped by subcategory in the taxonomy's order —
// showcased ones link into their scene, the rest are absence cards. Server-rendered (no hooks): the
// catalog is static and the freshness map arrives from the tab.

import { HairlineGrid, SectionHeading } from "@/components/ui";
import {
  SURFACE_CATALOG,
  SURFACE_SUBCATEGORIES,
  SURFACE_SUBJECTS,
  isSurfaceOutOfScope,
  surfaceRecord,
} from "@/lib/org/surface-catalog";
import type { SurfaceFreshness } from "@/lib/org/surface-freshness";
import { buildUrl, clearedTabScopedParams } from "@/lib/org/orgTabs";
import { SurfaceCard } from "./SurfaceCard";
import { freshnessOf } from "./SurfaceFreshnessBadge";

export function sceneHref(slug: string, subject: string, technique: string | null = null): string {
  return buildUrl(slug, { tab: "surfaces", ...clearedTabScopedParams(), subject, technique }, "");
}

export function SurfacesGallery({
  slug,
  freshness,
  focusedSlug,
}: {
  slug: string;
  freshness: SurfaceFreshness;
  /** A `?subject=` that names no showcase: its absence card is ringed so the deep link lands somewhere. */
  focusedSlug: string | null;
}) {
  const showcased = SURFACE_CATALOG.length;
  return (
    <div className="space-y-8">
      <SectionHeading
        kicker="UI surfaces"
        title="The registry's ui-surfaces subjects, as scenes"
        intro={
          <>
            {showcased} of {SURFACE_SUBJECTS.length} subjects have a composed, interactive showcase. Each scene embodies every technique
            of its subject as a region you can spotlight, with the mechanism, the source, and where Ascent already does it — or falls short.
          </>
        }
      />
      {focusedSlug && !SURFACE_SUBJECTS.some((s) => s.slug === focusedSlug) ? (
        <p className="type-body-sm text-slate-400">
          <span className="type-caption text-slate-300">{focusedSlug}</span> is not a ui-surfaces subject this catalog knows.
        </p>
      ) : null}
      {SURFACE_SUBCATEGORIES.map((sub) => {
        const subjects = SURFACE_SUBJECTS.filter((s) => s.subcategory === sub.id);
        return (
          <section key={sub.id} className="space-y-3" aria-labelledby={`surfaces-${sub.id}`}>
            <SectionHeading size="sm" as="h3" id={`surfaces-${sub.id}`} title={sub.title} kicker={`${subjects.filter((s) => surfaceRecord(s.slug)).length} / ${subjects.length} showcased`} />
            <HairlineGrid className="grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
              {subjects.map((subject) => {
                const record = surfaceRecord(subject.slug);
                return (
                  <SurfaceCard
                    key={subject.slug}
                    subject={subject}
                    record={record}
                    href={sceneHref(slug, subject.slug)}
                    freshness={record ? freshnessOf(record.authoredAgainst.digest, freshness[subject.slug]) : null}
                    outOfScope={isSurfaceOutOfScope(subject.slug)}
                    focused={focusedSlug === subject.slug}
                  />
                );
              })}
            </HairlineGrid>
          </section>
        );
      })}
    </div>
  );
}
