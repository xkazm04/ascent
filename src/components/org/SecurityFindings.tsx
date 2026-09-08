// The security risk register's follow-ups, promoted to decisions.
//
// The register grid above says WHICH controls each repo fails; this says what you're going to do about
// it. Every failing check (score < 7) is one finding, keyed on the repo + the check's stable id, so a
// decision survives re-scans and re-wordings of the risk copy. Accepting or dismissing a finding drops
// it out of the org rail's Security badge and writes the rationale into Shared Org Memory, where the
// next scan's prompt and any connected agent will read it.
//
// Deliberately a separate section rather than a control inside the grid: the grid is a dense 0–10
// matrix optimized for scanning coverage at a glance, and hanging buttons in its cells would wreck
// that.
//
// SERVER half. It does the decision join and the ordering — both cheap, both better done once here
// than in every client render — and hands plain rows to SecurityFindingsTable, which owns the filters,
// the row cap and the expand state. That table replaced an unbounded <ul> (one card per finding): the
// list is `repos × failing checks`, so a mid-sized fleet turned this section into tens of screens with
// no way to reach a specific repo. See SecurityFindingsTable for what it borrows from the Follow-ups
// worklist and why.

import { SectionHeader } from "@/components/org/shared/ui";
import { StateSwatch, stateTitle } from "@/components/org/viz";
import { SecurityFindingsTable, type SecurityFindingRow } from "@/components/org/SecurityFindingsTable";
import { securityFindings, type SecurityFindingInput } from "@/lib/org/findings";
import { isOpen, type DecisionMap } from "@/lib/org/decision-map";

/** Settled findings sink below the open ones, in a stable order, so the top of the table is always the
 *  work still awaiting a call. Within a bucket: by repo, then by control name. */
const STATUS_RANK: Record<SecurityFindingRow["status"], number> = { open: 0, snoozed: 1, accepted: 2, dismissed: 3 };

export function SecurityFindings({
  org,
  rows,
  decisions,
  scopeNote,
}: {
  org: string;
  rows: SecurityFindingInput[];
  decisions: DecisionMap;
  /**
   * A visible sentence about where a decision made here LANDS, rendered under the table. It lives on
   * this component rather than at the call site so its render condition is the section's own: a
   * caveat about deciding must not appear on a page with nothing to decide, which is exactly what a
   * sibling <p> in the caller would have done.
   */
  scopeNote?: string;
}) {
  const findings = securityFindings(rows);

  // THE SILENT HALF OF THIS LEDGER. `securityFindings` mints a finding only from a check with a
  // NUMERIC score below the fail line — a control that produced no grade is skipped, correctly (an
  // absence is not a finding). The cost is that "4 findings to decide" quietly implies the other
  // controls were judged and were fine. Count the unjudged ones and say so on the surface, so the
  // number above is read as "4 of what we could judge", not "4 problems in the fleet".
  const unjudged = rows.reduce((n, r) => n + r.checks.filter((c) => c.score === null).length, 0);
  const unjudgedRepos = rows.filter((r) => r.checks.some((c) => c.score === null)).length;
  if (findings.length === 0 && unjudged === 0) return null;

  const openCount = findings.filter((f) => isOpen(decisions, f.itemKey)).length;
  const settledCount = findings.length - openCount;

  const tableRows: SecurityFindingRow[] = findings
    .map((f) => {
      const d = decisions[f.itemKey];
      return {
        itemKey: f.itemKey,
        repo: f.repo,
        // securityFindings always sets `subject`; the fallback keeps the type honest for any future
        // caller that passes findings from a builder which doesn't.
        subject: f.subject ?? f.title,
        title: f.title,
        detail: f.detail,
        status: isOpen(decisions, f.itemKey) ? ("open" as const) : d!.status,
        rationale: d?.rationale,
        decidedBy: d?.decidedBy,
      };
    })
    .sort(
      (a, b) =>
        STATUS_RANK[a.status] - STATUS_RANK[b.status] ||
        a.repo.localeCompare(b.repo) ||
        a.subject.localeCompare(b.subject),
    );

  return (
    <div className="mt-8">
      {/* §3: the description is a unit line, not a lede. "Every failing control, one row each" named
          the table the reader is looking at; "the reason reaches connected agents and the next scan"
          is already disclosed at the point of action — DecisionControl's rationale field carries the
          placeholder "Why is this not a problem here? (agents will read this)". */}
      <SectionHeader
        title="Findings to decide"
        description={
          <span className="type-mono-sm text-slate-500">
            {openCount} open · {settledCount} settled
          </span>
        }
      />
      {unjudged > 0 && (
        // KEPT VISIBLE, not folded into a tooltip: it is the one sentence that stops the count above
        // from being read as the whole of the fleet's security posture.
        <p
          className="mt-2 inline-flex items-center gap-2 rounded-lg border border-divider bg-surface-strong/40 px-3 py-1.5 type-body-sm text-slate-300"
          title={stateTitle("not-judged", `${unjudged} controls`)}
        >
          <StateSwatch state="not-judged" size={14} />
          <span>
            <strong className="tabular-nums text-slate-200">{unjudged}</strong> control
            {unjudged === 1 ? "" : "s"} across {unjudgedRepos} repo{unjudgedRepos === 1 ? "" : "s"} produced no grade
            and so appear in no row below. Absence of a finding is not a pass.
          </span>
        </p>
      )}
      {findings.length > 0 && <SecurityFindingsTable org={org} rows={tableRows} />}
      {scopeNote && <p className="mt-3 type-body-sm text-slate-400">{scopeNote}</p>}
    </div>
  );
}
