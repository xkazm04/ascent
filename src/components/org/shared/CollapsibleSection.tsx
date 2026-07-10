"use client";

// A persisted, server-friendly collapsible section for the org overview (OVR-4). Uses a native
// <details> so it works without JS and renders open/closed correctly on the server (no hydration
// flash): the page reads the collapsed-ids cookie and passes `defaultOpen`. On toggle we rewrite the
// cookie client-side so the choice survives the next visit. Collapse-only — no drag reordering.

import type { ReactNode } from "react";

export const OVERVIEW_COLLAPSE_COOKIE = "ascent_overview_collapsed";

/** Rewrite the comma-separated collapsed-ids cookie when a section is toggled. */
function persist(id: string, collapsed: boolean) {
  const m = document.cookie.match(/(?:^|; )ascent_overview_collapsed=([^;]*)/);
  const ids = new Set(m && m[1] ? decodeURIComponent(m[1]).split(",").filter(Boolean) : []);
  if (collapsed) ids.add(id);
  else ids.delete(id);
  document.cookie = `${OVERVIEW_COLLAPSE_COOKIE}=${encodeURIComponent([...ids].join(","))}; path=/; max-age=31536000; samesite=lax`;
}

export function CollapsibleSection({
  id,
  title,
  defaultOpen = true,
  children,
}: {
  id: string;
  title: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details
      open={defaultOpen}
      onToggle={(e) => persist(id, !(e.currentTarget as HTMLDetailsElement).open)}
      className="group"
    >
      <summary className="flex cursor-pointer list-none items-center gap-2 font-mono text-sm uppercase tracking-widest text-slate-500 transition hover:text-slate-300 [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="inline-block text-slate-600 transition-transform group-open:rotate-90">
          ›
        </span>
        {title}
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  );
}
