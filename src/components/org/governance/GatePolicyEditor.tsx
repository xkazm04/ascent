"use client";

// Owner-only editor for the org's CI maturity-gate policy (GATE-1). The App-mode PR Check Run and the
// governance fleet view both resolve this persisted policy; before it, the App check ignored any bar
// and used archetype defaults. Saving POSTs the policy; "Reset to default" clears it (null).

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { GatePolicy } from "@/lib/scoring/gate";
import type { LevelId } from "@/lib/types";

const LEVELS: LevelId[] = ["L1", "L2", "L3", "L4", "L5"];

export function GatePolicyEditor({ org, initial }: { org: string; initial: GatePolicy | null }) {
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

  function buildPolicy(): GatePolicy {
    const p: GatePolicy = {};
    if (minLevel) p.minLevel = minLevel as LevelId;
    if (minOverall.trim()) p.minOverall = Number(minOverall);
    if (minDimension.trim()) p.minDimension = Number(minDimension);
    if (security) {
      // Preserve the configured floor (clamped 0..100) instead of overwriting it with a fixed 50.
      const floor = Math.max(0, Math.min(100, Number(securityFloor) || 0));
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
    try {
      const res = await fetch("/api/org/gate-policy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org, policy }),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string; policy?: GatePolicy | null };
      if (!res.ok) throw new Error(d.error ?? "Failed to save policy.");
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
    } finally {
      setBusy(null);
    }
  }

  function reset() {
    syncForm(null);
    void post(null, "reset");
  }

  return (
    <div className="mt-4 border-t border-slate-800 pt-4">
      <div className="font-mono text-sm uppercase tracking-widest text-accent">Edit policy</div>
      <div className="mt-2 grid gap-3 sm:grid-cols-2">
        <label className="flex items-center justify-between gap-2 text-sm text-slate-400">
          Minimum level
          <select
            value={minLevel}
            onChange={(e) => setMinLevel(e.target.value)}
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
            value={minOverall}
            onChange={(e) => setMinOverall(e.target.value)}
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
            value={minDimension}
            onChange={(e) => setMinDimension(e.target.value)}
            placeholder="—"
            className="w-20 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-200 outline-none focus:border-accent"
          />
        </label>
        <label className="flex items-center justify-between gap-2 text-sm text-slate-400">
          <span className="flex items-center gap-2">
            <input type="checkbox" checked={security} onChange={(e) => setSecurity(e.target.checked)} className="accent-accent" />
            Security floor (D9 ≥)
          </span>
          <input
            type="number"
            min={1}
            max={100}
            value={securityFloor}
            disabled={!security}
            onChange={(e) => setSecurityFloor(e.target.value)}
            className="w-20 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-200 outline-none focus:border-accent disabled:opacity-50"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-400">
          <input type="checkbox" checked={noUngoverned} onChange={(e) => setNoUngoverned(e.target.checked)} className="accent-accent" />
          Forbid &quot;ungoverned&quot; posture
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-400">
          <input type="checkbox" checked={requireProtection} onChange={(e) => setRequireProtection(e.target.checked)} className="accent-accent" />
          Require a protected default branch
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2" aria-busy={busy !== null}>
        <button
          onClick={() => post(buildPolicy(), "save")}
          disabled={busy !== null}
          className="rounded-md border border-accent/50 bg-accent/10 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-accent/20 disabled:opacity-50"
        >
          {busy === "save" ? "Saving…" : "Save policy"}
        </button>
        <button
          onClick={reset}
          disabled={busy !== null}
          className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-400 transition hover:border-orange-400 hover:text-orange-300 disabled:opacity-50"
        >
          Reset to default
        </button>
        {/* Persistent polite live region (rendered always, content swapped) so save/reset outcomes are
            ANNOUNCED to screen readers — the old `{msg && <span …>}` was inserted after the fact, which
            assistive tech never reads, leaving success, silent field-dropping, and failure all
            indistinguishable on a merge-blocking form. Errors carry a textual "Error:" prefix so the
            kind isn't conveyed by color alone (WCAG 1.4.1). (ambiguity-ui ci-gate #5) */}
        <span
          role="status"
          aria-live="polite"
          className={`font-mono text-sm ${msg?.kind === "error" ? "text-orange-300" : "text-emerald-300"}`}
        >
          {msg ? (msg.kind === "error" ? `Error: ${msg.text}` : msg.text) : ""}
        </span>
      </div>
    </div>
  );
}
