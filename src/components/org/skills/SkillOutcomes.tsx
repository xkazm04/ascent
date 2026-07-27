// Adoption → outcome strip for one skill (src/lib/org/skill-outcomes.ts): for every repo that adopted
// this skill, the overall-score movement between the last scan BEFORE adoption and the latest scan since.
//
// Unmeasurable adoptions are shown, not hidden — "no scan since adoption yet" is a truthful, actionable
// state (it tells the org to re-scan), whereas a silently omitted row reads as "no effect". The wording
// is deliberately correlational ("since adoption"), never causal: other work lands in the same window.

import { outcomeStatusLabel, type SkillOutcome } from "@/lib/org/skill-outcomes";

const fmtDelta = (d: number) => `${d > 0 ? "+" : ""}${d}`;

function DeltaRow({ o }: { o: SkillOutcome }) {
  const measured = o.status === "measured" && o.overallDelta !== null;
  const delta = o.overallDelta ?? 0;
  const tone = !measured ? "text-slate-500" : delta > 0 ? "text-emerald-300" : delta < 0 ? "text-orange-300" : "text-slate-400";
  const top = o.dimensionDeltas.find((d) => d.delta !== 0);
  return (
    <li className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span className="font-mono text-slate-300">{o.repoFullName.split("/").pop()}</span>
      {measured ? (
        <>
          <span className={`font-mono tabular-nums ${tone}`} title={`${o.before!.overallScore} → ${o.after!.overallScore} overall`}>
            {fmtDelta(delta)} overall
          </span>
          <span className="text-slate-500">
            since adoption ({o.before!.scannedAt.slice(0, 10)} → {o.after!.scannedAt.slice(0, 10)})
          </span>
          {top && (
            <span className="font-mono text-slate-500" title="Largest per-dimension move in the same window">
              · {top.dimId} {fmtDelta(top.delta)}
            </span>
          )}
        </>
      ) : (
        <span className="text-slate-500">{outcomeStatusLabel(o.status)}</span>
      )}
    </li>
  );
}

export function SkillOutcomes({ outcomes }: { outcomes: SkillOutcome[] | undefined }) {
  if (!outcomes || outcomes.length === 0) return null;
  return (
    <div className="mt-3 border-t border-slate-800 pt-3">
      <p className="font-mono text-xs uppercase tracking-widest text-slate-500">Score movement since adoption</p>
      <ul className="mt-1.5 space-y-1 text-sm">
        {outcomes.map((o) => (
          <DeltaRow key={`${o.repoFullName}-${o.adoptedAt}`} o={o} />
        ))}
      </ul>
      <p className="mt-1.5 text-xs text-slate-600">
        Movement in the same window as the adoption — correlation, not proof of cause.
      </p>
    </div>
  );
}
