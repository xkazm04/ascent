"use client";

// The findings ledger's client half: filters + one dense table, replacing the unbounded <ul> this
// section used to be.
//
// Why a table. One finding is one FAILING CONTROL on one repo, so the list is `repos × failing
// checks` — a 40-repo fleet with six weak controls each is 240 stacked cards, and the section ran to
// tens of screens with no way to reach a specific repo. Nothing about a finding needs a card: it is
// four short facts and one control, which is a row.
//
// Deliberately modelled on the Follow-ups worklist (src/components/org/followups/FollowupsWorklist.tsx),
// because that surface already solved this exact problem for a list that grows with the fleet, and two
// "here is every open item, decide about it" screens should not read as two different products. The
// shared pieces, in order of how much they matter:
//   - `OrgTable` — one scroll wrapper, hairline chrome, sticky-ish header styling, `minWidth` so a wide
//     table scrolls horizontally instead of crushing its columns.
//   - `FilterMenu` — the fleet's multi-select dropdown, options built from the FULL row set so a menu
//     never shrinks as you filter, plus a search box and an "N of M · clear filters" readout.
//   - expand-in-place: the row is the summary, the detail prose lands in a second <tr> underneath, so
//     the default view stays one line per finding.
// What is NOT ported: bulk selection. A decision carries a rationale that reaches Shared Org Memory
// and the next scan's prompt (see DecisionControl), so "dismiss 40" would mean forty findings sharing
// one reason — the opposite of the point.

import { useMemo, useState } from "react";
import { OrgTable, SectionEmpty } from "@/components/org/shared/ui";
import { FilterMenu, type FilterOption } from "@/features/standing/overview/FilterMenu";
import { DecisionControl, type DecisionStatusUi } from "@/components/org/DecisionControl";

/** One finding, already joined to whatever decision stands against it (the server does the join). */
export interface SecurityFindingRow {
  itemKey: string;
  repo: string;
  /** The control's own name — the repo lives in its own column. */
  subject: string;
  /** The full title, as persisted onto the decision. */
  title: string;
  detail: string;
  status: DecisionStatusUi;
  rationale?: string;
  decidedBy?: string | null;
}

const STATUS_LABEL: Record<DecisionStatusUi, string> = {
  open: "open",
  accepted: "accepted",
  dismissed: "dismissed",
  snoozed: "snoozed",
};

const STATUS_TONE: Record<DecisionStatusUi, string> = {
  open: "border-amber-500/40 text-amber-300",
  accepted: "border-emerald-500/40 text-emerald-300",
  dismissed: "border-slate-600 text-slate-400",
  snoozed: "border-sky-500/40 text-sky-300",
};

/** How many rows render before the "show the rest" button. The cap is the whole point of the redesign:
 *  a fleet-sized findings list must not paint hundreds of DOM rows nobody scrolled to. */
const PAGE = 25;

