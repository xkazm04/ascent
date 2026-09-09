"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { buildUrl, clearedTabScopedParams } from "@/lib/org/orgTabs";
import { SURFACE_BODIES } from "../surfaces/surfaceBodies";
import type { SurfaceTechnique } from "../surfaces/surfaceBody";
import styles from "./playground.module.css";

export function ReferenceNotes({ slug, org }: { slug: string; org: string }) {
  const [techniques, setTechniques] = useState<readonly SurfaceTechnique[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const sp = useSearchParams();
  useEffect(() => {
    let alive = true;
    const loader = SURFACE_BODIES[slug];
    if (!loader) return;
    loader()
      .then((body) => {
        if (alive) setTechniques(body.techniques);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [slug, attempt]);
  if (failed)
    return (
      <div role="alert">
        <p>The reference could not be loaded.</p>
        <button
          onClick={() => {
            setFailed(false);
            setAttempt((n) => n + 1);
          }}
        >
          Try again
        </button>
      </div>
    );
  if (!techniques) return <p role="status">Loading reference…</p>;
  return (
    <div className={styles.referenceNotes}>
      <p>Implementation notes from the original showcase. The v2 playground is a simplified study.</p>
      {techniques.map((t) => (
        <details key={t.slug}>
          <summary>{t.title}</summary>
          <p>{t.mechanism}</p>
          <Link
            href={buildUrl(
              org,
              { ...clearedTabScopedParams(), tab: "surfaces", subject: slug, technique: t.slug },
              sp.toString(),
            )}
          >
            Inspect this technique in the original ↗
          </Link>
        </details>
      ))}
    </div>
  );
}
