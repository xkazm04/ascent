// The privacy ledger as MATRIX ROWS — pure, so the guarantee is testable without a DOM.
//
// Two axes, and the second one is the whole point:
//
//   "Sent on share"  measured = this leaves the machine when you run `mentor share`; void = nothing
//                    is sent.
//   "Your switch"    decided  = a person decides this, and can decide otherwise; void = there is no
//                    control, here or anywhere. THAT is the demoted sentence "never leaves your
//                    machine — not a setting", drawn instead of promised.
//
// A never-sent row is void on BOTH axes, and it is void because `careNeverSent` says so — NOT
// because the server sent `shared: false`. A ledger row claiming `shared: true` for transcripts
// still renders as two voids: the UI has no path that can put a mark there. `careLedgerRows.test.ts`
// seeds exactly that violation, so the invariant cannot quietly stop biting.

import type { MatrixCell, MatrixRow } from "@/components/org/viz";
import { careNeverSent, type DeveloperView } from "@/lib/org/developer-view";

// Axis headers are drawn inside a 46-unit column at 9px mono/uppercase/wide-tracked, so they must
// be SHORT or the kit clips them. The full reading — "sent when you run mentor share" / "a switch
// you control" — lives in the ledger's legend, beside the mark it names.
export const CARE_LEDGER_AXES = ["Sent", "Switch"];

/**
 * Short row labels for the matrix's label gutter — the full field name rides in the generated cell
 * `<title>`. A 104-unit gutter cannot hold "Prompts, diffs, file contents"; an unknown field falls
 * back to its own name rather than being dropped.
 */
const SHORT_LABEL: Record<string, string> = {
  "Session counts (30d)": "Session counts",
  "Plan-mode ratio": "Plan mode",
  "Tests-before-commit ratio": "Tests ratio",
  "Skill invokes": "Skill invokes",
  "Moves kept / dropped": "Moves",
  "Transcript text": "Transcripts",
  "Prompts, diffs, file contents": "Prompts, diffs",
  "Per-person rows in org mode": "Who you are",
};

const VOID: MatrixCell = { state: "missing" };
const SENT: MatrixCell = { state: "measured" };
const SWITCH: MatrixCell = { state: "decided" };

function rowId(field: string): string {
  return field.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function careLedgerRows(sharing: DeveloperView["setup"]["sharing"]): MatrixRow[] {
  return sharing.map((row) => ({
    id: rowId(row.field),
    label: SHORT_LABEL[row.field] ?? row.field,
    // The locked branch reads ONLY `careNeverSent` — `row.shared` is deliberately not consulted.
    cells: careNeverSent(row) ? [VOID, VOID] : [row.shared ? SENT : VOID, SWITCH],
  }));
}

/** How many rows can never be sent — the count the ledger's kicker states as a unit. */
export function careNeverSentCount(sharing: DeveloperView["setup"]["sharing"]): number {
  return sharing.filter(careNeverSent).length;
}
