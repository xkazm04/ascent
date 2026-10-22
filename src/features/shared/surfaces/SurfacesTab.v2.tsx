"use client";

// The Prism (v2) composition of the UI surfaces gallery: a masthead instead of the hero art, Segmented
// categories and a kit Input instead of the module's pill filters, and a hairline-ruled index (one
// linked row per surface with its preview) instead of a grid of cards. The open study is the same
// Playground v1 uses. State comes from useSurfacesView, shared with v1.
import Link from "next/link";
import { Caption, Frame, Input, Masthead, Segmented, Toolbar } from "@/components/kit";
import { categories, descriptions, subjects } from "./catalog";
import { Playground } from "./PlaygroundLazy";
import { SurfacePreview } from "./SurfacePreview";
import { useSurfacesView } from "./useSurfacesView";
import styles from "./surfaces.v2.module.css";

export function SurfacesTabV2({ slug }: { slug: string }) {
  const { sp, query, setQuery, category, setCategory, reference, setReference, selected, href, filtered } = useSurfacesView(slug);

  if (selected) {
    return (
      <div data-role="surfaces-v2" className={styles.scope}>
        <Playground key={`${selected.slug}:${sp.get("technique") ?? ""}`} subject={selected} org={slug} backHref={href(null)} subjectHref={href} />
      </div>
    );
  }
  const interactive = subjects.filter((s) => s.interactive).length;
  return (
    <div data-role="surfaces-v2" className={`${styles.scope} space-y-2`}>
      <Masthead
        eyebrow="Shared · knowledge library"
        statement="Good interfaces,"
        named="made tangible."
        lede="Explore the patterns, play with the details, find your next idea."
        figures={[
          { label: "Interactive studies", value: interactive },
          { label: "Surfaces to explore", value: subjects.length },
        ]}
        pattern="grid"
      />
      <Frame pad="sm" edge="both" aria-label="Surfaces">
        <Toolbar
          left={
            <Segmented
              label="Surface categories"
              variant="soft"
              value={category}
              onSelect={setCategory}
              options={categories.map((c) => ({ key: c.id, label: c.title }))}
            />
          }
          right={
            <>
              <Input type="search" aria-label="Search surfaces" placeholder="Find a surface…" value={query} onChange={(e) => setQuery(e.target.value)} />
              <label className="flex items-center gap-2 type-caption text-slate-400">
                <input type="checkbox" checked={reference} onChange={(e) => setReference(e.target.checked)} /> Include reference-only
              </label>
            </>
          }
        />
        <p role="status" className="mt-4">
          <Caption>
            {filtered.length} {filtered.length === 1 ? "surface" : "surfaces"}
            {category === "all" && !query ? " · Pick one to explore" : ""}
          </Caption>
        </p>
        {sp.get("subject") && <p role="status" className="mt-2 type-body-sm text-slate-400">This surface is not in the collection. Choose one below.</p>}
        <ul className="mt-4 divide-y divide-divider border-y border-divider">
          {filtered.map((s, i) => (
            <li key={s.slug}>
              <Link href={href(s.slug)} aria-label={`Explore ${s.title}`} className="focus-ring grid items-center gap-x-6 gap-y-3 py-4 transition-colors hover:bg-slate-900/40 sm:grid-cols-[minmax(0,14rem)_1fr_auto]">
                <div className="pointer-events-none max-h-28 overflow-hidden">
                  <SurfacePreview slug={s.slug} />
                </div>
                <div className="min-w-0">
                  <h3 className="type-body font-semibold text-white">{s.title}</h3>
                  <p className="mt-1 type-body-sm text-slate-400">{descriptions[s.slug] ?? categories.find((c) => c.id === s.subcategory)?.title}</p>
                  <Caption className="mt-1 block">
                    {s.interactive && s.record ? `Playground · ${s.record.techniqueSlugs.length} techniques` : "Reference only · no playground yet"}
                  </Caption>
                </div>
                <span className="type-caption tabular-nums text-slate-500">{String(i + 1).padStart(2, "0")} ↗</span>
              </Link>
            </li>
          ))}
        </ul>
        {filtered.length === 0 && (
          <div className="py-8">
            <h3 className="type-body font-semibold text-white">{query ? "No matching surfaces" : "The reference is here. The playgrounds are next."}</h3>
            <p className="mt-1 type-body-sm text-slate-400">
              {query ? "Try a different name or technique." : "Show reference-only surfaces to explore this part of the collection."}
            </p>
            <button
              type="button"
              className="focus-ring mt-3 rounded-md border border-divider px-3 py-1.5 type-body-sm text-slate-200 hover:text-white"
              onClick={() => {
                setQuery("");
                setReference(true);
              }}
            >
              Show all in this category
            </button>
          </div>
        )}
      </Frame>
    </div>
  );
}
