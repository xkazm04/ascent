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
  const [noUngoverned, setNoUngoverned] = useState<boolean>(Boolean(initial?.forbidPostures?.includes("ungoverned")));
  const [requireProtection, setRequireProtection] = useState<boolean>(Boolean(initial?.requireProtectedBranch));
  const [busy, setBusy] = useState<"save" | "reset" | null>(null);
  const [msg, setMsg] = useState<{ kind: "note" | "error"; text: string } | null>(null);

  function buildPolicy(): GatePolicy {
    const p: GatePolicy = {};
    if (minLevel) p.minLevel = minLevel as LevelId;
    if (minOverall.trim()) p.minOverall = Number(minOverall);
    if (minDimension.trim()) p.minDimension = Number(minDimension);
    if (security) p.minDimensionFor = { D9: 50 };
    if (noUngoverned || security) p.forbidPostures = ["ungoverned"];
    if (requireProtection) p.requireProtectedBranch = true;
    return p;
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
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d.error ?? "Failed to save policy.");
      setMsg({ kind: "note", text: kind === "reset" ? "Reset to the archetype default." : "Policy saved — the gate now enforces it." });
      router.refresh();
    } catch (e) {
      setMsg({ kind: "error", text: e instanceof Error ? e.message : "Failed to save policy." });
    } finally {
      setBusy(null);
    }
  }

  function reset() {
    setMinLevel("");
    setMinOverall("");
    setMinDimension("");
    setSecurity(false);
    setNoUngoverned(false);
    setRequireProtection(false);
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
            min={0}
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
            min={0}
            max={100}
            value={minDimension}
            onChange={(e) => setMinDimension(e.target.value)}
            placeholder="—"
            className="w-20 rounded-md border border-slate-700 bg-slate-950 px-2 py-1 text-sm text-slate-200 outline-none focus:border-accent"
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-400">
          <input type="checkbox" checked={security} onChange={(e) => setSecurity(e.target.checked)} className="accent-accent" />
          Security floor (D9 ≥ 50)
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
      <div className="mt-3 flex flex-wrap items-center gap-2">
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
        {msg && <span className={`font-mono text-sm ${msg.kind === "error" ? "text-orange-300" : "text-emerald-300"}`}>{msg.text}</span>}
      </div>
    </div>
  );
}
