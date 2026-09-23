// THE REAL PLAN, in the row that asks for a verdict on it (`hitl-approval/oracle-before-gate`): the
// reviewer sees what they are approving — every item's approach and files, each declared architecture
// move as `from → to` with its kind, which partition the moves were measured against, the risks, what
// the plan will not do, the check that proves it, and the planner's raw text. A held plan also carries
// its evidence: the branch the fence parked the commits on, its files with their +/- counts read inline
// (`HeldDiff`), and the command that shows them. Approving a held plan lands exactly those commits.
//
// No hooks: a pure rendering of the record (the held diff and the copy button are client islands).

import { Kicker } from "@/components/ui";
import { HeldDiff } from "./HeldDiff";
import type { LoopPlanRecord } from "./ledgerTypes";

const MOVE_WORDS: Record<string, string> = {
  "module-created": "creates a module",
  "module-removed": "removes a module",
  "module-split": "splits a module",
  "module-merged": "merges modules",
  "cross-module-move": "moves code across modules",
};

const PARTITION_WORDS: Record<string, string> = {
  "context-map": "the repo's context map",
  workspace: "its workspace packages",
  directory: "its top-level directories",
};

function List({ title, items, empty }: { title: string; items: readonly string[]; empty: string }) {
  return (
    <div>
      <Kicker tone="muted" as="span">{title}</Kicker>
      {items.length === 0 ? (
        <p className="type-body-sm text-slate-500">{empty}</p>
      ) : (
        <ul className="mt-0.5 list-disc space-y-0.5 pl-5 type-body-sm text-slate-300">
          {items.map((x, i) => <li key={i}>{x}</li>)}
        </ul>
      )}
    </div>
  );
}

export function PlanReview({ plan: p }: { plan: LoopPlanRecord }) {
  const body = p.plan;
  const titleOf = (recId: string) => p.itemTitles[p.recIds.indexOf(recId)] || recId;
  return (
    <div data-testid="plan-review" className="space-y-4 pt-1">
      {p.heldBranch && (
        <div data-testid="plan-held" className="rounded-lg border border-warn/40 px-4 py-3">
          <p className="type-body-sm text-slate-200">
            The fence held this lane&apos;s work on <code className="font-mono text-warn">{p.heldBranch}</code>. These are the
            commits the plan did not declare, and approving lands exactly these. Read them before you decide:
          </p>
          <HeldDiff planId={p.id} heldBranch={p.heldBranch} />
        </div>
      )}
      {!body ? (
        <p className="type-body-sm text-warn">The planner&apos;s output could not be parsed into a plan — the raw text below is all there is.</p>
      ) : (
        <>
          <ol className="space-y-3">
            {body.items.map((it) => (
              <li key={it.recommendationId} className="space-y-1">
                <p className="type-body text-slate-100">{titleOf(it.recommendationId)}</p>
                <p className="type-body-sm text-slate-300">{it.approach || "No approach given."}</p>
                {it.files.length > 0 && <p className="font-mono type-caption text-slate-500">{it.files.join(" · ")}</p>}
              </li>
            ))}
          </ol>
          <div>
            <Kicker tone="muted" as="span">Architecture moves</Kicker>
            {body.items.every((it) => it.moves.length === 0) ? (
              <p className="type-body-sm text-slate-500">None declared.</p>
            ) : (
              <ul data-testid="plan-moves" className="mt-0.5 space-y-0.5">
                {body.items.flatMap((it) =>
                  it.moves.map((m, i) => (
                    <li key={`${it.recommendationId}-${i}`} className="font-mono type-caption text-slate-300">
                      {m.from ?? "(new)"} → {m.to ?? "(removed)"} <span className="text-slate-500">· {MOVE_WORDS[m.kind] ?? m.kind}</span>
                    </li>
                  )),
                )}
              </ul>
            )}
            <p className="mt-1 type-caption text-slate-500">
              {p.partition
                ? `Measured against ${PARTITION_WORDS[p.partition.source] ?? p.partition.source} (${p.partition.modules.length} modules).`
                : "No module partition was recorded for this plan."}
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <List title="Risks" items={body.risks} empty="None named." />
            <List title="Not doing" items={body.notDoing} empty="Nothing excluded." />
          </div>
          <div>
            <Kicker tone="muted" as="span">The check that proves it</Kicker>
            <p className="type-body-sm text-slate-300">{body.check || "No check named."}</p>
          </div>
        </>
      )}
      <details className="rounded-lg border border-divider px-3 py-2">
        <summary className="focus-ring cursor-pointer type-caption text-slate-400">The planner&apos;s raw text</summary>
        <pre data-testid="plan-text" className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono type-micro text-slate-400">
          {p.planText || "(empty)"}
        </pre>
      </details>
    </div>
  );
}
