"use client";

// The Follow-ups ledger — item-first (the direction that won the 2026-08-17 prototype round; the
// repo-first "Sessions" variant and the switcher were deleted). One dense table of every follow-up
// in the fleet, biggest projected gain first; tick rows across any repos; a sticky bulk bar totals
// the batch and offers the three batch actions — hand off (generate the fix prompt), resolve by
// hand, dismiss by hand. A row expands in place for the rationale, the explore questions, its
// timeline, and the per-row actions.
//
// Three things ported from the tabs this ledger replaced, because they fit a mass-scan world:
//   - the ORG-WIDE tag + filter (Plan's gap decomposition): a dimension open in ≥ half the fleet is
//     a practice to fix once, not N tickets — the tag says so on the row, the filter isolates them;
//   - BULK resolve / dismiss (Backlog's bulk bar): 10-20 rows per repo are not closed one at a time;
//   - the row TIMELINE (Backlog's history): the archive must say HOW a row closed.

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { OrgTable, SectionEmpty } from "@/components/org/shared/ui";
import { reportPermalink, timeAgo } from "@/lib/ui";
import { ImpactEffort, Points, RowActions, StatusPill } from "./FollowupChips";
import { FollowupHistory } from "./FollowupHistory";
import { FollowupsFilterBar } from "./FollowupsFilterBar";
import { FollowupsPromptModal } from "./FollowupsPromptModal";
import {
  applyFilters,
  dimensionSpread,
  emptyFilters,
  patchStatuses,
  summarizeSelection,
  type DimensionSpread,
  type FollowUpFilters,
  type FollowUpRow,
} from "./followupsModel";

