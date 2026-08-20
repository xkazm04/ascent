"use client";

// The BLAST RADIUS half of the org data-erasure control (G2-34) — the count an owner is shown BEFORE
// they type the org's name back. Split out of DataErasureCard/Dialog so both stay under the 200-LOC
// `src/features/**` cap; carries "use client" because it owns an effect.
//
// Why this exists: echo-to-confirm only means anything if the operator was told WHAT they are
// confirming. Until this was wired, the dialog asked for the org name while `preview: true` sat
// unused on POST /api/org/erase — a confirmation gate armed against a number nobody had seen.
//
// Three commitments, all of them about not lying:
//
//  1. THE COUNT COMES FROM THE DELETE'S OWN PREDICATE. `preview: true` runs the whole request as a
//     count inside eraseOrgData, so the number shown here cannot drift from the number that dies.
//     We do not compute anything client-side.
//  2. A NON-PREVIEW RESPONSE IS AN ERROR, NOT DATA. `isPreview` demands `dryRun === true` and numeric
//     counts. A 200 whose body we did not understand renders as UNKNOWN — never as zeros. Rendering
//     "0 scans" from a failed preview is reassurance we did not earn, and it is exactly what would
//     talk an owner into confirming an erase whose size they were never told.
//  3. RE-FETCH ON DISPOSITION. The audit rows affected differ between keeping the trail (none) and
//     redacting it (all of them), so the audit control re-runs the preview rather than leaving a
//     stale count beside a changed request.

import { useEffect, useState } from "react";

/** The preview body POST /api/org/erase returns for `preview: true` (EraseResult with `dryRun: true`). */
export interface ErasePreview {
  reposProcessed: number;
  scansDeleted: number;
  auditDeleted: number;
  auditRedacted: number;
  auditDisposition: "keep" | "redact" | "delete";
  /** False when the preview's own wall-clock budget stopped the count early — the totals are a FLOOR. */
  complete: boolean;
  dryRun: boolean;
}

export type ErasePreviewState =
  | { status: "loading" }
  | { status: "ready"; counts: ErasePreview }
  | { status: "error"; message: string };

const LOADING: ErasePreviewState = { status: "loading" };

/** A preview body is only usable if it SAYS it is one. Anything else (an error envelope, a real erase
 *  result replayed, a truncated body) is unknown-shaped and must not be read as counts. */
function isPreview(data: unknown): data is ErasePreview {
  const d = data as ErasePreview | null;
  return (
    !!d &&
    d.dryRun === true &&
    typeof d.scansDeleted === "number" &&
    typeof d.reposProcessed === "number" &&
    typeof d.auditRedacted === "number" &&
    typeof d.auditDeleted === "number"
  );
}

/** Fetch the casualty count when the dialog opens and whenever the audit disposition changes.
 *
 *  The answer is stored WITH the request it answers (`key`) and read back only on an exact match, so
 *  a count is structurally incapable of outliving its request: flipping the audit box or re-opening
 *  the dialog reverts to "loading" during render, with no reset-setState in the effect body (which
 *  react-hooks/set-state-in-effect forbids, and which would render the stale number for a frame
 *  anyway — one frame of a wrong blast radius beside an armed confirm field). The in-flight `live`
 *  flag drops a superseded response on top of that, so a slow first request cannot overwrite a fast
 *  second one. */
export function useErasePreview({
  slug,
  open,
  includeAudit,
}: {
  slug: string;
  open: boolean;
  includeAudit: boolean;
}): ErasePreviewState {
  const key = `${slug}|${includeAudit}|${open}`;
  const [entry, setEntry] = useState<{ key: string; state: ErasePreviewState } | null>(null);
  const setState = (state: ErasePreviewState) => setEntry({ key, state });

  useEffect(() => {
    if (!open) return;
    let live = true;
    void (async () => {
      try {
        const res = await fetch("/api/org/erase", {
          method: "POST",
          headers: { "content-type": "application/json" },
          // No `confirm`: the preview deliberately precedes the confirmation it exists to inform.
          body: JSON.stringify({ org: slug, preview: true, includeAudit }),
        });
        const data = (await res.json().catch(() => null)) as (ErasePreview & { error?: string }) | null;
        if (!live) return;
        if (!res.ok || !isPreview(data)) {
          setState({
            status: "error",
            message: data?.error ?? `Could not count what would be erased (${res.status}).`,
          });
          return;
        }
        setState({ status: "ready", counts: data });
      } catch {
        if (live) setState({ status: "error", message: "Could not reach the server to count what would be erased." });
      }
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` IS (slug, includeAudit, open).
  }, [key]);

  return entry?.key === key ? entry.state : LOADING;
}

const num = (n: number) => n.toLocaleString("en-US");

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-divider py-1">
      <dt className="text-slate-500">
        {label}
        {hint && <span className="ml-1 text-slate-600">{hint}</span>}
      </dt>
      <dd className="text-slate-200">{value}</dd>
    </div>
  );
}

/** The counts panel rendered beside the confirm field. Presentational: every state it can show is
 *  decided by the caller's `state`, and the failure state shows UNKNOWN rather than a fabricated 0. */
export function DataErasurePreview({ state }: { state: ErasePreviewState }) {
  if (state.status !== "ready") {
    const failed = state.status === "error";
    return (
      <div
        role={failed ? "alert" : "status"}
        className={`rounded-lg border px-3 py-2 font-mono text-xs ${
          failed ? "border-orange-500/40 bg-orange-500/5 text-orange-200" : "border-divider bg-surface/40 text-slate-400"
        }`}
      >
        {failed ? (
          <>
            <span aria-hidden>⚠</span> Unknown — {state.message} You cannot confirm an erasure whose size has not been
            shown to you; close this dialog and try again.
          </>
        ) : (
          "Counting what would be erased…"
        )}
      </div>
    );
  }

  const { counts } = state;
  // A preview stopped by its own time budget has counted a PREFIX of the org, so its totals are a
  // floor, not a total. Saying "412" when the truth is "at least 412" is the same unearned
  // reassurance an unreceived zero would be.
  const floor = counts.complete ? "" : "at least ";
  const auditAffected = counts.auditDeleted + counts.auditRedacted;
  const auditHint =
    counts.auditDisposition === "keep"
      ? "(trail kept)"
      : counts.auditDisposition === "delete"
        ? "(destroyed)"
        : "(redacted to identifier-only)";

  return (
    <div className="rounded-lg border border-danger/30 bg-danger/5 px-3 py-2">
      <p className="font-mono text-xs uppercase tracking-widest text-danger">Would be erased now</p>
      <dl className="mt-1.5 space-y-0 font-mono text-sm">
        <Row label="Scans" value={`${floor}${num(counts.scansDeleted)}`} />
        <Row label="Repositories" value={`${floor}${num(counts.reposProcessed)}`} />
        <Row label="Audit rows" hint={auditHint} value={num(auditAffected)} />
      </dl>
      <p className="mt-1.5 text-xs text-slate-500">
        {counts.complete
          ? "Counted by the same query the erase runs; nothing has been touched."
          : "This organization is large enough that the count stopped at a safe boundary — the real totals are higher."}
      </p>
    </div>
  );
}
