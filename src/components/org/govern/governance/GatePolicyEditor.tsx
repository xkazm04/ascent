"use client";

// Owner-only editor for the org's CI maturity-gate policy (GATE-1). The App-mode PR Check Run and the
// governance fleet view both resolve this persisted policy; before it, the App check ignored any bar
// and used archetype defaults. Saving POSTs the policy; "Reset to default" clears it (null).
//
// JSX only — state/effects/handlers live in useGatePolicyEditor.ts (extracted to keep this file
// under the 200-LOC cap; docs/ORG-TABS-REFACTOR.md). `appliesWhen` is re-exported for its test.

import type { GatePolicy } from "@/lib/scoring/gate";
import type { LevelId } from "@/lib/types";
import { appliesWhen, useGatePolicyEditor } from "./useGatePolicyEditor";

export { appliesWhen };

const LEVELS: LevelId[] = ["L1", "L2", "L3", "L4", "L5"];

export function GatePolicyEditor({ org, initial }: { org: string; initial: GatePolicy | null }) {
  const f = useGatePolicyEditor(org, initial);

  return (
    <div className="mt-4 border-t border-slate-800 pt-4">
      <div className="font-mono text-sm uppercase tracking-widest text-accent">Edit policy</div>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <label className="flex items-center justify-between gap-2 text-sm text-slate-400">
          Minimum level
          <select
            value={f.minLevel}
            onChange={(e) => f.setMinLevel(e.target.value)}
            className="rounded-md border border-slate-700 bg-slate-950 px-2 py-1 font-mono text-sm text-slate-200 outline-none focus:border-accent"
          >
            <option value="">any</option>
            {LEVELS.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center justify-between gap-2 text-sm text-slate-400">
          Min overall
          <input
            type="number"
            // min=1, not 0: sanitizeGatePolicy treats ≤0 as "not set" and drops the field server-side,
            // so offering 0 in the UI invites a save the gate will silently shed. (ambiguity-ui ci-gate #3)
            min={1}
            max={100}
            value={f.minOverall}
            onChange={(e) => f.setMinOverall(e.target.value)}
            placeholder="—"
            className="w-20 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-200 outline-none focus:border-accent"
          />
        </label>
        <label className="flex items-center justify-between gap-2 text-sm text-slate-400">
          Min per-dimension
          <input
            type="number"
            min={1}
            max={100}
            value={f.minDimension}
            onChange={(e) => f.setMinDimension(e.target.value)}
            placeholder="—"
            className="w-20 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-200 outline-none focus:border-accent"
          />
        </label>
        <label className="flex items-center justify-between gap-2 text-sm text-slate-400">
          <span className="flex items-center gap-2">
            <input type="checkbox" checked={f.security} onChange={(e) => f.setSecurity(e.target.checked)} className="accent-accent" />
            Security floor (D9 ≥)
          </span>
          <input
            type="number"
            // This <label> wraps TWO controls (the enable checkbox and this threshold), so the label
            // text names only the first — the number input reached assistive tech unnamed. Name it
            // explicitly; it carries the actual merge-blocking value.
            aria-label="Security floor (D9 minimum)"
            min={1}
            max={100}
            value={f.securityFloor}
            disabled={!f.security}
            onChange={(e) => f.setSecurityFloor(e.target.value)}
            className="w-20 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-200 outline-none focus:border-accent disabled:opacity-50"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-400">
          <input type="checkbox" checked={f.noUngoverned} onChange={(e) => f.setNoUngoverned(e.target.checked)} className="accent-accent" />
          Forbid &quot;ungoverned&quot; posture
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-400">
          <input type="checkbox" checked={f.requireProtection} onChange={(e) => f.setRequireProtection(e.target.checked)} className="accent-accent" />
          Require a protected default branch
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2" aria-busy={f.busy !== null}>
        <button
          onClick={() => f.save()}
          disabled={f.busy !== null}
          className="rounded-md border border-accent/50 bg-accent/10 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-accent/20 disabled:opacity-50"
        >
          {f.busy === "save" ? "Saving…" : "Save policy"}
        </button>
        <button
          onClick={f.reset}
          disabled={f.busy !== null}
          className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-400 transition hover:border-orange-400 hover:text-orange-300 disabled:opacity-50"
        >
          Reset to default
        </button>
      </div>
      {/* ONE persistent polite live region (rendered always, content swapped) so save/reset outcomes are
          ANNOUNCED to screen readers — the old `{msg && <span …>}` was inserted after the fact, which
          assistive tech never reads, leaving success, silent field-dropping, and failure all
          indistinguishable on a merge-blocking form. Errors carry a textual "Error:" prefix so the
          kind isn't conveyed by color alone (WCAG 1.4.1). (ambiguity-ui ci-gate #5)

          The second line says WHEN the bar takes effect. Saving a merge-blocking policy used to imply
          instant org-wide enforcement; in reality every open PR kept its old verdict until the next
          push. The server now re-runs the gate on open PRs and reports what it scheduled — this states
          that outcome verbatim, including the honest "nothing was re-checked" case. It shares this
          region rather than mounting its own: a conditionally-mounted live region is never announced,
          and two competing polite regions race each other when both do fire. */}
      <div role="status" aria-live="polite" className="mt-2">
        <span className={`font-mono text-sm ${f.msg?.kind === "error" ? "text-orange-300" : "text-emerald-300"}`}>
          {f.msg ? (f.msg.kind === "error" ? `Error: ${f.msg.text}` : f.msg.text) : ""}
        </span>
        <p className="mt-1 text-sm text-slate-500">{f.applies ?? ""}</p>
      </div>
    </div>
  );
}
