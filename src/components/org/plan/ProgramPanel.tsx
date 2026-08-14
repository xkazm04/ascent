"use client";

// The transition programme's control (W1c) — where an org names its commitment, and the only place
// that commitment can be started, re-targeted, paused or ended.
//
// It sits at the TOP of the Plan tab, above Goals, because it is the frame those goals hang off: a
// goal is a number the fleet steers toward, a programme is the named, dated thing the org is
// actually doing. The one-line strip in the shell (ProgramStrip) is this object's read view.
//
// Re-targeting deliberately does NOT re-baseline. The form says so, because a UI that quietly reset
// the origin every time someone fixed a typo in the name would make every measurement since the
// start disappear — see startProgram's contract in src/lib/db/org-program.ts.

import { useState } from "react";
import { Card, SectionHeader } from "@/components/org/shared/ui";
import { LEVELS } from "@/lib/maturity/model";
import type { ProgramCadence, TransitionProgramRow } from "@/lib/db/org-program";
import type { LevelId } from "@/lib/types";

const CADENCE_LABEL: Record<ProgramCadence, string> = {
  weekly: "Weekly",
  biweekly: "Every 2 weeks",
  monthly: "Monthly",
};

const inputClass =
  "w-full rounded-md border border-divider bg-ink px-3 py-2 text-sm text-white placeholder:text-slate-600 focus-ring";
const labelClass = "block font-mono text-xs uppercase tracking-[0.14em] text-slate-500";

export function ProgramPanel({ slug, initial }: { slug: string; initial: TransitionProgramRow | null }) {
  const [program, setProgram] = useState(initial);
  const [editing, setEditing] = useState(initial == null);
  const [name, setName] = useState(initial?.name ?? "");
  const [targetLevel, setTargetLevel] = useState(initial?.targetLevel ?? "L4");
  const [targetDate, setTargetDate] = useState(initial?.targetDate?.slice(0, 10) ?? "");
  const [cadence, setCadence] = useState<ProgramCadence>(initial?.cadence ?? "weekly");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/org/program", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org: slug, name: name.trim(), targetLevel, targetDate: targetDate || null, cadence }),
      });
      const json = (await res.json().catch(() => ({}))) as { program?: TransitionProgramRow; error?: string };
      if (!res.ok) {
        setError(json.error ?? "Couldn't save the programme.");
        return;
      }
      setProgram(json.program ?? null);
      setEditing(false);
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  }

  async function patchStatus(status: "active" | "paused" | "achieved") {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/org/program", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org: slug, status }),
      });
      if (res.ok && program) setProgram({ ...program, status });
      else if (!res.ok) setError("Couldn't update the programme.");
    } catch {
      setError("Couldn't reach the server.");
    } finally {
      setBusy(false);
    }
  }

  return (
    // data-tour: the getting-started `program` step spotlights this control (GETTING_STARTED_ANCHORS).
    <Card>
      <div data-tour="transition-program" />
      <SectionHeader
        size="sm"
        title="Transition programme"
        description="The named, dated thing this org is actually doing — the frame the goals below hang off. Its baseline is frozen the moment it starts, so every later number is measured against a fixed origin."
      />

      {!editing && program && (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-lg text-white">{program.name}</span>
            <span className="font-mono text-xs uppercase tracking-widest text-slate-500">
              → {program.targetLevel} · {CADENCE_LABEL[program.cadence].toLowerCase()} review
              {program.targetDate ? ` · by ${program.targetDate.slice(0, 10)}` : " · open-ended"}
            </span>
          </div>
          <p className="text-sm text-slate-400">
            {program.baseline
              ? `Baseline frozen ${program.baselineAt.slice(0, 10)} at ${program.baseline.overall ?? "—"} overall across ${program.baseline.scannedCount} scanned repos.`
              : `Started ${program.baselineAt.slice(0, 10)} with nothing scanned yet — no baseline was recorded, so movement is reported only once there is an origin to measure from.`}
          </p>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => setEditing(true)} disabled={busy} className="focus-ring rounded-md border border-divider px-3 py-1.5 text-sm text-slate-300 transition hover:text-white disabled:opacity-50">
              Re-target
            </button>
            {program.status === "active" ? (
              <button type="button" onClick={() => void patchStatus("paused")} disabled={busy} className="focus-ring rounded-md border border-divider px-3 py-1.5 text-sm text-slate-400 transition hover:text-white disabled:opacity-50">
                Pause
              </button>
            ) : (
              <button type="button" onClick={() => void patchStatus("active")} disabled={busy} className="focus-ring rounded-md border border-divider px-3 py-1.5 text-sm text-slate-400 transition hover:text-white disabled:opacity-50">
                Resume
              </button>
            )}
            {program.status !== "achieved" && (
              <button type="button" onClick={() => void patchStatus("achieved")} disabled={busy} className="focus-ring rounded-md border border-divider px-3 py-1.5 text-sm text-slate-400 transition hover:text-white disabled:opacity-50">
                Mark achieved
              </button>
            )}
          </div>
        </div>
      )}

      {editing && (
        <form onSubmit={save} className="mt-4 space-y-3">
          <div>
            <label className={labelClass} htmlFor="program-name">
              What are you doing?
            </label>
            <input
              id="program-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Agent-ready by Q1"
              maxLength={80}
              className={`mt-1 ${inputClass}`}
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className={labelClass} htmlFor="program-level">
                Target rung
              </label>
              <select
                id="program-level"
                value={targetLevel}
                onChange={(e) => setTargetLevel(e.target.value as LevelId)}
                className={`mt-1 ${inputClass}`}
              >
                {LEVELS.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.id} · {l.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass} htmlFor="program-date">
                By (optional)
              </label>
              <input id="program-date" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} className={`mt-1 ${inputClass}`} />
            </div>
            <div>
              <label className={labelClass} htmlFor="program-cadence">
                Review cadence
              </label>
              <select id="program-cadence" value={cadence} onChange={(e) => setCadence(e.target.value as ProgramCadence)} className={`mt-1 ${inputClass}`}>
                {(Object.keys(CADENCE_LABEL) as ProgramCadence[]).map((c) => (
                  <option key={c} value={c}>
                    {CADENCE_LABEL[c]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Said out loud, because a form that silently moved the origin would erase every
              measurement taken since the start. */}
          <p className="text-sm text-slate-500">
            {program
              ? "Re-targeting keeps the original baseline — movement stays measured from where you started."
              : "Starting freezes today's fleet standing as the baseline. It is never recomputed."}
          </p>

          {error && <p className="text-sm text-orange-300">{error}</p>}

          <div className="flex gap-2">
            <button type="submit" disabled={busy || !name.trim()} className="focus-ring rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-ink transition disabled:opacity-50">
              {busy ? "Saving…" : program ? "Save" : "Start programme"}
            </button>
            {program && (
              <button type="button" onClick={() => setEditing(false)} disabled={busy} className="focus-ring rounded-md border border-divider px-3 py-1.5 text-sm text-slate-400 transition hover:text-white disabled:opacity-50">
                Cancel
              </button>
            )}
          </div>
        </form>
      )}
    </Card>
  );
}
