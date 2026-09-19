"use client";

// One row of the tech-stacks rail: the top line (swatch + full-width name + score) is the show/hide
// toggle; the posture + repos/brief links sit on their own line beneath, so a long name (both
// backends read "Backend · …") never truncates away its language.
//
// The score slot is where an absence used to be printed as a number. A stack with no scanned repo
// has `avgOverall` 0 — `summarizeScopedRepos` averages an empty array — and this row rendered that 0
// in `scoreHex(0)`, i.e. the red of the worst possible fleet. It now renders the `not-judged` swatch
// instead, and `rendersValue(state)` is the guard that makes printing a numeral there impossible
// rather than merely discouraged.

import Link from "next/link";
import { StateSwatch, rendersValue, stateTitle } from "@/components/org/viz";
import { postureLabel } from "@/components/org/shared/ui";
import type { SegmentSummary } from "@/lib/db";
import { scoreHex } from "@/lib/ui";
import { stackState } from "@/features/standing/tech-stacks/stackMeasure";
import { buildUrl, orgTabHref } from "@/lib/org/orgTabs";

/** repositories tab href with a `?stack=`/scope query appended, whichever separator the base needs. */
function repositoriesHref(org: string, query: string): string {
  const base = orgTabHref(org, "repositories");
  if (!query) return base;
  return `${base}${base.includes("?") ? "&" : "?"}${query.replace(/^\?/, "")}`;
}

export function StackRow({ org, s, color, scopeQ, active, noun, onToggle, onHover, onLeave }: {
  org: string; s: SegmentSummary; color: string; scopeQ: (id: string | null) => string; active: boolean;
  /** Entity noun, for the affordance's own title ("hover a stack to isolate it"). */
  noun: string;
  onToggle: () => void; onHover: () => void; onLeave: () => void;
}) {
  const state = stackState(s);
  return (
    <li
      className={`rounded-lg px-2 py-1.5 transition hover:bg-surface/60 ${active ? "" : "opacity-45"}`}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
    >
      <button
        type="button"
        onClick={onToggle}
        onFocus={onHover}
        onBlur={onLeave}
        aria-pressed={active}
        title={`${active ? "Hide" : "Show"} ${s.name} · hover or focus to isolate this ${noun} in the radar`}
        className="focus-ring flex w-full items-center gap-2.5 text-left"
      >
        <span
          aria-hidden
          className="h-3 w-3 shrink-0 rounded-sm border-2"
          style={{ borderColor: color, backgroundColor: active ? color : "transparent" }}
        />
        <span className="min-w-0 flex-1 truncate font-medium text-white">{s.name}</span>
        {rendersValue(state) && s.avgOverall !== null ? (
          <span className="shrink-0 font-mono type-body font-bold tabular-nums" style={{ color: scoreHex(s.avgOverall) }}>
            {s.avgOverall}
          </span>
        ) : (
          <span className="shrink-0" title={stateTitle(state, s.name)}>
            <StateSwatch state={state} />
          </span>
        )}
      </button>
      <div className="mt-1 flex items-center justify-between pl-[1.375rem]">
        <span className="type-caption text-slate-500">
          {rendersValue(state) ? postureLabel(s.posture) : `${s.repoCount} repos · never scanned`}
        </span>
        <span className="type-mono-sm">
          <Link href={repositoriesHref(org, scopeQ(s.id))} className="text-accent transition hover:text-white">repos</Link>
          <span className="text-slate-700"> · </span>
          <Link href={buildUrl(org, { tab: "executive", stack: s.id ?? null }, "")} className="text-accent transition hover:text-white">brief</Link>
        </span>
      </div>
    </li>
  );
}
