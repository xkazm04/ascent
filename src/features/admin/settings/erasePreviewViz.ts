// The erasure blast radius, as a matrix + the family count list.
//
// The dialog's prose manifest STAYS (a destructive compliance action explains itself before the user
// acts; docs/ORG-UX-REDESIGN.md §2.1 and §4 both leave those alone). This is the picture above it, and
// it earns its place by drawing the one thing the manifest needs three sentences and a doc comment to
// establish: under `includeAudit`, the audit trail appears in BOTH columns, because redaction destroys
// the identities and keeps the account of what happened. A reader can see that in one glance and
// cannot mis-hold it, which is not true of "a row appears in both, because that is what redaction
// does."
//
// The voids do the other half. Settings and the tenant are never in the Erased column. The scan graph
// is not the whole radius: loop, Athena, memory, registry, governance and secrets die too, and they
// are drawn as erased rather than left for the operator to infer from three headline numbers.
//
// Pure: no React, no hooks. The kit types are `import type`. Count rows whose body omitted the field
// are omitted — a missing counter is not a measured 0.

import type { MatrixRow, VizState } from "@/components/org/viz";
import type { AuditDisposition } from "./eraseTotals";

/** Erased permanently · kept untouched — the manifest's own two headings. */
export const ERASE_AXES = ["Erased", "Kept"] as const;

export type EraseBlastRow = { label: string; value: number; hint?: string };
export type EraseBlastGroup = { id: string; title: string; rows: EraseBlastRow[] };

/** key, label, group — labels fit the count list; groups collapse when only one row is present. */
const BLAST: readonly [string, string, string][] = [
  ["scansDeleted", "Scans", "Scan graph"],
  ["dimensionsDeleted", "Dimension rows", "Scan graph"],
  ["recommendationsDeleted", "Recommendations", "Scan graph"],
  ["recommendationEventsDeleted", "Recommendation events", "Scan graph"],
  ["digestsDeleted", "Compacted digests", "Scan graph"],
  ["reposProcessed", "Repositories", "Scope"],
  ["loopRunsDeleted", "Loop runs", "Improvement loop"],
  ["loopLanesDeleted", "Loop lanes", "Improvement loop"],
  ["laneOutcomesDeleted", "Lane outcomes", "Improvement loop"],
  ["athenaThreadsDeleted", "Athena threads", "Athena"],
  ["athenaTurnsDeleted", "Athena turns", "Athena"],
  ["athenaProposalsDeleted", "Athena proposals", "Athena"],
  ["athenaIdentityDeleted", "Athena identity", "Athena"],
  ["athenaMemoriesDeleted", "Athena memories", "Athena"],
  ["orgMemoriesDeleted", "Other memories", "Memory"],
  ["memoryMirrorsDeleted", "Repo mirrors", "Memory"],
  ["memoryProposalsDeleted", "Memory proposals", "Memory"],
  ["memoryCandidatesDeleted", "Memory candidates", "Memory"],
  ["memoryCitationsDeleted", "Memory citations", "Memory"],
  ["registryLedgerDeleted", "Registry ledger", "Registry"],
  ["conformanceReportsDeleted", "Conformance reports", "Registry"],
  ["conformanceFindingsDeleted", "Conformance findings", "Registry"],
  ["skillLessonsDeleted", "Skill lessons", "Registry"],
  ["skillTracesDeleted", "Skill traces", "Registry"],
  ["practiceAdoptionsDeleted", "Practice adoptions", "Registry"],
  ["housePatternsDeleted", "House patterns", "Registry"],
  ["outcomesDeleted", "Intervention outcomes", "Governance"],
  ["usageEventsDeleted", "Usage events", "Governance"],
  ["scanJobsDeleted", "Scan jobs", "Governance"],
  ["controlObservationsDeleted", "Control observations", "Governance"],
  ["controlSealsDeleted", "Control seals", "Governance"],
  ["repoAdmissionsDeleted", "Repo admissions", "Governance"],
  ["alertEventsDeleted", "Alert events", "Governance"],
  ["installationsDeleted", "Installations", "Secrets"],
  ["llmConfigsDeleted", "BYOM configs", "Secrets"],
  ["apiTokensDeleted", "API tokens", "Secrets"],
];