export function FollowupsWorklist({ org, rows, initialDim }: { org: string; rows: FollowUpRow[]; initialDim?: string }) {
  const router = useRouter();
  const [filters, setFilters] = useState<FollowUpFilters>(() => ({ ...emptyFilters(), dims: new Set(initialDim ? [initialDim] : []) }));
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<string | null>(null);
  const [promptFor, setPromptFor] = useState<FollowUpRow[] | null>(null);
  const [bulk, setBulk] = useState<"done" | "dismissed" | null>(null);

  const spread = useMemo(() => dimensionSpread(rows), [rows]);
  const shown = applyFilters(rows, filters, spread);
  const sel = summarizeSelection(rows, selected);
  const allShownSelected = shown.length > 0 && shown.every((r) => selected.has(r.id));
  const orgWideDims = [...spread.values()].filter((s) => s.orgWide).length;

  const toggle = (id: string) =>
    setSelected((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const toggleAllShown = () =>
    setSelected((s) => {
      const n = new Set(s);
      if (allShownSelected) shown.forEach((r) => n.delete(r.id));
      else shown.forEach((r) => n.add(r.id));
      return n;
    });
  const bulkStatus = async (status: "done" | "dismissed") => {
    setBulk(status);
    await patchStatuses(sel.picked.map((r) => r.id), status);
    setSelected(new Set());
    setBulk(null);
    router.refresh();
  };

  return (
    <div className="space-y-4">
      <FollowupsFilterBar rows={rows} filters={filters} onChange={setFilters} shown={shown.length} orgWideDims={orgWideDims} />

      {shown.length === 0 ? (
        <SectionEmpty>Nothing matches. Widen the filters, or switch to the resolved archive.</SectionEmpty>
      ) : (
        <OrgTable
          minWidth={880}
          caption="Follow-ups ledger"
          head={
            <tr className="text-left">
              <th className="w-8 px-3 py-2">
                <input type="checkbox" checked={allShownSelected} onChange={toggleAllShown} aria-label="Select all shown" className="accent-accent" />
              </th>
              <th className="px-3 py-2 font-normal">Repo</th>
              <th className="px-3 py-2 font-normal">Dim</th>
              <th className="px-3 py-2 font-normal">Gap</th>
              <th className="px-3 py-2 font-normal" title="impact · effort">I·E</th>
              <th className="px-3 py-2 text-right font-normal">+pts</th>
              <th className="px-3 py-2 font-normal">Status</th>
              <th className="px-3 py-2 text-right font-normal">Age</th>
            </tr>
          }
        >
          {shown.map((r) => (
            <RowPair
              key={r.id}
              r={r}
              spread={spread.get(r.dimId)}
              on={selected.has(r.id)}
              isOpen={expanded === r.id}
              onToggle={() => toggle(r.id)}
              onExpand={() => setExpanded(expanded === r.id ? null : r.id)}
              org={org}
            />
          ))}
        </OrgTable>
      )}

      {/* Sticky bulk bar — the batch's arithmetic and its three actions. Counts on every button, so
          "Dismiss 40" can never read as "Dismiss". */}
      {sel.count > 0 && (
        <div className="sticky bottom-3 z-10 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-accent/40 bg-surface-strong/95 px-4 py-2.5 shadow-2xl backdrop-blur">
          <span className="font-mono text-sm text-slate-200">
            <span className="font-bold tabular-nums">{sel.count}</span> selected · <span className="tabular-nums">{sel.repos}</span> repo{sel.repos === 1 ? "" : "s"} ·{" "}
            <span className="tabular-nums text-white">+{sel.points}</span> pts if all close
          </span>
          <button type="button" onClick={() => setSelected(new Set())} className="focus-ring font-mono text-xs uppercase tracking-widest text-slate-500 hover:text-white">
            clear
          </button>
          <span className="ml-auto flex items-center gap-2">
            <button type="button" onClick={() => bulkStatus("dismissed")} disabled={bulk !== null} className="focus-ring rounded-lg border border-divider px-3 py-1.5 font-mono text-xs text-slate-300 transition hover:border-accent hover:text-white disabled:opacity-50">
              {bulk === "dismissed" ? "Dismissing…" : `Dismiss ${sel.count}`}
            </button>
            <button type="button" onClick={() => bulkStatus("done")} disabled={bulk !== null} className="focus-ring rounded-lg border border-emerald-500/50 px-3 py-1.5 font-mono text-xs text-emerald-400 transition hover:bg-emerald-500/10 disabled:opacity-50">
              {bulk === "done" ? "Resolving…" : `Resolve ${sel.count}`}
            </button>
            <button type="button" onClick={() => setPromptFor(sel.picked)} disabled={bulk !== null} className="focus-ring rounded-lg bg-accent px-4 py-1.5 text-sm font-semibold text-on-accent transition hover:bg-accent-soft disabled:opacity-50">
              Generate fix prompt →
            </button>
          </span>
        </div>
      )}

      <FollowupsPromptModal org={org} items={promptFor} onClose={() => setPromptFor(null)} onHandedOff={() => setSelected(new Set())} />
    </div>
  );
}

function RowPair({
  r,
  spread,
  on,
  isOpen,
  onToggle,
  onExpand,
  org,
}: {
  r: FollowUpRow;
  spread?: DimensionSpread;
  on: boolean;
  isOpen: boolean;
  onToggle: () => void;
  onExpand: () => void;
  org: string;
}) {
  const closed = r.status === "done" || r.status === "dismissed";
  return (
    <>
      <tr className={`${on ? "bg-accent/5" : ""} ${closed ? "opacity-70" : ""}`}>
        <td className="px-3 py-1.5 align-top">
          <input type="checkbox" checked={on} onChange={onToggle} disabled={closed} aria-label={`Select ${r.title}`} className="accent-accent" />
        </td>
        <td className="px-3 py-1.5 align-top">
          <Link href={reportPermalink(r.repo, null, org)} className="focus-ring whitespace-nowrap rounded font-mono text-xs text-slate-400 hover:text-accent" title={r.repo}>
            {r.repoName}
          </Link>
        </td>
        <td className="px-3 py-1.5 align-top">
          <span className="whitespace-nowrap font-mono text-xs text-slate-400" title={r.dimLabel}>
            {r.dimId}
          </span>
          {spread?.orgWide && (
            <span
              className="ml-1.5 whitespace-nowrap rounded border border-amber-400/40 px-1 font-mono text-[10px] uppercase tracking-wider text-amber-300"
              title={`Open in ${spread.repos} of ${spread.of} repos — an org-wide gap: fix it once as a practice, copying whoever already nails it`}
            >
              org-wide {spread.repos}/{spread.of}
            </span>
          )}
        </td>
        <td className="px-3 py-1.5 align-top">
          <button type="button" onClick={onExpand} aria-expanded={isOpen} className="focus-ring text-left text-sm text-slate-100 hover:text-white">
            {r.title}
            {r.unlocks && <span className="ml-2 font-mono text-xs text-slate-500">→ {r.unlocks}</span>}
          </button>
        </td>
        <td className="px-3 py-1.5 align-top"><ImpactEffort r={r} /></td>
        <td className="px-3 py-1.5 text-right align-top"><Points n={r.projectedPoints} /></td>
        <td className="px-3 py-1.5 align-top"><StatusPill status={r.status} at={r.lastActivityAt} /></td>
        <td className="px-3 py-1.5 text-right align-top font-mono text-xs text-slate-500">{timeAgo(r.lastActivityAt)}</td>
      </tr>
      {isOpen && (
        <tr className="!bg-surface/30">
          <td />
          <td colSpan={7} className="px-3 pb-3 pt-1">
            {r.rationale && <p className="max-w-3xl text-sm text-slate-300">{r.rationale}</p>}
            {r.explore.length > 0 && (
              <ul className="mt-2 space-y-1 text-sm text-slate-400">
                {r.explore.map((q, i) => (
                  <li key={i} className="flex gap-2"><span className="select-none text-slate-600">→</span><span>{q}</span></li>
                ))}
              </ul>
            )}
            <div className="mt-2 flex items-center gap-4">
              <RowActions r={r} />
              {r.assigneeLogin && <span className="font-mono text-xs text-slate-500">owner {r.assigneeLogin}</span>}
              <span className="font-mono text-xs text-slate-600">id {r.id}</span>
            </div>
            <div className="mt-2 border-t border-divider pt-2">
              <FollowupHistory id={r.id} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
