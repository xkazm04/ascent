"use client";

import { useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { buildUrl, clearedTabScopedParams } from "@/lib/org/orgTabs";
import { useSearchParams } from "next/navigation";
import { categories, descriptions, subjects, type Subject } from "./catalog";
import { DataPlayground } from "./DataPlayground";
import { FeedbackPlayground } from "./FeedbackPlayground";
import { SurfacePreview } from "./SurfacePreview";
import styles from "./playground.module.css";

const ReferenceNotes = dynamic(() => import("./ReferenceNotes").then((m) => m.ReferenceNotes), {
  loading: () => <p role="status">Loading reference…</p>,
});

export function Playground({
  subject,
  org,
  backHref,
  subjectHref,
}: {
  subject: Subject;
  org: string;
  backHref: string;
  subjectHref: (subject: string) => string;
}) {
  const [notes, setNotes] = useState(false);
  const [revision, setRevision] = useState(0);
  const sp = useSearchParams();
  const available = subjects.filter((s) => s.interactive);
  const index = available.findIndex((s) => s.slug === subject.slug);
  const previous = available[index - 1];
  const next = available[index + 1];
  const oldHref = buildUrl(org, { ...clearedTabScopedParams(), tab: "surfaces", subject: subject.slug }, sp.toString());
  const knowledgeHref = buildUrl(
    org,
    { ...clearedTabScopedParams(), tab: "knowledge", domain: "software-engineering", subject: subject.slug },
    sp.toString(),
  );
  return (
    <section className={styles.playground}>
      <nav className={styles.breadcrumb} aria-label="Collection">
        <Link href={backHref}>← All surfaces</Link>
        <span>/</span>
        <span>{categories.find((c) => c.id === subject.subcategory)?.title}</span>
      </nav>
      <header className={styles.heading}>
        <div>
          <h2>{subject.title}</h2>
          <p>{descriptions[subject.slug] ?? "Part of the interface collection."}</p>
        </div>
        <span className={styles.study}>
          {subject.interactive && subject.record ? `STUDY ${String(index + 1).padStart(2, "0")}` : "REFERENCE"}
        </span>
      </header>
      {subject.interactive && subject.record ? (
        <>
          <div className={styles.stageBar}>
            <div>
              <i /> Interactive playground <span>Sample data</span>
            </div>
            <button onClick={() => setRevision((r) => r + 1)}>↶ Reset</button>
          </div>
          <div className={styles.stage} key={revision}>
            {subject.subcategory === "data-display" ? (
              <DataPlayground slug={subject.slug} />
            ) : (
              <FeedbackPlayground slug={subject.slug} />
            )}
          </div>
          <div className={styles.belowStage}>
            <span>Try the controls. Everything here stays in this playground.</span>
            <Link href={oldHref}>Open original showcase ↗</Link>
          </div>
          <section className={styles.notes}>
            <button
              className={styles.notesToggle}
              aria-expanded={notes}
              aria-controls="kb-reference"
              onClick={() => setNotes(!notes)}
            >
              <span>
                Behind the interface{" "}
                <small>{subject.record.techniqueSlugs.length} techniques · Source & implementation</small>
              </span>
              <span>{notes ? "−" : "+"}</span>
            </button>
            {notes && (
              <div id="kb-reference">
                <ReferenceNotes slug={subject.slug} org={org} />
              </div>
            )}
          </section>
          <nav className={styles.adjacent} aria-label="More studies">
            {previous ? (
              <Link href={subjectHref(previous.slug)}>
                ←{" "}
                <span>
                  <small>Previous</small>
                  {previous.title}
                </span>
              </Link>
            ) : (
              <span />
            )}
            {next && (
              <Link href={subjectHref(next.slug)}>
                <span>
                  <small>Next study</small>
                  {next.title}
                </span>{" "}
                →
              </Link>
            )}
          </nav>
        </>
      ) : (
        <div className={styles.referenceOnly}>
          <SurfacePreview slug={subject.slug} />
          <h3>A reference, for now.</h3>
          <p>This subject has no interactive study yet.</p>
          <Link href={knowledgeHref}>Read the knowledge reference ↗</Link>
        </div>
      )}
    </section>
  );
}
