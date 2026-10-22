"use client";

import { useSearchParams } from "next/navigation";
import { buildUrl, clearedTabScopedParams } from "@/lib/org/orgTabs";
import { Segmented } from "@/components/kit";

export type KnowledgeSectionId = "subjects" | "surfaces";

const SECTIONS: readonly { id: KnowledgeSectionId; label: string }[] = [
  { id: "subjects", label: "Subjects" },
  { id: "surfaces", label: "UI surfaces" },
];

/** The Knowledge base's two sections: the registry's subjects (default) and the UI surfaces gallery
 *  (`?section=surfaces`). A section switch is a clean view change — tab-scoped params are cleared. */
export function KnowledgeSectionSwitch({ slug, active }: { slug: string; active: KnowledgeSectionId }) {
  const search = useSearchParams().toString();
  const hrefFor = (id: KnowledgeSectionId) =>
    buildUrl(slug, { ...clearedTabScopedParams(), tab: "knowledge", section: id === "surfaces" ? "surfaces" : null }, search);
  return (
    <Segmented
      nav
      label="Knowledge base sections"
      variant="soft"
      value={active}
      options={SECTIONS.map((s) => ({ key: s.id, label: s.label, href: hrefFor(s.id) }))}
    />
  );
}
