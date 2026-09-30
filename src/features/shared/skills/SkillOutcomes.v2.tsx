// Score movement since adoption. A missing pair is a word, never a zero delta. Numbers stay paper.
import { Caption, CellMark, DimensionMark, Movement } from "@/components/kit";
import type { SkillOutcome } from "@/lib/org/skill-outcomes";
import { anchorNote, outcomeHeadline, outcomeMark, wideWindowNote } from "./skillSceneModel";

function DeltaRow({ o }: { o: SkillOutcome }) {
  const mark = outcomeMark(o.status);
  const measured = o.status === "measured" && o.overallDelta !== null && o.before && o.after;
  const top = o.dimensionDeltas.find((d) => d.delta !== 0);
  const wide = wideWindowNote(o);
  const repo = o.repoFullName.split("/").pop();
  return (
    <li className="border-t border-divider py-2">
      <p className="type-body-sm text-slate-200">{repo}</p>
      <Caption>{anchorNote(o.anchor)}</Caption>
      <CellMark state={mark.state}>{mark.word}</CellMark>
      {measured ? (
        <>
          <p className="mt-1 text-slate-200">
            {o.overallDelta === 0 ? (
              <span>Held at the same score.</span>
            ) : (
              <Movement
                delta={o.overallDelta}
                basis="since adoption"
                toneClass={() => "text-slate-200"}
              />
            )}
          </p>
          <Caption>
            {o.before!.overallScore} to {o.after!.overallScore} overall, {o.before!.scannedAt.slice(0, 10)} to{" "}
            {o.after!.scannedAt.slice(0, 10)}. Correlation, not proof of cause.
          </Caption>
          {top && (
            <p className="mt-1 flex flex-wrap items-center gap-2 text-slate-200">
              <DimensionMark id={top.dimId} />
              <Movement delta={top.delta} basis="largest move in the same window" toneClass={() => "text-slate-200"} />
            </p>
          )}
          {wide && <Caption>{wide}</Caption>}
        </>
      ) : null}
    </li>
  );
}

export function SkillOutcomesV2({ outcomes }: { outcomes: SkillOutcome[] | undefined }) {
  if (!outcomes || outcomes.length === 0) return null;
  return (
    <div className="mt-4">
      <p className="type-body-sm font-medium text-slate-100">Score movement since adoption</p>
      <Caption className="mt-1">{outcomeHeadline(outcomes)}</Caption>
      <ul className="mt-2">{outcomes.map((o) => <DeltaRow key={`${o.repoFullName}-${o.adoptedAt}`} o={o} />)}</ul>
    </div>
  );
}
