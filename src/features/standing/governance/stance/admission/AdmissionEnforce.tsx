"use client";

// THE ENFORCE PANEL (moonshot #8 follow-up "proposal dry-run modal UI", MC-X3). The column says the
// CODEOWNERS block and the branch ruleset "are proposals a person opens deliberately"; this is where a
// person opens them, from the row whose decision they compile.
//
// CODEOWNERS is a two-click HITL flow. Preview is `confirm: false`, which reads and diffs and writes
// nothing. "Open draft PR" is `confirm: true` carrying `expectDiffDigest`, the digest of the diff
// this panel rendered, so what runs on approval is what was shown: if the file moved in between the
// route answers 409 content-drift with the current diff, which replaces the old one here for a second
// look. The ruleset half lives in AdmissionRulesetControl.

import { useState } from "react";
import type { AdmissionView } from "./admissionRows";
import { enforceActions, parseOwners, previewDigest } from "./admissionEnforceModel";
import { BTN, BTN_DANGER, EnforceRequestError, FIELD, sendJson } from "./admissionEnforceUi";
import { AdmissionRulesetControl } from "./AdmissionRulesetControl";

interface OpenedPr {
  url: string;
  number: number;
  reused: boolean;
}

export function AdmissionEnforce({ org, view, onSaved }: { org: string; view: AdmissionView; onSaved: () => void }) {
  const actions = enforceActions(view);
  const [ownersText, setOwnersText] = useState("");
  /** The diff exactly as rendered; null until previewed. "" is a real answer: nothing would change. */
  const [shown, setShown] = useState<string | null>(null);
  const [pr, setPr] = useState<OpenedPr | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const owners = parseOwners(ownersText);

  async function propose(confirm: boolean) {
    setBusy(true);
    setError(null);
    try {
      const d = (await sendJson("/api/org/admission/propose", "POST", {
        org,
        repo: view.fullName,
        owners,
        confirm,
        ...(confirm && shown !== null ? { expectDiffDigest: previewDigest(shown) } : {}),
      })) as { diff?: string; pr?: OpenedPr };
      if (confirm) setPr(d.pr ?? null);
      else setShown(d.diff ?? "");
    } catch (e) {
      if (e instanceof EnforceRequestError && e.body.code === "content-drift" && typeof e.body.diff === "string") {
        // The route read a different CODEOWNERS than the one previewed and wrote nothing. Show what it
        // would write now; the next "Open draft PR" carries THIS diff's digest.
        setShown(e.body.diff);
        setError("CODEOWNERS changed since your preview. The diff below is the current one: review it, then open again.");
      } else {
        setError(e instanceof Error ? e.message : "The CODEOWNERS proposal could not be prepared.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 space-y-4 rounded-lg border border-divider bg-slate-950/40 p-3">
      <section className="space-y-2">
        <p className="font-mono type-micro uppercase tracking-[0.14em] text-slate-500">CODEOWNERS managed block</p>
        {!actions.codeowners.available ? (
          <p className="type-body-sm text-slate-500">Nothing to propose: {actions.codeowners.reason}.</p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex-1">
                <span className="sr-only">Reviewing teams for {view.fullName}</span>
                <input
                  value={ownersText}
                  onChange={(e) => {
                    // A preview is only a preview of the teams it was made with.
                    setOwnersText(e.target.value);
                    setShown(null);
                    setPr(null);
                  }}
                  placeholder="@org/team, @org/other"
                  className={`${FIELD} w-full min-w-40`}
                />
              </label>
              <button onClick={() => void propose(false)} disabled={busy || owners.length === 0} className={BTN}>
                Preview CODEOWNERS change
              </button>
            </div>
            {shown === "" && <p className="type-body-sm text-slate-400">no change: CODEOWNERS already carries this block</p>}
            {shown && (
              <>
                <pre className="max-h-64 overflow-auto rounded-md border border-slate-800 bg-slate-950 p-2 type-mono-sm text-slate-300">
                  {shown}
                </pre>
                {pr ? (
                  <a href={pr.url} target="_blank" rel="noreferrer" className="type-body-sm text-accent underline">
                    Draft PR #{pr.number}
                    {pr.reused ? " (updated)" : ""}
                  </a>
                ) : (
                  <button onClick={() => void propose(true)} disabled={busy} className={BTN_DANGER}>
                    Open draft PR
                  </button>
                )}
              </>
            )}
            <span role="status" aria-live="polite" className="block type-micro text-orange-300">
              {error ?? ""}
            </span>
          </>
        )}
      </section>
      <section className="space-y-2">
        <p className="font-mono type-micro uppercase tracking-[0.14em] text-slate-500">Branch ruleset</p>
        <AdmissionRulesetControl org={org} view={view} action={actions.ruleset} reason={actions.rulesetReason} onSaved={onSaved} />
      </section>
    </div>
  );
}
