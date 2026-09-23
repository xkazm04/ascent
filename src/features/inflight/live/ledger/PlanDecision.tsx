"use client";

// THE VERDICT on one pending plan — Approve (a fenced, budgeted direction), Revise (a note the next
// planning session reads), Reject (a reason every item is dismissed under). Owner-only; the caller
// renders this only for an owner.
//
// NEVER A PHANTOM DECISION (`hitl-approval/review-queues`): the row leaves the inbox only when the
// server answered with the decided plan. A failed write keeps the row, keeps what was typed, and says
// why in the server's own words.

import { useState } from "react";
import { Field, TextArea, TextInput } from "@/components/ui";
import type { PlanDecision as Verb } from "@/lib/local/runner-types";
import { FenceEditor } from "./FenceEditor";
import { decidePlan } from "./ledgerClient";
import { DEFAULT_BUDGET_CYCLES, decisionBody } from "./planDecisionModel";
import type { LoopDirectionRecord, LoopPlanRecord } from "./ledgerTypes";

const VERBS: { verb: Verb; label: string }[] = [
  { verb: "approve", label: "Approve…" },
  { verb: "revise", label: "Revise…" },
  { verb: "reject", label: "Reject…" },
];

const SUBMIT: Record<Verb, string> = { approve: "Approve as a direction", revise: "Send back for revision", reject: "Reject the plan" };
/** A held plan's approval lands the parked commits the reviewer just read — the button says so. */
const APPROVE_HELD = "Approve — land these commits";

export function PlanDecision({ plan, onDecided }: { plan: LoopPlanRecord; onDecided: (plan: LoopPlanRecord, direction: LoopDirectionRecord | null) => void }) {
  const [verb, setVerb] = useState<Verb | null>(null);
  const [fence, setFence] = useState<string[]>(() => [...(plan.plan?.modules ?? [])]);
  const [cycles, setCycles] = useState(String(DEFAULT_BUDGET_CYCLES));
  const [usd, setUsd] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    if (!verb) return;
    const draft = decisionBody(verb, { fence, cycles, usd, note });
    if (!draft.ok) {
      setError(draft.error);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const out = await decidePlan(plan.id, draft.body);
      onDecided(out.plan, out.direction);
    } catch (e) {
      setError(`${e instanceof Error ? e.message : "The decision did not land."} The plan is still pending.`);
    } finally {
      setBusy(false);
    }
  };

  const needsText = verb === "revise" || verb === "reject";
  return (
    <div data-testid="plan-decision" className="space-y-3 border-t border-divider pt-3">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Decide this plan">
        {VERBS.map((v) => (
          <button
            key={v.verb}
            type="button"
            aria-pressed={verb === v.verb}
            disabled={busy}
            onClick={() => {
              setVerb(v.verb);
              setError(null);
            }}
            className={`focus-ring rounded-lg border px-3 py-1.5 type-body-sm transition disabled:opacity-50 ${
              verb === v.verb ? "border-accent bg-accent/10 text-white" : "border-divider text-slate-300 hover:border-accent"
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>

      {verb === "approve" && (
        <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr]">
          <Field as="fieldset" label="Fence — the modules the direction may move">
            <FenceEditor fence={fence} onChange={setFence} disabled={busy} />
          </Field>
          <Field label="Budget · cycles">
            <TextInput inputMode="numeric" value={cycles} disabled={busy} onChange={(e) => setCycles(e.target.value)} />
          </Field>
          <Field label="Budget · USD (optional)">
            <TextInput inputMode="decimal" value={usd} disabled={busy} placeholder="none" onChange={(e) => setUsd(e.target.value)} />
          </Field>
        </div>
      )}

      {verb && (
        <Field label={verb === "approve" ? "Note (optional)" : verb === "revise" ? "What should change (required)" : "Why reject (required)"}>
          <TextArea rows={2} value={note} disabled={busy} onChange={(e) => setNote(e.target.value)} />
        </Field>
      )}

      {verb && (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => void submit()}
            disabled={busy || (needsText && !note.trim())}
            className={`focus-ring rounded-lg px-4 py-1.5 type-body-sm font-semibold transition disabled:opacity-50 ${
              verb === "reject" ? "border border-danger/60 text-danger hover:bg-danger/10" : "bg-accent text-on-accent hover:bg-accent-soft"
            }`}
          >
            {busy ? "Deciding…" : verb === "approve" && plan.heldBranch ? APPROVE_HELD : SUBMIT[verb]}
          </button>
          {needsText && !note.trim() && <span className="type-caption text-slate-500">A note is required.</span>}
        </div>
      )}

      {error && (
        <p role="alert" className="type-body-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
