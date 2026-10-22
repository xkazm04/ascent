"use client";

// The Surfaces gallery's state, shared by both compositions (v1 Altimeter, v2 Prism) so they cannot drift:
// the filters, the open subject from the URL, and the href builder that keeps the Knowledge base section.

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { buildUrl, clearedTabScopedParams } from "@/lib/org/orgTabs";
import { descriptions, subjects } from "./catalog";

export function useSurfacesView(slug: string) {
  const sp = useSearchParams();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [reference, setReference] = useState(false);
  const selected = subjects.find((s) => s.slug === sp.get("subject"));
  const href = (subject: string | null) =>
    buildUrl(slug, { ...clearedTabScopedParams(), tab: "knowledge", section: "surfaces", subject }, sp.toString());
  const filtered = subjects.filter(
    (s) =>
      (reference || s.interactive) &&
      (category === "all" || s.subcategory === category) &&
      `${s.title} ${descriptions[s.slug] ?? ""} ${s.record?.techniqueSlugs.join(" ") ?? ""}`
        .toLowerCase()
        .includes(query.trim().toLowerCase()),
  );
  return { sp, query, setQuery, category, setCategory, reference, setReference, selected, href, filtered };
}

export type SurfacesView = ReturnType<typeof useSurfacesView>;
