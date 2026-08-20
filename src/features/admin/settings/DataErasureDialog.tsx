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
//     your data" would leave the owner unable to form intent, so both columns are enumerated by name —
//     and the audit column moves from "kept" to "erased" the moment the audit opt-in is ticked.
//
//  3. A COUNT BESIDE THE FIELD. The manifest says WHICH kinds of thing die; the preview panel says HOW
//     MANY. The confirm button stays disabled until that count has actually rendered (`preview.status
//     === "ready"`) — an operator must not be able to confirm a blast radius they were never shown,
//     and a preview that FAILED reads "unknown" and keeps the button disabled rather than showing a
//     zero nobody received. See DataErasurePreview.tsx.

import { ModalBody, ModalFooter, ModalHeader } from "@/components/ui";
import { DataErasureColumn } from "./DataErasureColumn";
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
                      <strong className="font-semibold text-white">This organization&apos;s entire audit trail</strong>:{" "}
                      every recorded action, with no date cutoff. Only the <code>data.erased</code> entry for this
                      erasure survives it.
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
                ? []
                : [
                    <>
                      <strong className="font-semibold text-white">The audit trail.</strong> Tick the box below to
                      erase it too; either way a <code>data.erased</code> entry records this erasure.
                    </>,
                  ]),
            ]}
          />
        </div>

        <p className="rounded-lg border border-divider bg-surface/40 px-3 py-2 text-sm text-slate-400">
          Because watch flags and schedules survive, any repo still on a scan cadence will begin building a new
          history on its next run. Unwatch those repos first if you want the org to stay empty.
        </p>

        <label className="flex items-start gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={includeAudit}
            disabled={busy}
            onChange={(e) => onIncludeAudit(e.target.checked)}
            className="mt-1 accent-accent"
          />
          <span>
            Also erase the audit trail (no date cutoff). Destroying the compliance record is a separate decision from
            erasing scan data. Leave this off unless the request covers it.
          </span>
        </label>

        <DataErasurePreview state={preview} />

        <div>
          <label htmlFor="erase-confirm" className="block text-sm text-slate-300">
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
            className="mt-1 w-full rounded-lg border border-slate-700 bg-slate-900 px-2.5 py-1.5 font-mono text-sm text-slate-200 placeholder:text-slate-600 outline-none focus:border-danger disabled:opacity-50"
          />
          {mismatch && (
            <p id="erase-confirm-hint" className="mt-1 font-mono text-xs text-orange-300">
              That doesn&apos;t match {slug}.
            </p>
          )}
        </div>
      </ModalBody>
      <ModalFooter>
        <span className="font-mono text-xs text-slate-500">
          {shown ? "Esc or Cancel to back out" : "Waiting for the count before this can be confirmed"}
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="focus-ring rounded-lg border border-slate-700 px-4 py-2 font-mono text-sm text-slate-200 transition hover:border-accent hover:text-white disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy || !armed}
            className="focus-ring rounded-lg bg-danger px-4 py-2 font-mono text-sm font-semibold text-white transition hover:bg-danger/90 disabled:opacity-50"
          >
            {busy ? "Erasing…" : includeAudit ? `Erase ${slug} and its audit trail` : `Erase ${slug}`}
          </button>
        </div>
      </ModalFooter>
    </>
  );
}
