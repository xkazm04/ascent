"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { buildUrl, clearedTabScopedParams } from "@/lib/org/orgTabs";
import { categories, descriptions, subjects } from "./catalog";
import { SurfacePreview } from "./SurfacePreview";
import styles from "./library.module.css";

const Playground = dynamic(() => import("./Playground").then((m) => m.Playground), {
  // These local-only forms must not submit as native GETs before their handlers hydrate.
  ssr: false,
  loading: () => (
    <p role="status" className={styles.empty}>
      Opening playground…
    </p>
  ),
});

export function KnowledgeV2Tab({ slug }: { slug: string }) {
  const sp = useSearchParams();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [reference, setReference] = useState(false);
  const selected = subjects.find((s) => s.slug === sp.get("subject"));
  const href = (subject: string | null) =>
    buildUrl(
      slug,
      {
        ...clearedTabScopedParams(),
        tab: "knowledge-v2",
        subject,
      },
      sp.toString(),
    );
  const filtered = subjects.filter(
    (s) =>
      (reference || s.interactive) &&
      (category === "all" || s.subcategory === category) &&
      `${s.title} ${descriptions[s.slug] ?? ""} ${s.record?.techniqueSlugs.join(" ") ?? ""}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );

  return (
    <div className={styles.library}>
      <div className={styles.topline}>
        <Link href={href(null)} className={styles.wordmark}>
          ◈ <span>Knowledge library</span>
        </Link>
        <span className={styles.edition}>EXPLORATION / 02</span>
      </div>
      {selected ? (
        <Playground key={selected.slug} subject={selected} org={slug} backHref={href(null)} subjectHref={href} />
      ) : (
        <>
          <header className={styles.hero}>
            <div className={styles.eyebrow}>THE INTERFACE COLLECTION</div>
            <h2>
              Good interfaces.
              <br />
              <span>Made tangible.</span>
            </h2>
            <p>Explore the patterns. Play with the details. Find your next idea.</p>
            <div className={styles.heroMeta}>
              <span>
                <i /> {subjects.filter((s) => s.interactive).length} interactive studies
              </span>
              <span>{subjects.length} surfaces to explore</span>
            </div>
            <div className={styles.heroArt} aria-hidden="true">
              <div>⌘</div>
              <div>◈</div>
              <div>↗</div>
            </div>
          </header>
          <div className={styles.toolbar}>
            <nav aria-label="Surface categories" className={styles.filters}>
              {categories.map((c) => (
                <button key={c.id} type="button" aria-pressed={category === c.id} onClick={() => setCategory(c.id)}>
                  {c.title}
                </button>
              ))}
            </nav>
            <label className={styles.search}>
              <span aria-hidden="true">⌕</span>
              <input
                type="search"
                aria-label="Search surfaces"
                placeholder="Find a surface…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
          </div>
          <div className={styles.resultbar}>
            <span role="status">
              {filtered.length} {filtered.length === 1 ? "surface" : "surfaces"}
              {category === "all" && !query ? " · Pick one to explore" : ""}
            </span>
            <label>
              <input type="checkbox" checked={reference} onChange={(e) => setReference(e.target.checked)} /> Include
              reference-only
            </label>
          </div>
          {sp.get("subject") && !selected && (
            <p role="status">This surface is not in the collection. Choose one below.</p>
          )}
          <div className={styles.grid}>
            {filtered.map((s, i) => (
              <Link href={href(s.slug)} key={s.slug} className={styles.card} aria-label={`Explore ${s.title}`}>
                <div className={styles.cardVisual}>
                  <SurfacePreview slug={s.slug} />
                  <span className={styles.openArrow}>↗</span>
                </div>
                <div className={styles.cardTitle}>
                  <h3>{s.title}</h3>
                  <span>{String(i + 1).padStart(2, "0")}</span>
                </div>
                <p>{descriptions[s.slug] ?? categories.find((c) => c.id === s.subcategory)?.title}</p>
                <div className={styles.cardMeta}>
                  {s.interactive && s.record ? (
                    <>
                      <i /> Playground <span>{s.record.techniqueSlugs.length} techniques</span>
                    </>
                  ) : (
                    <>
                      Reference only <span>No playground yet</span>
                    </>
                  )}
                </div>
              </Link>
            ))}
          </div>
          {filtered.length === 0 && (
            <div className={styles.empty}>
              <h3>{query ? "No matching surfaces" : "The reference is here. The playgrounds are next."}</h3>
              <p>
                {query
                  ? "Try a different name or technique."
                  : "Show reference-only surfaces to explore this part of the collection."}
              </p>
              <button
                onClick={() => {
                  setQuery("");
                  setReference(true);
                }}
              >
                Show all in this category
              </button>
            </div>
          )}
          <footer className={styles.footer}>
            <span>Built to be explored.</span>
            <span>UI surfaces / Software engineering</span>
          </footer>
        </>
      )}
    </div>
  );
}
