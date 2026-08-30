"use client";

// The owner override (moonshot #8) — the control that turns a DERIVED tier into a RECORDED DECISION.
// POST /api/org/admission, audited as `org.admission`.
//
// Two rules the UI holds, both of them the point of the feature:
//  • A repo with no assessed tier cannot be granted one here. The tier select is disabled and says
//    "not assessed" — a grant nobody measured is exactly the fiction this table exists to end.
//  • The DERIVED value is shown beside the grant whenever they differ, so an owner sees what they
//    are departing from at the moment they depart from it, not afterwards in an audit row.

import { useState } from "react";
import { MODE_META, type AdmissionView } from "./admissionRows";
import type { AdmissionMode } from "@/lib/org/admission";
import type { AutonomyTierId } from "@/lib/types";

const MODES: AdmissionMode[] = ["agents-allowed", "assisted-only", "blocked"];
const TIERS: AutonomyTierId[] = ["T0", "T1", "T2", "T3"];

const FIELD =
  "rounded-md border border-slate-700 bg-slate-950 px-2 py-1 font-mono type-micro text-slate-200 outline-none focus:border-accent disabled:opacity-40";

export function AdmissionOverrideControl({ org, view, onSaved }: { org: string; view: AdmissionView; onSaved: () => void }) {
  const [mode, setMode] = useState<AdmissionMode>(view.mode);
  const [tier, setTier] = useState<AutonomyTierId>(view.tier ?? "T0");
  const [rationale, setRationale] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const assessed = view.tier !== null;
  const dirty = mode !== view.mode || (assessed && tier !== view.tier);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/org/admission", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org, repo: view.fullName, mode, grantedTier: assessed ? tier : "T0", rationale }),
      });
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(d.error ?? "The decision could not be recorded.");
      setRationale("");
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The decision could not be recorded.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-1.5">
        <span className="sr-only">Admission mode for {view.fullName}</span>
        <select value={mode} onChange={(e) => setMode(e.target.value as AdmissionMode)} className={FIELD}>
          {MODES.map((m) => (
            <option key={m} value={m}>
              {MODE_META[m].label}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-1.5">
        <span className="sr-only">Granted autonomy tier for {view.fullName}</span>
        <select value={tier} onChange={(e) => setTier(e.target.value as AutonomyTierId)} disabled={!assessed} className={FIELD}>
          {TIERS.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </label>
      {!assessed && <span className="type-micro text-slate-500">Tier not assessed — scan this repo to grant one.</span>}
      {assessed && view.overridesDerived && (
        <span className="font-mono type-micro text-orange-300">overrides derived {view.overridesDerived}</span>
      )}
      <label className="flex-1">
        <span className="sr-only">Why</span>
        <input
          value={rationale}
          onChange={(e) => setRationale(e.target.value)}
          placeholder="Why (recorded in the audit log)"
          className={`${FIELD} w-full min-w-40`}
        />
      </label>
      <button
        onClick={save}
        disabled={busy || !dirty}
        className="focus-ring rounded-md border border-accent/50 bg-accent/10 px-3 py-1 font-mono type-micro uppercase tracking-[0.14em] text-white transition hover:bg-accent/20 disabled:opacity-40"
      >
        {busy ? "Recording…" : "Record decision"}
      </button>
      <span role="status" aria-live="polite" className="type-micro text-orange-300">
        {error ?? ""}
      </span>
    </div>
  );
}
