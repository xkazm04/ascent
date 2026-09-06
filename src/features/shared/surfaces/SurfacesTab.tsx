// Org dashboard "UI surfaces" tab — the registry's ui-surfaces subjects as composed, interactive
// scenes (spark ui-surfaces-showcase, 2026-09-06). A showcase is a repo-shipped artifact in a typed
// catalog (src/lib/org/surface-catalog.ts); this tab joins it at render to the org's registry index
// mirror for a digest-freshness badge, and the Knowledge subject reader deep-links in.
//
// SERVER component, filename PINNED as SurfacesTab.tsx — same shell contract as KnowledgeTab. One
// data read (`getSurfaceFreshness`, which degrades to `{}`), so the single <Suspense> at the
// OrgTabChunks call site is enough.
//
// Reads TWO deep-link params from `sp`: `?subject=` (which scene) and `?technique=` (which drawer).
// Both are in `TAB_SCOPED_PARAM_KEYS`, so a tab switch clears them. A `subject` that names no
// showcase lands on the GALLERY with that subject's absence card ringed — a link to an unauthored
// scene must arrive somewhere that says so, never on a blank canvas.

import { surfaceRecord } from "@/lib/org/surface-catalog";
import { getSurfaceFreshness } from "@/lib/org/surface-freshness";
import { SurfaceScene } from "./SurfaceScene";
import { SurfacesGallery } from "./SurfacesGallery";
import { freshnessOf } from "./SurfaceFreshnessBadge";

type SearchParams = { [key: string]: string | string[] | undefined };

const one = (sp: SearchParams, key: string): string | null => {
  const v = sp[key];
  return typeof v === "string" && v ? v : null;
};

export async function SurfacesTab({ slug, sp = {} }: { slug: string; sp?: SearchParams }) {
  const freshness = await getSurfaceFreshness(slug);
  const subject = one(sp, "subject");
  const record = subject ? surfaceRecord(subject) : null;

  if (!record) return <SurfacesGallery slug={slug} freshness={freshness} focusedSlug={subject} />;

  return (
    <SurfaceScene
      key={record.slug}
      slug={slug}
      record={record}
      freshness={freshnessOf(record.authoredAgainst.digest, freshness[record.slug])}
      initialTechnique={one(sp, "technique")}
    />
  );
}
