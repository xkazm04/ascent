"use client";

// The retire sweep: review-then-retire for the skills the library's own dormancy model already calls
// prune candidates, with the blast radius stated before the ask and one undo after it.
//
// It replaces nothing and removes nothing - the per-row `archive` link stays. What it adds is the three
// rails a destructive bulk action needs and that link never had: the dependants enumerated up front
// (which repos recorded each skill, when it was last used, the window it was judged against), a confirm
// that quotes the count it is about to act on, and a restore.
//
// PRESENT ONLY WHEN IT HAS WORK. Zero candidates renders nothing at all - an empty "0 skills to retire"
// card is a permanent invitation to go looking for something to delete.
//
// The candidate set comes from skillRetireModel and the posted ids are `retirableIds` of that same array,
// so the preview and the execution cannot describe different things. The server then re-derives
// eligibility anyway (src/app/api/org/skills/retire/route.ts) and the result line shows ITS count, not
// this component's optimistic one.

import { useState } from "react";
import type { SkillAdoption, SkillRow } from "@/lib/db";
import type { SkillUsage } from "@/lib/org/skill-usage";
import { SkillRetireSweepRow } from "./SkillRetireSweepRow";
import {
  confirmLine,
  restoreOutcomeLine,
  RETIRE_SCOPE_SENTENCE,
  retirableIds,
  retireCandidates,
  sweepOutcomeLine,
  type SweepResult,
} from "./skillRetireModel";

type Phase = "idle" | "confirm" | "busy" | "done";

const LINK = "type-mono-sm text-slate-400 hover:text-slate-100";

export function SkillRetireSweep({
  skills,
  usage,
  adoption,
  isAdmin,
  sweep,
}: {
  skills: readonly SkillRow[];
  usage: Record<string, SkillUsage>;
  adoption: Record<string, SkillAdoption>;
  isAdmin: boolean;
  /** Posts the sweep. `(ids, restore) => the parsed body, or null when the call failed.` */
  sweep: (ids: string[], restore: boolean) => Promise<SweepResult | null>;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [line, setLine] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<{ id: string; reason: string }[]>([]);
  // The ids the LAST sweep asked for - what the undo posts back. Kept for the panel's whole session, so
  // the undo survives the result line being replaced.
  const [undoIds, setUndoIds] = useState<string[] | null>(null);

  const candidates = retireCandidates(skills, usage, adoption);
  const ids = retirableIds(candidates);
  // Archiving is admin-only (as the per-row link already is), and a library with no candidate gets no card.
  if (!isAdmin || candidates.length === 0) return null;

  async function run(post: string[], restore: boolean) {
    setPhase("busy");
    const res = await sweep(post, restore);
    if (!res) {
      setLine(`Could not ${restore ? "restore" : "retire"} those skills. Nothing changed.`);
      setSkipped([]);
      setPhase("done");
      return;
    }
    const skips = res.skipped ?? [];
    const n = (restore ? res.restored : res.retired) ?? 0;
    setLine(
      restore ? restoreOutcomeLine(post.length, n, skips.length) : sweepOutcomeLine(post.length, n, skips.length),
    );
    setSkipped(skips);
    setUndoIds(restore ? null : post);
    setPhase("done");
  }

  return (
    <section
      data-testid="skill-retire-sweep"
      data-skill-retire-sweep
      className="mt-3 rounded-xl border border-amber-500/25 bg-slate-950/40 p-4"
    >
      <p className="type-label tracking-[0.16em] text-amber-300/80">
        Retire sweep · {candidates.length} prune {candidates.length === 1 ? "candidate" : "candidates"}
      </p>
      <p data-testid="retire-scope" className="mt-1 type-body-sm text-slate-500">
        {RETIRE_SCOPE_SENTENCE}
      </p>

      <ul className="mt-2">
        {candidates.map((c) => (
          <SkillRetireSweepRow key={c.id} c={c} />
        ))}
      </ul>

      {phase === "idle" && ids.length > 0 && (
        <button data-testid="retire-start" onClick={() => setPhase("confirm")} className={`mt-3 ${LINK}`}>
          review and retire
        </button>
      )}

      {phase === "confirm" && (
        <div className="mt-3 flex flex-wrap items-baseline gap-3">
          <p data-testid="retire-confirm" className="type-body-sm text-slate-200">
            {confirmLine(ids.length)}
          </p>
          <button data-testid="retire-go" onClick={() => void run(ids, false)} className={LINK}>
            retire
          </button>
          <button data-testid="retire-cancel" onClick={() => setPhase("idle")} className={LINK}>
            cancel
          </button>
        </div>
      )}

      {phase === "busy" && <p className="mt-3 type-body-sm text-slate-500">Working…</p>}

      {phase === "done" && (
        <div className="mt-3 flex flex-wrap items-baseline gap-3">
          <p data-testid="retire-result" role="status" className="type-body-sm text-slate-200">
            {line}
          </p>
          {skipped.length > 0 && (
            <p data-testid="retire-skipped" className="type-body-sm text-slate-500">
              Skipped: {skipped.map((s) => `${s.id} (${s.reason})`).join(", ")}
            </p>
          )}
          {undoIds && undoIds.length > 0 && (
            <button data-testid="retire-undo" onClick={() => void run(undoIds, true)} className={LINK}>
              undo
            </button>
          )}
          {!undoIds && (
            <button data-testid="retire-again" onClick={() => setPhase("idle")} className={LINK}>
              done
            </button>
          )}
        </div>
      )}
    </section>
  );
}
