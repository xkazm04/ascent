// The two-column erasure MANIFEST — "Erased, permanently" beside "Kept, untouched". Pure relocation
// out of DataErasureDialog.tsx to keep that file under the 200-LOC `src/features/**` cap once the
// audit rows were rewritten to describe redaction. Presentational only: no hooks, no handlers, so
// deliberately NO "use client".
//
// The audit opt-in puts a row in BOTH columns, and that is the point rather than an oversight:
// `includeAudit: true` resolves to `auditDisposition: "redact"` (resolveAuditDisposition,
// src/lib/db/retention.ts), which destroys the identities and keeps the account. A manifest that
// listed it under one heading would be describing a disposition this dialog cannot request.

import { DataErasureColumn } from "./DataErasureColumn";

export function DataErasureManifest({ includeAudit }: { includeAudit: boolean }) {
  return (
  <div className="grid gap-5 sm:grid-cols-2">
    <DataErasureColumn
      kicker="Erased, permanently"
      tone="erased"
      items={[
        <>
          <strong className="font-semibold text-white">Every scan in this organization</strong>: each run&apos;s
          scores, its per-dimension breakdowns, its recommendations, and the accept/dismiss history recorded
          against them.
        </>,
        <>
          <strong className="font-semibold text-white">Every repository&apos;s scan-derived cache</strong>: the
          detected tech stack, the passport, the pinned head commit (SHA and ETag), and the last-scan time,
          status and error.
        </>,
        ...(includeAudit
          ? [
              <>
                <strong className="font-semibold text-white">Every identity in this organization&apos;s audit
                trail</strong>: the actor on each entry and its whole detail payload, with no date cutoff. The
                rows are rewritten to identifier-only form and re-signed, so a subject reference stops resolving
                to a person.
              </>,
            ]
          : []),
      ]}
    />
    <DataErasureColumn
      kicker="Kept, untouched"
      tone="kept"
      items={[
        <>
          <strong className="font-semibold text-white">The organization, its repositories and its members.</strong>{" "}
          Erasure removes the data; it does not delete the tenant or sign anyone out.
        </>,
        <>
          <strong className="font-semibold text-white">Everything you configured</strong>: which repos are
          watched, their scan schedules, your segments and their tags, and any passport overrides.
        </>,
        ...(includeAudit
          ? [
              <>
                <strong className="font-semibold text-white">What the audit trail recorded, and when.</strong>{" "}
                Redaction strips who and what-detail, not the entries themselves: every action keeps its
                timestamp and stays exportable, including the <code>data.erased</code> entry for this erasure.
              </>,
            ]
          : [
              <>
                <strong className="font-semibold text-white">The audit trail, in full.</strong> Tick the box
                below to redact it to identifier-only; either way a <code>data.erased</code> entry records this
                erasure.
              </>,
            ]),
      ]}
    />
  </div>
  );
}
