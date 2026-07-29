"use client";

// Org settings → "Erase organization data" (G2-34). POST /api/org/erase — the on-demand DSR / GDPR
// Art.17 erasure the retention cron cannot express — shipped with no control anywhere, so the
// compliance capability existed and no user could reach it. This is that control.
//
// PLACEMENT: org settings, deliberately. This is a compliance action taken once, on request — not
// something to put a click away on a dashboard someone opens daily.
//
// OWNER-ONLY BY ABSENCE: the settings page is already `hasOrgRole(slug, "owner")`-gated and renders
// nothing but an "Owner only" empty state otherwise, so a non-owner never sees this card at all. That
// is the intended shape — a DISABLED destructive control is an invitation to go find the permission.
//
// The dialog (DataErasureDialog) owns the arming state: the honest destroyed/kept manifest and the
// typed confirmation. The result (DataErasureOutcome) owns the three readings of the response —
// notably the 207 resumable case, whose "Continue erasing" button re-runs this same request.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui";
import { Card, SectionHeader } from "@/components/org/shared/ui";
import { DataErasureDialog, confirmMatches } from "./DataErasureDialog";
import { DataErasureOutcome, ZERO_TOTALS, addPass, type EraseResponse, type EraseTotals } from "./DataErasureOutcome";

export function DataErasureCard({ slug }: { slug: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [includeAudit, setIncludeAudit] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<EraseResponse | null>(null);
  const [totals, setTotals] = useState<EraseTotals>(ZERO_TOTALS);
  const [error, setError] = useState<string | null>(null);

  function openDialog() {
    setTyped("");
    setIncludeAudit(false);
    setResult(null);
    setTotals(ZERO_TOTALS);
    setError(null);
    setOpen(true);
  }

  function closeDialog() {
    if (busy) return; // a delete batch is in flight — the dialog is locked, read it don't dismiss it
    setOpen(false);
    // Scan-derived caches were reset server-side; refresh so the rest of the app stops showing them.
    if (result) router.refresh();
  }

  async function run() {
    // Belt to the dialog's own gate: never post a payload the route would 400 on anyway.
    if (busy || !confirmMatches(typed, slug)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/org/erase", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org: slug, confirm: typed.trim(), includeAudit }),
      });
      const data = (await res.json().catch(() => null)) as (EraseResponse & { error?: string }) | null;
      // 207 is `res.ok` — a degraded-but-real erase, handled by the outcome view, not as an error.
      if (!res.ok || !data || typeof data.complete !== "boolean") {
        setError(data?.error ?? `Erasure failed (${res.status}). Nothing more was erased.`);
        return;
      }
      setResult(data);
      setTotals((t) => addPass(t, data));
    } catch {
      setError("Network error — the request may or may not have completed. Re-run it to be sure; repeating is safe.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="border-danger/30">
      <SectionHeader
        title="Erase organization data"
        description="On-demand erasure for a data-subject or contract request: deletes this organization's scan history now, instead of waiting for the retention schedule. Irreversible."
        size="sm"
      />
      <p className="mt-3 max-w-2xl text-sm text-slate-400">
        Scan results and the analysis derived from them are erased. The organization, its repositories, its members
        and everything you configured — watch flags, schedules, segments, passport overrides — are kept. You will be
        asked to type <span className="font-mono text-slate-300">{slug}</span> to confirm, and shown the full list
        before anything is deleted.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={openDialog}
          className="focus-ring rounded-lg border border-danger/50 bg-danger/10 px-3 py-1.5 text-sm font-medium text-danger-soft transition hover:bg-danger/20 hover:text-white"
        >
          Erase organization data…
        </button>
        {error && !open && (
          <span role="alert" className="text-sm text-orange-300">
            <span aria-hidden>⚠</span> {error}
          </span>
        )}
      </div>

      <Modal open={open} onClose={closeDialog} locked={busy} ariaLabel={`Erase organization data for ${slug}`}>
        {result ? (
          <DataErasureOutcome
            slug={slug}
            result={result}
            totals={totals}
            busy={busy}
            onResume={() => void run()}
            onClose={closeDialog}
          />
        ) : (
          <>
            <DataErasureDialog
              slug={slug}
              typed={typed}
              onTyped={setTyped}
              includeAudit={includeAudit}
              onIncludeAudit={setIncludeAudit}
              busy={busy}
              onCancel={closeDialog}
              onConfirm={() => void run()}
            />
            {error && (
              <p role="alert" className="border-t border-divider px-6 py-3 text-sm text-orange-300">
                <span aria-hidden>⚠</span> {error}
              </p>
            )}
          </>
        )}
      </Modal>
    </Card>
  );
}
