// The erasure blast radius, as a matrix — what dies and what survives, on the same two columns.
//
// The dialog's prose manifest STAYS (a destructive compliance action explains itself before the user
// acts; docs/ORG-UX-REDESIGN.md §2.1 and §4 both leave those alone). This is the picture above it, and
// it earns its place by drawing the one thing the manifest needs three sentences and a doc comment to
// establish: under `includeAudit`, the audit trail appears in BOTH columns, because redaction destroys
// the identities and keeps the account of what happened. A reader can see that in one glance and
// cannot mis-hold it, which is not true of "a row appears in both, because that is what redaction
// does."
//
// The voids do the other half. Four cells are `missing` on every disposition — your settings, the org
// and its members are never in the Erased column, and there is nothing to paint there. Wave 1's
// result, re-applied: an absence you can SEE beats an absence you are promised.
//
// Pure: no React, no hooks. The kit types are `import type`.

import type { MatrixRow, VizState } from "@/components/org/viz";
import type { AuditDisposition } from "./eraseTotals";

/** Erased permanently · kept untouched — the manifest's own two headings. */
export const ERASE_AXES = ["Erased", "Kept"] as const;

/** Row labels fit MatrixGrid's 104-unit gutter (~13 characters at 10px mono-uppercase). */
const SCANS = "Scan history";
const CACHES = "Repo caches";
const AUDIT = "Audit trail";
const SETTINGS = "Your settings";
const TENANT = "Org & members";

/**
 * Five rows, two columns, and only the audit row moves.
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

  return [
    row("scans", SCANS, ["measured", "missing"]),
    row("caches", CACHES, ["measured", "missing"]),
    row("audit", AUDIT, audit),
    row("settings", SETTINGS, ["missing", "measured"]),
    row("tenant", TENANT, ["missing", "measured"]),
  ];
}

/** Only the states drawn — the `Legend` contract. Both are always present on every disposition. */
export function erasePreviewStates(rows: MatrixRow[]): VizState[] {
  const present = new Set(rows.flatMap((r) => r.cells.map((c) => c.state)));
  return (["measured", "missing"] as VizState[]).filter((s) => present.has(s));
}

/** The (D) Disclosed caveat on the picture — what an empty cell means HERE, in the reader's terms. */
export const ERASE_MATRIX_HINT =
  "An empty cell is nothing to erase, not an unknown: your organization, its repositories, its members and everything you configured are never in the Erased column. The audit trail is the only row that moves — redacting it puts it in BOTH columns, because redaction destroys who did what while keeping the record that it happened.";
