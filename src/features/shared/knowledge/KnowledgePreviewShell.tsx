"use client";

// The Knowledge base tab's dev-only preview — REACT STATE, never a search param (same rule as
// `RegistryPreviewShell`): a shaped fleet must never become a shareable URL that reads as this org's.
//
// Offered ONLY in development (`registryPreviewEnabled()` at the KnowledgeTab call site) and only
// while the real status is `unmapped` — the state that has nothing of the org's own to be confused
// with. The real notice is the default; the shaped fleet is one click away and stamped as a preview,
// and every action inside it is inert (`useKnowledgeActions` in preview mode).

import { useState } from "react";
import { Kicker } from "@/components/ui";
import type { KnowledgeView } from "@/lib/org/knowledge-shape";
import { KnowledgeLoom } from "./KnowledgeLoom";

const CHIP = "focus-ring rounded-md px-2.5 py-1.5 type-mono-sm transition-colors";

export function KnowledgePreviewShell({ slug, fixture, children }: { slug: string; fixture: KnowledgeView; children: React.ReactNode }) {
  const [shaped, setShaped] = useState(false);
  return (
    <div className="space-y-6">
      <div className="rounded-2xl border border-divider bg-surface/40 px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Kicker tone="muted">Preview · dev only</Kicker>
          <div className="flex gap-1.5" role="tablist" aria-label="Knowledge base preview">
            <button type="button" role="tab" aria-selected={!shaped} className={`${CHIP} ${!shaped ? "bg-accent/15 text-accent" : "text-slate-400 hover:text-white"}`} onClick={() => setShaped(false)}>
              Real (unmapped)
            </button>
            <button type="button" role="tab" aria-selected={shaped} className={`${CHIP} ${shaped ? "bg-accent/15 text-accent" : "text-slate-400 hover:text-white"}`} onClick={() => setShaped(true)}>
              Shaped fleet
            </button>
          </div>
          {shaped ? (
            <span className="type-caption text-slate-500">
              The registry&rsquo;s real software-engineering taxonomy (52 of 214 subjects) over an eight-repo fleet that reaches every cell state. Nothing here is this org&rsquo;s data; actions are inert.
            </span>
          ) : null}
        </div>
      </div>
      {shaped ? <KnowledgeLoom view={fixture} slug={slug} preview /> : children}
    </div>
  );
}
