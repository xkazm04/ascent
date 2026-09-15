// One gallery cell: a showcased subject links into its scene; an unauthored one is an absence card
// that names the act which fills it (`/surface <slug>`); an out-of-scope one says why no scene is
// coming. No hooks — server-rendered inside the gallery's HairlineGrid (children set `bg-ink` so the
// grid's gap reads as a hairline).

import Link from "next/link";
import { Kicker } from "@/components/ui";
import { SURFACE_SUBCATEGORIES, type SurfaceRecord, type SurfaceSubjectRef } from "@/lib/org/surface-catalog";
import { SurfaceFreshnessBadge, type FreshnessLabel } from "./SurfaceFreshnessBadge";

const CELL = "block bg-ink p-5 min-h-[11rem]";

function subcategoryTitle(id: SurfaceSubjectRef["subcategory"]): string {
  return SURFACE_SUBCATEGORIES.find((c) => c.id === id)?.title ?? id;
}

export function SurfaceCard({
  subject,
  record,
  href,
  freshness,
  outOfScope,
  focused,
}: {
  subject: SurfaceSubjectRef;
  /** The catalog record when showcased; null for an absence card. */
  record: SurfaceRecord | null;
  /** The scene URL — only meaningful with a record. */
  href: string;
  freshness: FreshnessLabel | null;
  outOfScope: boolean;
  /** A deep link named this slug but it has no scene: the card is where that link lands. */
  focused: boolean;
}) {
  const ring = focused ? "ring-1 ring-inset ring-accent" : "";
  if (record) {
    return (
      <Link
        href={href}
        id={`surface-${subject.slug}`}
        className={`${CELL} focus-ring group transition hover:bg-surface/60`}
        data-surface={subject.slug}
        data-showcased="true"
      >
        <Kicker tone="muted">{subcategoryTitle(subject.subcategory)}</Kicker>
        <h3 className="mt-2 type-title font-semibold text-white group-hover:text-accent-soft">{record.title}</h3>
        <p className="mt-2 type-body-sm text-slate-400">{record.summary}</p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span className="type-caption text-slate-500">{record.techniqueSlugs.length} techniques</span>
          <SurfaceFreshnessBadge label={freshness} />
        </div>
      </Link>
    );
  }
  return (
    <div id={`surface-${subject.slug}`} className={`${CELL} ${ring}`} data-surface={subject.slug} data-showcased="false" aria-current={focused ? "true" : undefined}>
      <Kicker tone="muted">{subcategoryTitle(subject.subcategory)}</Kicker>
      <h3 className="mt-2 type-title font-semibold text-slate-400">{subject.title}</h3>
      {outOfScope ? (
        <p className="mt-2 type-body-sm text-slate-500">
          Out of this repo&rsquo;s scope (<span className="type-caption text-slate-400">.ai/manifest.yaml</span>): Ascent has no editing
          surface, so no scene is planned.
        </p>
      ) : (
        <p className="mt-2 type-body-sm text-slate-500">
          Not yet showcased — run <span className="type-caption text-slate-300">/surface {subject.slug}</span>
        </p>
      )}
      {focused ? <p className="mt-3 type-caption text-accent">The link you followed names this subject; there is no scene for it yet.</p> : null}
    </div>
  );
}