/**
 * Family counts the body actually carried. A field that is not a number is skipped — never shown as
 * zero. Audit is appended from deleted+redacted so the preview and the receipt share one list.
 */
export function eraseBlastGroups(
  counts: object,
  opts: { reposLabel?: string; auditHint?: string } = {},
): EraseBlastGroup[] {
  const src = counts as Record<string, unknown>;
  const groups: EraseBlastGroup[] = [];
  const byId = new Map<string, EraseBlastGroup>();
  const push = (id: string, row: EraseBlastRow) => {
    let g = byId.get(id);
    if (!g) {
      g = { id, title: id, rows: [] };
      byId.set(id, g);
      groups.push(g);
    }
    g.rows.push(row);
  };
  for (const [key, label, group] of BLAST) {
    const v = src[key];
    if (typeof v !== "number") continue;
    push(group, {
      label: key === "reposProcessed" ? (opts.reposLabel ?? label) : label,
      value: v,
    });
  }
  const auditDeleted = src.auditDeleted;
  if (typeof auditDeleted === "number") {
    const redacted = src.auditRedacted;
    push("Audit", {
      label: "Audit rows",
      value: auditDeleted + (typeof redacted === "number" ? redacted : 0),
      hint: opts.auditHint,
    });
  }
  for (const g of groups) if (g.rows.length < 2) g.title = "";
  return groups;
}

/**
 * Eleven rows, two columns, and only the audit row moves.
 *
 * - `keep`   — the trail is untouched: void in Erased, solid in Kept.
 * - `redact` — solid in BOTH. Identities and detail payloads are destroyed; every entry keeps its
 *              timestamp and stays exportable. This is the only disposition the dialog can request.
 * - `delete` — solid in Erased, void in Kept. The route answers a genuine "delete" with 409 unless the
 *              deployment sets ERASE_AUDIT_FORCE=1, so this row is drawn for honesty, not for reach.
 */
export function erasePreviewRows(disposition: AuditDisposition): MatrixRow[] {
  const audit: VizState[] =
    disposition === "keep"
      ? ["missing", "measured"]
      : disposition === "delete"
        ? ["measured", "missing"]
        : ["measured", "measured"];

  const row = (id: string, label: string, cells: VizState[]): MatrixRow => ({
    id,
    label,
    cells: cells.map((state) => ({ state })),
  });
  const gone = (id: string, label: string) => row(id, label, ["measured", "missing"]);
  const kept = (id: string, label: string) => row(id, label, ["missing", "measured"]);

  return [
    gone("scans", "Scan history"),
    gone("caches", "Repo caches"),
    gone("loop", "Loop history"),
    gone("athena", "Athena"),
    gone("memory", "Org memory"),
    gone("registry", "Registry"),
    gone("governance", "Governance"),
    gone("secrets", "Secrets"),
    row("audit", "Audit trail", audit),
    kept("settings", "Your settings"),
    kept("tenant", "Org & members"),
  ];
}

/** Only the states drawn — the `Legend` contract. Both are always present on every disposition. */
export function erasePreviewStates(rows: MatrixRow[]): VizState[] {
  const present = new Set(rows.flatMap((r) => r.cells.map((c) => c.state)));
  return (["measured", "missing"] as VizState[]).filter((s) => present.has(s));
}

/** The (D) Disclosed caveat on the picture — what an empty cell means HERE, in the reader's terms. */
export const ERASE_MATRIX_HINT =
  "An empty cell is nothing to erase, not an unknown: your organization, its repositories, its members and everything you configured are never in the Erased column. Scan history, repo caches, the improvement loop, Athena, memory, the registry, governance ledgers and stored secrets always are. The audit trail is the only row that moves — redacting it puts it in BOTH columns, because redaction destroys who did what while keeping the record that it happened.";
