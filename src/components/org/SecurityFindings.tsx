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
}: {
  org: string;
  rows: SecurityFindingInput[];
  decisions: DecisionMap;
}) {
  const findings = securityFindings(rows);
  if (findings.length === 0) return null;

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
      <SectionHeader
        title="Findings to decide"
        description={
          <>
            Every failing control, one row each.{" "}
            <span className="text-slate-300">
              Accept the work, or dismiss with a reason: the reason reaches connected agents and the next scan.
            </span>{" "}
            <span className="font-mono text-sm text-slate-500">
              ({openCount} open · {settledCount} settled)
            </span>
          </>
        }
      />
      <SecurityFindingsTable org={org} rows={tableRows} />
    </div>
  );
}
