// STD-6 onboarding-skill history panel for the report permalink, extracted from page.tsx (300-LOC
// rule). Server component: no hooks, no handlers.

import { diffTrackSets, type SkillGenerationRow } from "@/lib/db";
import { PRACTICES } from "@/lib/practices";

/** STD-6: a compact "onboarding skill over time" panel — most-recent track set + what changed since
 *  the prior generation — turning the one-off SKILL.md download into a visible, tracked program. */
export function SkillHistorySection({ rows }: { rows: Pick<SkillGenerationRow, "headSha" | "trackIds" | "generatedAt">[] }) {
  const labelFor = (id: string) => PRACTICES.find((p) => p.id === id)?.label ?? id;
  const latest = rows[0]!; // rows is non-empty (guarded by the caller)
  const prev = rows[1];
  const diff = prev ? diffTrackSets(prev.trackIds, latest.trackIds) : null;
  return (
    <section className="mt-8 rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
      <h2 className="type-body font-semibold text-white">
        Onboarding skill <span className="font-normal text-slate-500">· generated {rows.length}× · last {latest.generatedAt.slice(0, 10)}</span>
      </h2>
      <div className="mt-3 flex flex-wrap gap-1.5">
        {latest.trackIds.length === 0 ? (
          <span className="type-body-sm text-slate-500">No open tracks. The skill targeted no gaps at last generation.</span>
        ) : (
          latest.trackIds.map((id) => (
            <span key={id} className="rounded-full border border-slate-700 bg-slate-950/40 px-2.5 py-0.5 type-mono-sm text-slate-300">
              {labelFor(id)}
            </span>
          ))
        )}
      </div>
      {diff && (diff.added.length > 0 || diff.dropped.length > 0) && (
        <p className="mt-3 type-mono-sm">
          {diff.added.length > 0 && <span className="text-emerald-300">+ {diff.added.map(labelFor).join(", ")}</span>}
          {diff.added.length > 0 && diff.dropped.length > 0 && <span className="text-slate-600"> · </span>}
          {diff.dropped.length > 0 && <span className="text-slate-500">✓ done: {diff.dropped.map(labelFor).join(", ")}</span>}
          <span className="text-slate-600"> since the prior generation</span>
        </p>
      )}
    </section>
  );
}

/** The skill-history read FAILED. Said out loud: hiding the section would read exactly like a repo
 *  that never generated a skill, which is a claim nobody measured. */
export function SkillHistoryUnavailable() {
  return (
    <section data-testid="skill-history-unavailable" className="mt-8 rounded-2xl border border-slate-800 bg-slate-900/40 p-6">
      <h2 className="type-body font-semibold text-white">Onboarding skill</h2>
      <p className="mt-2 type-body-sm text-slate-500">Couldn&apos;t load the skill history just now. Reload the page to try again.</p>
    </section>
  );
}
