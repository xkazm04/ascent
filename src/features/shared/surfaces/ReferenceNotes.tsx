"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import type { SurfaceRecord } from "@/lib/org/surface-catalog";
import styles from "./playground.module.css";

export function ReferenceNotes({
  record,
  selected,
  knowledgeHref,
}: {
  record: SurfaceRecord;
  selected: string | null;
  knowledgeHref: string;
}) {
  const active = useRef<HTMLLIElement>(null);
  useEffect(() => {
    active.current?.scrollIntoView({ block: "nearest" });
  }, [selected]);
  return (
    <div className={styles.referenceNotes}>
      <p>Related techniques from the knowledge reference.</p>
      {selected && !record.techniqueSlugs.includes(selected) && (
        <p role="status">This technique is no longer listed. The subject reference is available below.</p>
      )}
      <ul className={styles.techniqueList}>
        {record.techniqueSlugs.map((technique) => (
          <li
            key={technique}
            ref={technique === selected ? active : undefined}
            data-selected={technique === selected}
            aria-current={technique === selected ? "true" : undefined}
          >
            {technique.replace(/-/g, " ").replace(/^./, (letter) => letter.toUpperCase())}
          </li>
        ))}
      </ul>
      <Link href={knowledgeHref}>Read the knowledge reference ↗</Link>
    </div>
  );
}
