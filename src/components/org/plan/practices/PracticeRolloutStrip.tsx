"use client";

// G7-20 — the "applied → landed → lift" rollup for the whole Practice Library, above the ledger.
//
// Every figure here is folded from rows already on screen (see summarizeRollout); nothing is fetched
// or persisted for it. It renders only when something has actually been rolled out, and every average
// states its sample — a lift backed by two repos is not a fleet result, and the strip says which it is
// rather than letting a bare "▲ +9" imply the fleet moved.

import { rolloutIsMeaningful, type PracticeRollout } from "./practiceRows";

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="min-w-[8rem]">
      <div className="font-mono text-sm uppercase tracking-widest text-slate-500">{label}</div>
      <div className={`font-mono text-xl font-bold tabular-nums ${tone ?? "text-white"}`}>{value}</div>
      {hint && <div className="font-mono text-sm text-slate-500">{hint}</div>}
    </div>
  );
}

const liftText = (n: number) => (n > 0 ? `▲ +${n}` : n < 0 ? `▼ ${n}` : "± 0");
const liftTone = (n: number) => (n > 0 ? "text-emerald-300" : n < 0 ? "text-orange-300" : "text-slate-400");

export function PracticeRolloutStrip({ rollout: r }: { rollout: PracticeRollout }) {
  if (!rolloutIsMeaningful(r)) return null;

  return (
    <div className="flex flex-wrap items-start gap-x-8 gap-y-4 rounded-xl border border-slate-800 bg-slate-950/40 p-4">
      <Stat
        label="Repos adopting"
        value={String(r.adoptingRepos)}
        hint={`across ${r.playbooksAdopted} playbook${r.playbooksAdopted === 1 ? "" : "s"}`}
      />
      <Stat
        label="Starter PRs"
        value={`${r.prsMerged} landed`}
        hint={r.prsOpen > 0 ? `${r.prsOpen} still in flight` : "none in flight"}
      />
      {r.playbookLift != null ? (
        <Stat
          label="Playbook lift"
          value={liftText(r.playbookLift)}
          tone={liftTone(r.playbookLift)}
          hint={`avg dimension points · ${r.playbookMeasured} measured adoption${r.playbookMeasured === 1 ? "" : "s"}`}
        />
      ) : (
        <Stat label="Playbook lift" value="—" hint="no repo has been scanned on both sides yet" />
      )}
      {r.practiceLift != null ? (
        <Stat
          label="Practice PR lift"
          value={liftText(r.practiceLift)}
          tone={liftTone(r.practiceLift)}
          hint={`avg dimension points · ${r.practiceLiftSources} practice${r.practiceLiftSources === 1 ? "" : "s"} measured`}
        />
      ) : (
        <Stat label="Practice PR lift" value="—" hint="awaiting a post-merge rescan" />
      )}
    </div>
  );
}
