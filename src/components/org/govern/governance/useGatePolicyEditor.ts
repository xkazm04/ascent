"use client";

// State/effects/handlers for the gate-policy editor, extracted from GatePolicyEditor.tsx to keep the
// component under the 200-LOC cap (AGENTS.md / docs/ORG-TABS-REFACTOR.md). Owns no JSX.
//
// NOTE the deliberate numeric asymmetry (docs/ORG-TABS-REFACTOR.md govern-agent brief): this client
// form CLAMPS the security-floor input to the display range via `clampToDisplayRange`, while the
// server's `parseFloor` REJECTS an out-of-range value outright. That difference is intentional — do
// not "fix" it into agreement.

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { GatePolicy } from "@/lib/scoring/gate";
import { clampToDisplayRange } from "@/lib/scoring/gate-numeric";
import type { LevelId } from "@/lib/types";

/** What the POST handler scheduled after the save (see the gate-policy route). */
export type SweepPlan =
  | { status: "scheduled"; repos: number; cap: number }
  | { status: "skipped"; reason: "no-installation" | "no-watched-repos"; repos: number; cap: number };

/**
 * Say WHEN the new bar actually takes effect — the one thing this form never told the owner. Saving
 * used to imply instant org-wide enforcement while every already-open PR kept its stale verdict until
 * the next push. The copy is driven by the server's sweep plan, so it is honest in BOTH installation
 * states rather than promising a re-check the App can't perform. Exported for its unit test.
 */
export function appliesWhen(sweep: SweepPlan | undefined): string | null {
  if (!sweep) return null;
  if (sweep.status === "scheduled") {
    return `Open PRs re-check within a minute — up to ${sweep.cap} across ${sweep.repos} watched ${
      sweep.repos === 1 ? "repo" : "repos"
    }. Anything past that applies on the next push, or a "Re-run" on the check.`;
  }
  return sweep.reason === "no-watched-repos"
    ? "No watched repos yet, so nothing was re-checked — the new bar applies the next time a repo is scanned or gated."
    : "No GitHub App installation, so open PRs were not re-checked — the new bar applies on each PR's next push or CI run.";
}

export function useGatePolicyEditor(org: string, initial: GatePolicy | null) {
  const router = useRouter();
  const [minLevel, setMinLevel] = useState<string>(initial?.minLevel ?? "");
  const [minOverall, setMinOverall] = useState<string>(initial?.minOverall != null ? String(initial.minOverall) : "");
  const [minDimension, setMinDimension] = useState<string>(initial?.minDimension != null ? String(initial.minDimension) : "");
  const [security, setSecurity] = useState<boolean>(initial?.minDimensionFor?.D9 != null);
  // Bug-fix (ci-gate-status-checks #2): seed the floor from the persisted value so a custom D9 bar
  // (e.g. 70, set via the gate API / ciWith snippet) round-trips. The checkbox is only a lossy
  // boolean projection — emitting a hardcoded 50 on save silently DOWNGRADED a stricter configured
  // floor on any unrelated edit. Default to 50 when newly enabled.
  const [securityFloor, setSecurityFloor] = useState<string>(
    initial?.minDimensionFor?.D9 != null ? String(initial.minDimensionFor.D9) : "50",
  );
  const [noUngoverned, setNoUngoverned] = useState<boolean>(Boolean(initial?.forbidPostures?.includes("ungoverned")));
  const [requireProtection, setRequireProtection] = useState<boolean>(Boolean(initial?.requireProtectedBranch));
  const [busy, setBusy] = useState<"save" | "reset" | null>(null);
  const [msg, setMsg] = useState<{ kind: "note" | "error"; text: string } | null>(null);
  // When the saved bar takes effect, from the server's sweep plan (never assumed).
  const [applies, setApplies] = useState<string | null>(null);

  function buildPolicy(): GatePolicy {
    const p: GatePolicy = {};
    if (minLevel) p.minLevel = minLevel as LevelId;
    if (minOverall.trim()) p.minOverall = Number(minOverall);
    if (minDimension.trim()) p.minDimension = Number(minDimension);
    if (security) {
      // Preserve the configured floor (clamped 0..100) instead of overwriting it with a fixed 50.
      const floor = clampToDisplayRange(securityFloor);
      p.minDimensionFor = { D9: floor };
    }
    if (noUngoverned || security) p.forbidPostures = ["ungoverned"];
    if (requireProtection) p.requireProtectedBranch = true;
    return p;
  }

  // Sync every form field to a policy (the server's sanitized echo, or null after a reset) so the UI
  // always shows what is actually stored, never what was merely requested. (ambiguity-ui ci-gate #3)
  function syncForm(p: GatePolicy | null) {
    setMinLevel(p?.minLevel ?? "");
    setMinOverall(p?.minOverall != null ? String(p.minOverall) : "");
    setMinDimension(p?.minDimension != null ? String(p.minDimension) : "");
    setSecurity(p?.minDimensionFor?.D9 != null);
    setSecurityFloor(p?.minDimensionFor?.D9 != null ? String(p.minDimensionFor.D9) : "50");
    setNoUngoverned(Boolean(p?.forbidPostures?.includes("ungoverned")));
    setRequireProtection(Boolean(p?.requireProtectedBranch));
  }

  // Which requested fields did the server's sanitizer silently DROP? sanitizeGatePolicy discards any
  // ≤0 / out-of-range floor ("not set" by contract), so a save can succeed while shedding fields the
  // form shows as enabled — e.g. Security checkbox on + floor cleared → `{ D9: 0 }` → no D9 floor
  // stored at all. The old null-vs-non-null echo check couldn't see a PARTIALLY-dropped policy, so the
  // owner was told "the gate now enforces it" about a bar that was never stored.
  function droppedFields(req: GatePolicy, stored: GatePolicy | null): string[] {
    const out: string[] = [];
    if (req.minLevel != null && stored?.minLevel !== req.minLevel) out.push("minimum level");
    if (req.minOverall != null && stored?.minOverall !== req.minOverall) out.push("min overall");
    if (req.minDimension != null && stored?.minDimension !== req.minDimension) out.push("min per-dimension");
    if (req.minDimensionFor?.D9 != null && stored?.minDimensionFor?.D9 !== req.minDimensionFor.D9)
      out.push("security floor (D9)");
    if (req.requireProtectedBranch && !stored?.requireProtectedBranch) out.push("protected-branch requirement");
    if (req.forbidPostures?.length && !req.forbidPostures.every((p) => stored?.forbidPostures?.includes(p)))
      out.push("forbidden postures");
    return out;
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
      setMsg(
        kind === "reset" || stored == null
          ? { kind: "note", text: "Reset to the archetype default — no custom bar is enforced." }
          : dropped.length > 0
            ? {
                kind: "error",
                text: `Saved, but NOT enforced: ${dropped.join(", ")} — 0 (or an out-of-range value) is not a valid bar, so the server cleared ${dropped.length > 1 ? "those fields" : "that field"}. The form now shows the stored policy.`,
              }
            : { kind: "note", text: "Policy saved — the gate now enforces it." },
      );
      router.refresh();
    } catch (e) {
      setMsg({ kind: "error", text: e instanceof Error ? e.message : "Failed to save policy." });
      setApplies(null);
    } finally {
      setBusy(null);
    }
  }

  function reset() {
    syncForm(null);
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
    noUngoverned,
    setNoUngoverned,
    requireProtection,
    setRequireProtection,
    busy,
    msg,
    applies,
    save: () => post(buildPolicy(), "save"),
    reset,
  };
}
