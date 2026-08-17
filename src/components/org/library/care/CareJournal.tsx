"use client";

// The journal — weekly retro lines, kept by ascent across machines and reinstalls. That persistence IS
// the argument: a local skill's `journal.jsonl` dies with the laptop.
//
// `entries` layout is the dated editorial list (Companion). `spine` is a vertical timeline with the
// dates on a rule (Climb: the record of the climb so far).

import { SectionEmpty } from "@/components/org/shared/ui";
import { timeAgo } from "@/lib/ui";
import type { CarePersonalView } from "@/lib/org/care-view";

const KIND_LABEL: Record<string, string> = { retro: "session retro", weekly: "weekly", move: "move closed" };

function shortDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function CareJournal({
  journal,
  layout = "entries",
  limit,
}: {
  journal: CarePersonalView["journal"];
  layout?: "entries" | "spine";
  limit?: number;
}) {
  const rows = limit ? journal.slice(0, limit) : journal;
  if (rows.length === 0) {
    return (
      <SectionEmpty>
        No journal yet. `npx ascent mentor retro` writes a line per session on your machine; sharing keeps that
        history here so it survives a new laptop.
      </SectionEmpty>
    );
  }

  if (layout === "spine") {
    return (
      <ol className="mt-3 space-y-4 border-l border-divider pl-5">
        {rows.map((e, i) => (
          <li key={`${e.at}-${i}`} className="relative">
            <span className="absolute -left-[1.4rem] top-2 h-1.5 w-1.5 rounded-full bg-accent" aria-hidden />
            <div className="font-mono text-xs uppercase tracking-widest text-slate-500">
              {shortDate(e.at)} · {e.kind ? KIND_LABEL[e.kind] ?? e.kind : "note"}
            </div>
            <p className="mt-0.5 text-base text-slate-200">{e.line}</p>
          </li>
        ))}
      </ol>
    );
  }

  return (
    <div className="mt-3 divide-y divide-divider border-y border-divider">
      {rows.map((e, i) => (
        <article key={`${e.at}-${i}`} className="grid gap-1 py-3 sm:grid-cols-[10rem_1fr] sm:gap-4">
          <div className="font-mono text-xs uppercase tracking-widest text-slate-500">
            {shortDate(e.at)} · {timeAgo(e.at)}
            {e.kind ? <div className="text-slate-600">{KIND_LABEL[e.kind] ?? e.kind}</div> : null}
          </div>
          <p className="text-base text-slate-200">{e.line}</p>
        </article>
      ))}
    </div>
  );
}
