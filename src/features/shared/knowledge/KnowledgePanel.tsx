"use client";

// PROTOTYPE SWITCHER — throwaway. Remove when a direction wins (see /prototype Phase 5); the winner
// then renders directly from KnowledgeTab and this file is deleted along with the loser.
//
// Client only because the tab strip holds state. Both directions receive the identical `view`, so
// neither can win by having better data — only by being the better read of the same facts.

import { useState } from "react";

import { Kicker } from "@/components/ui";
import { chipButtonClass } from "@/components/ui";
import type { KnowledgeView } from "@/lib/org/knowledge-shape";

import { KnowledgeLedger } from "./KnowledgeLedger";
import { KnowledgeShelf } from "./KnowledgeShelf";

type Direction = "ledger" | "shelf";

const DIRECTIONS: { id: Direction; label: string; blurb: string }[] = [
  { id: "ledger", label: "Ledger", blurb: "How much, in columns that align" },
  { id: "shelf", label: "Shelf", blurb: "What kind, and how evenly built" },
];

export function KnowledgePanel({ view }: { view: KnowledgeView }) {
  const [direction, setDirection] = useState<Direction>("ledger");

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        {DIRECTIONS.map((d) => (
          <button
            key={d.id}
            type="button"
            onClick={() => setDirection(d.id)}
            // chipButtonClass has no selected state (ChipState is idle/success/danger), so the
            // selection is the repo's accent treatment layered on the idle chip via `extra`.
            className={chipButtonClass(
              "idle",
              direction === d.id ? "border-accent bg-accent/10 text-white" : "",
            )}
            title={d.blurb}
          >
            {d.label}
          </button>
        ))}
        <span className="font-mono text-xs text-slate-600">{DIRECTIONS.find((d) => d.id === direction)?.blurb}</span>
      </div>

      {view.provisional ? (
        <div className="rounded-2xl border border-divider bg-ink px-5 py-4">
          <Kicker tone="muted">Preview</Kicker>
          <p className="mt-1 text-sm text-slate-400">
            These counts are the registry&apos;s real contents read once by hand, not an index pass — the
            indexer walks skills, practices and memory today and does not parse{" "}
            <span className="font-mono text-xs text-slate-300">knowledge/**</span> yet. Shape is final; freshness is not.
          </p>
        </div>
      ) : null}

      {direction === "ledger" ? <KnowledgeLedger view={view} /> : <KnowledgeShelf view={view} />}
    </div>
  );
}
