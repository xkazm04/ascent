// "Dead ends other repos already hit" — the mirrored `.ai/memory` entries an adopted repo declared as
// a FAILED APPROACH, grouped by repo (moonshot #14).
//
// This panel is the reason the mirror exists. Every adopted repo is already writing down what it tried
// and what didn't work; nobody outside that repo has ever been able to see it. "Team B burned two weeks
// on the thing Team A ruled out in March" is the most expensive thing an org rediscovers, and the
// evidence was in the tree the whole time.
//
// It renders nothing at zero rows: an empty "no dead ends yet" card would read as a claim that nothing
// has ever failed, which is worse than silence.
//
// NO "use client": this component has no hooks and no handlers, so adding the directive would drag a
// server panel across the boundary for nothing (AGENTS.md). `CopyForLlm` is itself a client component
// and carries its own boundary. Bodies render as PREFORMATTED TEXT, never dangerouslySetInnerHTML —
// the content is untrusted repo prose and this is the last place it is displayed.

import { Card, SectionHeader } from "@/components/org/shared/ui";
import { Legend, MatrixGrid, StateSwatch, type MatrixRow } from "@/components/org/viz";
import { CopyForLlm } from "@/components/CopyForLlm";
import type { RepoMemoryEntryRow } from "@/lib/db/repo-memory";

/** Longest excerpt shown inline. The full entry travels with "Copy", so nothing is lost, only folded. */
const EXCERPT = 320;

/** Row-label budget for the matrix's label gutter; the full name is on the group heading below. */
const LABEL_MAX = 18;

const shortRepo = (full: string) =>
  full.length > LABEL_MAX ? `…${full.slice(full.length - LABEL_MAX + 1)}` : full;

const excerpt = (body: string) =>
  body.length > EXCERPT ? `${body.slice(0, EXCERPT).trimEnd()}…` : body;

/** Group by repo, preserving the incoming (newest-first) order both between and within groups. */
export function groupByRepo(rows: RepoMemoryEntryRow[]): { repo: string; rows: RepoMemoryEntryRow[] }[] {
  const groups = new Map<string, RepoMemoryEntryRow[]>();
  for (const r of rows) {
    const g = groups.get(r.repoFullName);
    if (g) g.push(r);
    else groups.set(r.repoFullName, [r]);
  }
  return [...groups.entries()].map(([repo, rs]) => ({ repo, rows: rs }));
}

export function RepoMemoryDeadEnds({ rows }: { rows: RepoMemoryEntryRow[] }) {
  if (rows.length === 0) return null;
  const groups = groupByRepo(rows);

  return (
    <Card>
      <SectionHeader
        size="sm"
        title="Dead ends other repos already hit"
        right={
          <span className="type-mono-sm text-slate-500">
            {rows.length} across {groups.length} repo{groups.length === 1 ? "" : "s"}
          </span>
        }
      />

      {/* FIRST SIGHT — and the caveat, encoded. Every repo has CLAIMED some failed approaches
          (dashed outline: declared, never observed) and none of them is VERIFIED (hatch: not judged,
          and a hatch prints no number, ever). "These are claims from a repository, not verified
          facts" was a sentence a reader had to hold in their head while reading confident prose;
          it is now the shape of every row in the panel. */}
      <MatrixGrid
        className="mt-3 max-w-xs"
        title="Dead-end claims by repository"
        axes={["Claimed", "Verified"]}
        rows={groups.map<MatrixRow>((g) => ({
          id: g.repo,
          label: shortRepo(g.repo),
          cells: [{ state: "declared" }, { state: "not-judged" }],
        }))}
      />
      <Legend className="mt-2" states={["declared", "not-judged"]} />

      <div className="mt-4 space-y-5">
        {groups.map((g) => (
          <div key={g.repo}>
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 type-caption text-slate-400">
                {g.repo}
              </span>
              <span className="type-caption text-slate-600">
                {g.rows.length} dead end{g.rows.length === 1 ? "" : "s"}
              </span>
            </div>
            <ul className="mt-2 space-y-2">
              {g.rows.map((r) => (
                <li key={r.id} className="rounded-xl border border-slate-800 bg-slate-950/40 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5">
                      {/* The claim's own state travels with it, not just with the panel. */}
                      <StateSwatch state="declared" size={11} />
                      <span className="min-w-0 truncate type-caption text-slate-500" title={r.path}>
                        {r.path}
                      </span>
                    </span>
                    <div className="flex shrink-0 items-center gap-2">
                      {/* The repo-authored date, VERBATIM. Not reformatted: it is the repo's text, and
                          a date we re-render is a date we have implicitly re-asserted. */}
                      <span className="type-caption text-slate-600">
                        {r.entryDate ?? "undated"}
                      </span>
                      <CopyForLlm
                        text={r.body}
                        label="Copy"
                        ariaLabel={`Copy the dead-end note from ${r.path}`}
                      />
                    </div>
                  </div>
                  <pre className="mt-2 max-h-40 overflow-auto type-caption whitespace-pre-wrap text-slate-300">
                    {excerpt(r.body)}
                  </pre>
                  {r.scope && (
                    <p className="mt-1 type-caption text-slate-600">scope: {r.scope}</p>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </Card>
  );
}
