"use client";

// THE LEDGER'S SECTION HEADER — the explanation lives on the title, not on the page.
//
// WHY. Every section here shipped with a two-line paragraph under its heading, and the page is a
// stack of six sections: on an org whose runner has not run yet, five-sixths of the screen was prose
// the operator had already read, and the one thing they came for — the runs — started below the fold.
// The sentences are true and worth keeping, so they move where the brand already puts a standing
// explanation: an `InfoTip` on the label it belongs to (see that component's own note). The page keeps
// the words and loses the wall.
//
// WHAT STAYS ON THE PAGE. Three classes of text are NOT eligible for the tip and are never moved into
// one: a WARNING or a consequence the operator must read before acting, a FAILED READ ("could not read
// the directions" — an empty list and an unreadable one must never look alike), and an EMPTY STATE
// that names the next action. What moves is only the standing description of what a section is.
//
// `count` is the other half of the trade: with the paragraph gone, the header row has space for the
// figure the section is about, so the heading itself carries data instead of introducing it.

import { InfoTip } from "@/components/ui";
import { SectionHeader } from "@/components/org/shared/ui";

export function LedgerSectionHeader({
  id,
  title,
  about,
  count,
  right,
}: {
  /** The heading's own id — the section's `aria-labelledby` points at it. */
  id: string;
  title: string;
  /** The standing explanation. One or two sentences; never a warning, never an error. */
  about: React.ReactNode;
  /** The section's headline figure ("58 runs", "2 waiting"), rendered at the end of the header row. */
  count?: string | null;
  /** An action or status for the header row. Takes the slot when both are given. */
  right?: React.ReactNode;
}) {
  return (
    <SectionHeader
      title={
        <span className="inline-flex items-center gap-2">
          <span id={id}>{title}</span>
          <InfoTip label={title.toLowerCase()}>{about}</InfoTip>
        </span>
      }
      right={right ?? (count ? <span className="font-mono type-mono-sm text-slate-500">{count}</span> : undefined)}
    />
  );
}