export function SecurityFindingsTable({ org, rows }: { org: string; rows: SecurityFindingRow[] }) {
  const [repos, setRepos] = useState<Set<string>>(new Set());
  const [statuses, setStatuses] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE);

  // Options come from the FULL row set, so a dropdown never shrinks as you filter (same contract as
  // FollowupsFilterBar).
  const repoOpts: FilterOption[] = useMemo(
    () => [...new Set(rows.map((r) => r.repo))].sort().map((v) => ({ value: v, label: v })),
    [rows],
  );
  const statusOpts: FilterOption[] = useMemo(
    () => [...new Set(rows.map((r) => r.status))].map((v) => ({ value: v, label: STATUS_LABEL[v] })),
    [rows],
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter(
      (r) =>
        (repos.size === 0 || repos.has(r.repo)) &&
        (statuses.size === 0 || statuses.has(r.status)) &&
        (!q || r.repo.toLowerCase().includes(q) || r.subject.toLowerCase().includes(q) || r.detail.toLowerCase().includes(q)),
    );
  }, [rows, repos, statuses, query]);

  const active = repos.size > 0 || statuses.size > 0 || query.trim() !== "";
  const clearAll = () => {
    setRepos(new Set());
    setStatuses(new Set());
    setQuery("");
  };
  // Any filter change re-opens the window at page one — otherwise a narrowed set could inherit a
  // limit larger than itself and the "show the rest" button would linger with nothing to show.
  const withReset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setLimit(PAGE);
  };
  const toggle = (cur: Set<string>, set: (s: Set<string>) => void) =>
    withReset<string>((v) => {
      const next = new Set(cur);
      if (next.has(v)) next.delete(v);
      else next.add(v);
      set(next);
    });

  const visible = shown.slice(0, limit);

  return (
    <div className="mt-3 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <FilterMenu label="Repo" options={repoOpts} selected={repos} onToggle={toggle(repos, setRepos)} onClear={() => { setRepos(new Set()); setLimit(PAGE); }} />
        <FilterMenu label="Status" options={statusOpts} selected={statuses} onToggle={toggle(statuses, setStatuses)} onClear={() => { setStatuses(new Set()); setLimit(PAGE); }} />
        <input
          type="search"
          value={query}
          onChange={(e) => withReset(setQuery)(e.target.value)}
          placeholder="Search findings…"
          aria-label="Search security findings"
          className="focus-ring w-44 rounded-lg border border-divider bg-ink px-2.5 py-1.5 font-mono text-xs text-slate-200 placeholder:text-slate-600 focus:border-accent"
        />
        <span className="ml-auto font-mono text-xs text-slate-500">
          {shown.length} of {rows.length}
          {active && (
            <>
              {" · "}
              <button type="button" onClick={clearAll} className="focus-ring rounded text-accent hover:text-white">
                clear filters
              </button>
            </>
          )}
        </span>
      </div>

      {shown.length === 0 ? (
        <SectionEmpty>Nothing matches. Widen the filters.</SectionEmpty>
      ) : (
        <>
          <OrgTable
            minWidth={760}
            caption="Security findings to decide"
            head={
              <tr className="text-left">
                <th className="px-3 py-2 font-normal">Repo</th>
                <th className="px-3 py-2 font-normal">Control</th>
                <th className="px-3 py-2 font-normal">Status</th>
                <th className="px-3 py-2 text-right font-normal">Decide</th>
              </tr>
            }
          >
            {visible.map((f) => (
              <FindingRow
                key={f.itemKey}
                org={org}
                f={f}
                isOpen={expanded === f.itemKey}
                onExpand={() => setExpanded(expanded === f.itemKey ? null : f.itemKey)}
              />
            ))}
          </OrgTable>
          {shown.length > visible.length && (
            <button
              type="button"
              onClick={() => setLimit((n) => n + PAGE)}
              className="focus-ring w-full rounded-lg border border-divider py-2 font-mono text-xs text-slate-400 transition hover:border-accent hover:text-white"
            >
              show {Math.min(PAGE, shown.length - visible.length)} more · {shown.length - visible.length} remaining
            </button>
          )}
        </>
      )}
    </div>
  );
}

function FindingRow({
  org,
  f,
  isOpen,
  onExpand,
}: {
  org: string;
  f: SecurityFindingRow;
  isOpen: boolean;
  onExpand: () => void;
}) {
  const settled = f.status !== "open";
  return (
    <>
      <tr className={settled ? "opacity-60" : ""}>
        <td className="px-3 py-1.5 align-top">
          <span className="whitespace-nowrap font-mono text-xs text-slate-400" title={f.repo}>
            {f.repo}
          </span>
        </td>
        <td className="px-3 py-1.5 align-top">
          <button type="button" onClick={onExpand} aria-expanded={isOpen} className="focus-ring text-left text-sm text-slate-100 hover:text-white">
            {f.subject}
          </button>
        </td>
        <td className="px-3 py-1.5 align-top">
          <span className={`inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 font-mono text-xs ${STATUS_TONE[f.status]}`}>
            {STATUS_LABEL[f.status]}
          </span>
        </td>
        <td className="px-3 py-1.5 align-top">
          <div className="flex justify-end">
            <DecisionControl
              org={org}
              module="security"
              itemKey={f.itemKey}
              title={f.title}
              status={f.status}
              rationale={f.rationale}
              decidedBy={f.decidedBy}
            />
          </div>
        </td>
      </tr>
      {isOpen && (
        <tr className="!bg-surface/30">
          <td />
          <td colSpan={3} className="px-3 pb-3 pt-1">
            <p className="max-w-3xl text-sm text-slate-300">{f.detail}</p>
          </td>
        </tr>
      )}
    </>
  );
}
