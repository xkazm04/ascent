"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { buildUrl, clearedTabScopedParams } from "@/lib/org/orgTabs";

export type KnowledgeSectionId = "subjects" | "surfaces";

const SECTIONS: readonly { id: KnowledgeSectionId; label: string }[] = [
  { id: "subjects", label: "Subjects" },
  { id: "surfaces", label: "UI surfaces" },
];

/** The Knowledge base's two sections: the registry's subjects (default) and the UI surfaces gallery
 *  (`?section=surfaces`). A section switch is a clean view change — tab-scoped params are cleared. */
export function KnowledgeSectionSwitch({ slug, active }: { slug: string; active: KnowledgeSectionId }) {
  const search = useSearchParams().toString();
  return (
    <nav aria-label="Knowledge base sections" className="flex gap-1">
      {SECTIONS.map((s) => (
        <Link
          key={s.id}
          href={buildUrl(
            slug,
            { ...clearedTabScopedParams(), tab: "knowledge", section: s.id === "surfaces" ? "surfaces" : null },
            search,
          )}
          aria-current={s.id === active ? "page" : undefined}
          className={`focus-ring rounded-md border px-3 py-1 type-caption transition ${
            s.id === active
              ? "border-accent text-white"
              : "border-divider text-slate-400 hover:text-white"
          }`}
        >
          {s.label}
        </Link>
      ))}
    </nav>
  );
}
