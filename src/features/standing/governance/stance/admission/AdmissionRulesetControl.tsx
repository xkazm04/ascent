"use client";

// The branch-ruleset half of the Enforce panel. A ruleset is the one admission control that takes
// effect the instant it is created, so the order here is the route's own guard order made visible:
// preview (a zero-write dryRun that returns the proposal beside the rulesets ALREADY on the repo),
// then a typed confirm of the repository's literal name, then apply. An applied ruleset is reverted
// from this same place, behind the same typed confirm.

import { useState } from "react";
import type { RulesetProposal } from "@/lib/org/admission";
import type { AdmissionView } from "./admissionRows";
import { typedConfirmReady, type RulesetAction } from "./admissionEnforceModel";
import { BTN, BTN_DANGER, FIELD, sendJson } from "./admissionEnforceUi";

/** The dry run's answer. `observed` is GitHub's own list, reduced by the route to id/name/enforcement. */
interface Preview {
  proposal: RulesetProposal;
  observed: { id: number; name: string; enforcement: string }[];
}

export function AdmissionRulesetControl({
  org,
  view,
  action,
  reason,
  onSaved,
}: {
  org: string;
  view: AdmissionView;
  action: RulesetAction;
  reason?: string;
  onSaved: () => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = typedConfirmReady(typed, view.fullName);

  async function run(method: "POST" | "DELETE", body: Record<string, unknown>, then: (d: unknown) => void) {
    setBusy(true);
    setError(null);
    try {
      then(await sendJson("/api/org/admission/ruleset", method, { org, repo: view.fullName, ...body }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "The ruleset request failed.");
    } finally {
      setBusy(false);
    }
  }

  const done = () => {
    setTyped("");
    setPreview(null);
    onSaved();
  };

  if (action === "none") {
    return <p className="type-body-sm text-slate-500">{reason ?? "No ruleset to apply."}</p>;
  }

  const confirmField = (
    <label className="flex items-center gap-1.5">
      <span className="sr-only">Type {view.fullName} to confirm</span>
      <input
        value={typed}
        onChange={(e) => setTyped(e.target.value)}
        placeholder={view.fullName}
        className={`${FIELD} w-56`}
      />
    </label>
  );

  return (
    <div className="space-y-2">
      {action === "revert" ? (
        <div className="flex flex-wrap items-center gap-2">
          <span className="type-body-sm text-slate-400">Ruleset {view.rulesetId} is active on the default branch.</span>
          {confirmField}
          <button
            onClick={() => void run("DELETE", { confirm: view.fullName }, done)}
            disabled={busy || !ready}
            className={BTN_DANGER}
          >
            {busy ? "Reverting…" : "Revert ruleset"}
          </button>
        </div>
      ) : (
        <>
          <button onClick={() => void run("POST", { dryRun: true }, (d) => setPreview(d as Preview))} disabled={busy} className={BTN}>
            {busy && !preview ? "Reading…" : "Preview ruleset"}
          </button>
          {preview && (
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <p className="font-mono type-micro uppercase tracking-[0.14em] text-slate-500">Proposed</p>
                <p className="type-mono-sm text-slate-200">{preview.proposal.name}</p>
                <ul className="type-body-sm text-slate-400">
                  {preview.proposal.rules.map((r) => (
                    <li key={r.type}>{r.type}</li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="font-mono type-micro uppercase tracking-[0.14em] text-slate-500">Already on the repo</p>
                {preview.observed.length === 0 ? (
                  <p className="type-body-sm text-slate-500">No rulesets yet.</p>
                ) : (
                  <ul className="type-body-sm text-slate-400">
                    {preview.observed.map((r) => (
                      <li key={r.id}>
                        {r.name} <span className="text-slate-500">({r.enforcement})</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
          {preview && (
            <div className="flex flex-wrap items-center gap-2">
              {confirmField}
              <button onClick={() => void run("POST", { confirm: view.fullName }, done)} disabled={busy || !ready} className={BTN_DANGER}>
                {busy ? "Applying…" : "Apply ruleset"}
              </button>
            </div>
          )}
        </>
      )}
      <span role="status" aria-live="polite" className="type-micro text-orange-300">
        {error ?? ""}
      </span>
    </div>
  );
}
