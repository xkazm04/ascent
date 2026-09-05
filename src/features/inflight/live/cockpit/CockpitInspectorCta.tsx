"use client";

// THE INSPECTOR'S CALL TO ACTION — Run, Drive, or the one sentence saying why neither is offered.
//
// Extracted from CockpitInspector (pure relocation, no behaviour change) so that file stays what its
// header claims: selection → proposal → CTA, with the proposal machinery in between and none of the
// button markup. The ordering rule is unchanged and still deliberate: `blockedReason` (or a missing
// owner role) REPLACES both buttons rather than disabling them, because a control that 403s on click
// is worse than one that is not there.

export interface CockpitInspectorCtaProps {
  /** Selected repos that actually have a local pairing — the only ones a lane can run in. */
  runnable: number;
  /** The drive's rope, echoed in its caption so the operator sees the bound they set. */
  maxRuns: number;
  onRun: () => void;
  onDrive: () => void;
  canRun: boolean;
  canDrive: boolean;
  blockedReason: string | null;
  busy: boolean;
  error: string | null;
}

export function CockpitInspectorCta(p: CockpitInspectorCtaProps) {
  if (p.blockedReason || !p.canRun) {
    return (
      <>
        <p className="mt-4 type-caption text-slate-500">{p.blockedReason ?? "Running the loop needs org-owner access."}</p>
        {p.error && <p className="mt-3 type-caption text-danger">{p.error}</p>}
      </>
    );
  }
  return (
    <>
      <button
        type="button"
        onClick={p.onRun}
        disabled={p.busy || p.runnable === 0}
        className="focus-ring mt-4 w-full rounded-md bg-accent px-3 py-2 type-label tracking-[0.18em] text-on-accent transition hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-40"
      >
        {p.runnable === 0 ? "No paired repos selected" : `Run (${p.runnable} ${p.runnable === 1 ? "repo" : "repos"})`}
      </button>
      {p.canDrive && (
        <>
          <button
            type="button"
            onClick={p.onDrive}
            disabled={p.busy || p.runnable === 0}
            className="focus-ring mt-2 w-full rounded-md border border-accent/60 px-3 py-2 type-label tracking-[0.18em] text-accent transition hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Drive to green
          </button>
          <p className="mt-1.5 type-note leading-relaxed text-slate-500">
            Runs again and again until every selected repo clears the band, a whole run moves nothing, or the {p.maxRuns}-run
            budget is spent.
          </p>
        </>
      )}
      {p.error && <p className="mt-3 type-caption text-danger">{p.error}</p>}
    </>
  );
}
