"use client";

// The journal — weekly retro lines, kept by ascent across machines and reinstalls. That persistence IS
// the argument: a local skill's `journal.jsonl` dies with the laptop.

import { SectionEmpty } from "@/components/org/shared/ui";
import { CareCommand } from "./CareBits";
import { timeAgo } from "@/lib/ui";
import type { DeveloperView } from "@/lib/org/developer-view";

const KIND_LABEL: Record<string, string> = { retro: "session retro", weekly: "weekly", move: "move closed" };

function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function CareJournal({ journal }: { journal: DeveloperView["journal"] }) {
  if (journal.length === 0) {
    return (
      <SectionEmpty>
        No journal yet. <CareCommand command="npx ascent mentor retro" /> writes a line per session on your machine;
        sharing keeps that history here so it survives a new laptop.
      </SectionEmpty>
    );
  }

  return (
    <div className="mt-3 divide-y divide-divider border-y border-divider">
      {journal.map((e, i) => (
        <article key={`${e.at}-${i}`} className="grid gap-1 py-3 sm:grid-cols-[10rem_1fr] sm:gap-4">
          <div className="type-label tracking-widest text-slate-500">
            {shortDate(e.at)} · {timeAgo(e.at)}
            {e.kind ? <div className="text-slate-600">{KIND_LABEL[e.kind] ?? e.kind}</div> : null}
          </div>
          <p className="type-body text-slate-200">{e.line}</p>
        </article>
      ))}
    </div>
  );
}
