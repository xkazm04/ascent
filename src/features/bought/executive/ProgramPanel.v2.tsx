"use client";

// Prism transition programme. The ladder replaces the score-band baseline. The form keeps every id and save.
import { Caption, FormField, Frame, GhostAction, Input, Ladder, PrimaryAction, SectionHead, Select } from "@/components/kit";
import { LEVELS } from "@/lib/maturity/model";
import type { ProgramCadence, TransitionProgramRow } from "@/lib/db/org-program";
import type { LevelId } from "@/lib/types";
import { PaperMovement } from "./executiveMarks";
import { programLadderSteps } from "./programLadder";
import { CADENCE_LABEL, PROGRAM_ORIGIN_HINT } from "./programPanelConstants";
import { useProgramPanel } from "./useProgramPanel";

export function ProgramPanelV2({ slug, initial, now = null }: { slug: string; initial: TransitionProgramRow | null; now?: number | null }) {
  const s = useProgramPanel(slug, initial);
  const saved = s.program;
  const target = s.editing ? s.targetLevel : (saved?.targetLevel ?? s.targetLevel);
  const origin = saved?.baseline?.overall ?? null;
  return (
    <div data-tour="transition-program">
      <Frame>
        <SectionHead
          eyebrow="Transition programme"
          title={saved && !s.editing ? saved.name : saved ? "Re-target" : "Name the commitment"}
          named={saved && !s.editing ? `${saved.targetLevel} · ${CADENCE_LABEL[saved.cadence].toLowerCase()}` : "and its rung"}
        />
        <Caption className="mt-3">{PROGRAM_ORIGIN_HINT}</Caption>
        <Ladder className="mt-6" label="Maturity rungs" steps={programLadderSteps(now, target)} />
        {saved && !s.editing && (
          <div className="mt-4 space-y-3">
            {origin != null && now != null && <PaperMovement delta={now - origin} basis="from the frozen origin" />}
            <p className="type-body-sm text-slate-400">
              {origin != null
                ? `Origin frozen ${saved.baselineAt.slice(0, 10)} across ${saved.baseline?.scannedCount ?? 0} scanned repos.`
                : `Started ${saved.baselineAt.slice(0, 10)} with nothing scanned yet. No baseline was recorded, so movement is reported only once there is an origin to measure from, and the origin, once recorded, is never recomputed.`}
            </p>
            <div className="flex flex-wrap gap-2">
              <GhostAction onClick={() => s.setEditing(true)} disabled={s.busy}>Re-target</GhostAction>
              {saved.status === "active" ? (
                <GhostAction onClick={() => void s.patchStatus("paused")} disabled={s.busy}>Pause</GhostAction>
              ) : (
                <GhostAction onClick={() => void s.patchStatus("active")} disabled={s.busy}>Resume</GhostAction>
              )}
              {saved.status !== "achieved" && (
                <GhostAction onClick={() => void s.patchStatus("achieved")} disabled={s.busy}>Mark achieved</GhostAction>
              )}
            </div>
          </div>
        )}
        {s.editing && (
          <form onSubmit={s.save} className="mt-6 space-y-4">
            <FormField label="What are you doing?" htmlFor="program-name">
              <Input id="program-name" value={s.name} onChange={(e) => s.setName(e.target.value)} placeholder="Agent-ready by Q1" maxLength={80} />
            </FormField>
            <div className="grid gap-4 sm:grid-cols-3">
              <FormField label="Target rung" htmlFor="program-level">
                <Select id="program-level" value={s.targetLevel} onChange={(e) => s.setTargetLevel(e.target.value as LevelId)}>
                  {LEVELS.map((l) => (
                    <option key={l.id} value={l.id}>{l.id} · {l.name}</option>
                  ))}
                </Select>
              </FormField>
              <FormField label="By (optional)" htmlFor="program-date">
                <Input id="program-date" type="date" value={s.targetDate} onChange={(e) => s.setTargetDate(e.target.value)} />
              </FormField>
              <FormField label="Review cadence" htmlFor="program-cadence">
                <Select id="program-cadence" value={s.cadence} onChange={(e) => s.setCadence(e.target.value as ProgramCadence)}>
                  {(Object.keys(CADENCE_LABEL) as ProgramCadence[]).map((c) => (
                    <option key={c} value={c}>{CADENCE_LABEL[c]}</option>
                  ))}
                </Select>
              </FormField>
            </div>
            <p className="type-body-sm text-slate-400">
              {saved
                ? "Re-targeting keeps the original baseline; movement stays measured from where you started."
                : "Starting freezes today's fleet standing as the baseline. It is never recomputed."}
            </p>
            {s.error && (
              <p role="alert" className="type-body-sm text-slate-200">
                <span aria-hidden>! </span>
                {s.error}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <PrimaryAction type="submit" disabled={s.busy || !s.name.trim()}>
                {s.busy ? "Saving…" : saved ? "Save" : "Start programme"}
              </PrimaryAction>
              {saved && (
                <GhostAction type="button" onClick={() => s.setEditing(false)} disabled={s.busy}>Cancel</GhostAction>
              )}
            </div>
          </form>
        )}
      </Frame>
    </div>
  );
}
