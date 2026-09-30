"use client";

// State and saves for the transition program. Both compositions call this so the form cannot drift.
import { useState, type FormEvent } from "react";
import type { ProgramCadence, TransitionProgramRow } from "@/lib/db/org-program";

export function useProgramPanel(slug: string, initial: TransitionProgramRow | null) {
  const [program, setProgram] = useState(initial);
  const [editing, setEditing] = useState(initial == null);
  const [name, setName] = useState(initial?.name ?? "");
  const [targetLevel, setTargetLevel] = useState(initial?.targetLevel ?? "L4");
  const [targetDate, setTargetDate] = useState(initial?.targetDate?.slice(0, 10) ?? "");
  const [cadence, setCadence] = useState<ProgramCadence>(initial?.cadence ?? "weekly");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: FormEvent) {
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

  return {
    program, editing, setEditing, name, setName, targetLevel, setTargetLevel,
    targetDate, setTargetDate, cadence, setCadence, busy, error, save, patchStatus,
  };
}

export type ProgramPanelState = ReturnType<typeof useProgramPanel>;
