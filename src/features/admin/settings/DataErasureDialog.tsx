"use client";

// The ARMING half of the org data-erasure control (G2-34) — the dialog body shown before anything is
// deleted. Split out of DataErasureCard so each file stays well under the 300-LOC cap.
//
// Three design commitments, all load-bearing for a destructive compliance action:
//
//  1. TYPED CONFIRMATION, not a checkbox. POST /api/org/erase refuses any payload that doesn't echo the
//     target's own name back (`confirm` must equal the org slug), so the UI asks for exactly that: the
//     owner types the organization's name. A tick-box says "I understand"; typing the name proves the
//     user knows WHICH tenant they are erasing. We gate the submit on an EXACT match of the string we
//     printed (the route itself compares case-insensitively for orgs — we are deliberately the stricter
//     of the two, never the looser).
//
//  2. AN HONEST MANIFEST. The route keeps owner-AUTHORED configuration and the Organization/Repository/
//     Membership rows, and resets the scan-DERIVED caches so "erased" is not a lie. A vague "this deletes
//     your data" would leave the owner unable to form intent, so both columns are enumerated by name.
//     The audit opt-in is REDACTION, not destruction — `includeAudit: true` resolves to
//     `auditDisposition: "redact"` and the route answers a real `"delete"` with 409 unless the
//     deployment sets ERASE_AUDIT_FORCE=1 (resolveAuditDisposition, src/lib/db/retention.ts). So
//     ticking it moves the IDENTITIES into the erased column while the account of what happened and
//     when stays in the kept one — a row appears in both, because that is what redaction does. This
//     text used to promise that only the `data.erased` entry would survive, which described a
//     disposition this dialog cannot request, and contradicted the preview panel three lines below it.
//
//  3. A COUNT BESIDE THE FIELD. The manifest says WHICH kinds of thing die; the preview panel says HOW
//     MANY. The confirm button stays disabled until that count has actually rendered (`preview.status
//     === "ready"`) — an operator must not be able to confirm a blast radius they were never shown,
//     and a preview that FAILED reads "unknown" and keeps the button disabled rather than showing a
//     zero nobody received. See DataErasurePreview.tsx.

import { ModalBody, ModalFooter, ModalHeader } from "@/components/ui";
import { DataErasureManifest } from "./DataErasureManifest";
import { DataErasurePreview, type ErasePreviewState } from "./DataErasurePreview";

/** The typed confirmation gate. Trimmed (a trailing space from a paste is not a different org) but
 *  otherwise EXACT — the owner must reproduce the name as printed. Exported for the card + its tests. */
export function confirmMatches(typed: string, slug: string): boolean {
  return typed.trim() === slug;
}

export function DataErasureDialog({
  slug,
  typed,
  onTyped,
  includeAudit,
  onIncludeAudit,
  preview,
  busy,
  onCancel,
  onConfirm,
}: {
  slug: string;
  typed: string;
  onTyped: (v: string) => void;
  includeAudit: boolean;
  onIncludeAudit: (v: boolean) => void;
  preview: ErasePreviewState;
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const shown = preview.status === "ready";
  const armed = confirmMatches(typed, slug) && shown;
  // Mismatch is about the TYPED STRING only — a correct name with a pending preview is not a typo.
  const mismatch = typed.trim().length > 0 && !confirmMatches(typed, slug);

  return (
    <>
      <ModalHeader kicker="Erase organization data" title={`Erase every scan in ${slug}?`} context={slug} />
      <ModalBody className="space-y-5">
        <DataErasureManifest includeAudit={includeAudit} />

        <p className="rounded-lg border border-divider bg-surface/40 px-3 py-2 type-body-sm text-slate-400">
          Because watch flags and schedules survive, any repo still on a scan cadence will begin building a new
          history on its next run. Unwatch those repos first if you want the org to stay empty.
        </p>

        <label className="flex items-start gap-2 type-body-sm text-slate-300">
          <input
            type="checkbox"
            checked={includeAudit}
            disabled={busy}
            onChange={(e) => onIncludeAudit(e.target.checked)}
            className="mt-1 accent-accent"
          />
          <span>
            Also redact the audit trail to identifier-only (no date cutoff). Reducing the compliance record is a
            separate decision from erasing scan data. Leave this off unless the request covers it.
          </span>
        </label>

        <DataErasurePreview state={preview} />

        <div>
          <label htmlFor="erase-confirm" className="block type-body-sm text-slate-300">
            Type <span className="font-mono font-semibold text-white">{slug}</span> to confirm. This cannot be undone.
          </label>
          <input
            id="erase-confirm"
            value={typed}
            disabled={busy}
            onChange={(e) => onTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-invalid={mismatch || undefined}
            aria-describedby={mismatch ? "erase-confirm-hint" : undefined}
            placeholder={slug}
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 type-mono-sm text-slate-200 placeholder:text-slate-600 outline-none focus:border-danger disabled:opacity-50"
          />
          {mismatch && (
            <p id="erase-confirm-hint" className="mt-1 type-caption text-orange-300">
              That doesn&apos;t match {slug}.
            </p>
          )}
        </div>
      </ModalBody>
      <ModalFooter>
        <span className="type-caption text-slate-500">
          {shown ? "Esc or Cancel to back out" : "Waiting for the count before this can be confirmed"}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="focus-ring rounded-lg border border-slate-700 px-4 py-2 type-mono-sm text-slate-200 transition hover:border-accent hover:text-white disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || !armed}
            className="focus-ring rounded-lg bg-danger px-4 py-2 type-mono-sm font-semibold text-white transition hover:bg-danger/90 disabled:opacity-50"
          >
            {busy ? "Erasing…" : includeAudit ? `Erase ${slug} and redact its audit trail` : `Erase ${slug}`}
          </button>
        </div>
      </ModalFooter>
    </>
  );
}
