"use client";

// State/effects/handlers for the gate-policy editor, extracted from GatePolicyEditor.tsx to keep the
// component under the 200-LOC cap (AGENTS.md / docs/ORG-TABS-REFACTOR.md). Owns no JSX. The pure
// reconciliations it composes (appliesWhen / floorsExceptD9 / droppedFields, plus the SweepPlan type)
// now live in gatePolicyReconcile.ts and are re-exported here, so call sites stay unchanged.
//
// NOTE the deliberate numeric asymmetry (docs/ORG-TABS-REFACTOR.md govern-agent brief): this client
// form CLAMPS the security-floor input to the display range via `clampToDisplayRange`, while the
// server's `parseFloor` REJECTS an out-of-range value outright. That difference is intentional — do
// not "fix" it into agreement.

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { GatePolicy } from "@/lib/scoring/gate";
import {
  addRequireCheckId,
  appliesWhen,
  buildEditedPolicy,
  droppedFields,
  seedEditorFields,
  type SweepPlan,
} from "./gatePolicyReconcile";

export { appliesWhen } from "./gatePolicyReconcile";
export type { SweepPlan } from "./gatePolicyReconcile";

export function useGatePolicyEditor(org: string, initial: GatePolicy | null) {
  const router = useRouter();
  const init = seedEditorFields(initial);
  const [minLevel, setMinLevel] = useState(init.minLevel);
  const [minOverall, setMinOverall] = useState(init.minOverall);
  const [minDimension, setMinDimension] = useState(init.minDimension);
  const [security, setSecurity] = useState(init.security);
  const [securityFloor, setSecurityFloor] = useState(init.securityFloor);
  const [otherFloors, setOtherFloors] = useState(init.otherFloors);
  const [noUngoverned, setNoUngoverned] = useState(init.noUngoverned);
  const [requireProtection, setRequireProtection] = useState(init.requireProtection);
  const [requireChecks, setRequireChecks] = useState(init.requireChecks);
  const [aiGoverned, setAiGoverned] = useState(init.aiGoverned);
  const [aiGovernedRate, setAiGovernedRate] = useState(init.aiGovernedRate);
  // Unrendered bars (forbidAiAuthorship) carried through every save untouched.
  const [passthrough, setPassthrough] = useState(init.passthrough);
  const [busy, setBusy] = useState<"save" | "reset" | null>(null);
  const [msg, setMsg] = useState<{ kind: "note" | "error"; text: string } | null>(null);
  // When the saved bar takes effect, from the server's sweep plan (never assumed).
  const [applies, setApplies] = useState<string | null>(null);

  function buildPolicy(): GatePolicy {
    return buildEditedPolicy({
      passthrough,
      minLevel,
      minOverall,
      minDimension,
      otherFloors,
      security,
      securityFloor,
      noUngoverned,
      requireProtection,
      requireChecks,
      aiGoverned,
      aiGovernedRate,
    });
  }

  // Sync every form field to a policy (the server's sanitized echo, or null after a reset) so the UI
  // always shows what is actually stored, never what was merely requested. (ambiguity-ui ci-gate #3)
  function syncForm(p: GatePolicy | null) {
    const s = seedEditorFields(p);
    setMinLevel(s.minLevel);
    setMinOverall(s.minOverall);
    setMinDimension(s.minDimension);
    setSecurity(s.security);
    setSecurityFloor(s.securityFloor);
    setOtherFloors(s.otherFloors);
    setNoUngoverned(s.noUngoverned);
    setRequireProtection(s.requireProtection);
    setRequireChecks(s.requireChecks);
    setAiGoverned(s.aiGoverned);
    setAiGovernedRate(s.aiGovernedRate);
    setPassthrough(s.passthrough);
  }

  async function post(policy: GatePolicy | null, kind: "save" | "reset") {
    setBusy(kind);
    setMsg(null);
    setApplies(null);
    try {
      const res = await fetch("/api/org/gate-policy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org, policy }),
      });
      const d = (await res.json().catch(() => ({}))) as {
        error?: string;
        policy?: GatePolicy | null;
        /** Bars the write REMOVED, as only the server can see them (it holds the previous policy). */
        dropped?: { label: string; was: string | null }[];
        sweep?: SweepPlan;
      };
      if (!res.ok) throw new Error(d.error ?? "Failed to save policy.");
      setApplies(appliesWhen(d.sweep));
      // Drive the success copy from the SERVER's echoed result, not from the request. sanitizeGatePolicy
      // drops out-of-range/zero floors, and an all-invalid policy sanitizes to null — which CLEARS the
      // gate back to the archetype default. So a save of e.g. "min overall = 0" actually RESETS the bar.
      // The old copy hardcoded "Policy saved — the gate now enforces it" regardless, telling the owner a
      // stricter bar was live when it had really been reset (success-theater). (ci-gate-status-checks #4)
      // One level deeper (ambiguity-ui ci-gate #3): a PARTIALLY-dropped policy still echoed non-null, so
      // the success copy claimed enforcement of fields the sanitizer shed. Reconcile the request against
      // the echo, say exactly which fields were dropped, and re-seed the form from what is truly stored.
      const stored = d.policy ?? null;
      syncForm(stored);
      const dropped = kind === "save" && policy ? droppedFields(policy, stored) : [];
      // The request-vs-echo check above is structurally BLIND to a bar the form never sent — it can
      // only notice a field it asked for going missing. So the server, the one party holding both the
      // previous and the stored policy, reports removals too, and they are named here rather than
      // being discoverable only by diffing `previousPolicy` in the audit log (NADIA-L1-07). A reset
      // removes everything by definition, so its list is not a warning.
      const removed = kind === "save" ? (d.dropped ?? []) : [];
      setMsg(
        kind === "reset" || stored == null
          ? { kind: "note", text: "Reset to the archetype default: no custom bar is enforced." }
          : dropped.length > 0
            ? {
                kind: "error",
                text: `Saved, but NOT enforced: ${dropped.join(", ")}. 0 (or an out-of-range value) is not a valid bar, so the server cleared ${dropped.length > 1 ? "those fields" : "that field"}. The form now shows the stored policy.`,
              }
            : removed.length > 0
              ? {
                  kind: "error",
                  text: `Policy saved — but this save also REMOVED ${removed
                    .map((r) => `${r.label}${r.was ? ` (${r.was})` : ""}`)
                    .join("; ")}. The gate no longer enforces ${removed.length > 1 ? "those bars" : "that bar"}.`,
                }
              : { kind: "note", text: "Policy saved. The gate now enforces it." },
      );
      router.refresh();
    } catch (e) {
      setMsg({ kind: "error", text: e instanceof Error ? e.message : "Failed to save policy." });
      setApplies(null);
    } finally {
      setBusy(null);
    }
  }

  // No optimistic clear. The form used to blank itself BEFORE the request, so a failed reset left every
  // field empty while the server still held the old bar — the owner reading "Error: …" over an empty
  // form has no way to tell which policy is actually enforced, on the control that blocks merges. The
  // success path already re-seeds from the server's echo (syncForm(stored), stored === null here), so
  // the clear happens either way; dropping it just means a FAILED reset leaves the truth on screen.
  // This is the module's stated contract: the stored policy is the source of truth, never the request.
  function reset() {
    void post(null, "reset");
  }

  return {
    minLevel,
    setMinLevel,
    minOverall,
    setMinOverall,
    minDimension,
    setMinDimension,
    security,
    setSecurity,
    securityFloor,
    setSecurityFloor,
    otherFloors,
    setDimFloor: (dimId: string, value: string | null) =>
      setOtherFloors((prev) => {
        const next = { ...prev };
        if (value === null) delete next[dimId];
        else next[dimId] = value;
        return next;
      }),
    noUngoverned,
    setNoUngoverned,
    requireProtection,
    setRequireProtection,
    requireChecks,
    addRequireCheck: (id: string) => setRequireChecks((prev) => addRequireCheckId(prev, id)),
    removeRequireCheck: (id: string) => setRequireChecks((prev) => prev.filter((c) => c !== id)),
    aiGoverned,
    setAiGoverned,
    aiGovernedRate,
    setAiGovernedRate,
    busy,
    msg,
    applies,
    save: () => post(buildPolicy(), "save"),
    reset,
  };
}
