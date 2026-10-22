// What the sandbox commit will do, row by row, before it writes, and what it did, row by row, after
// (roadmap-1). Presentational only: no hooks, so no "use client" (the bar that renders it is one).

import {
  OUTCOME_LABEL,
  SKIP_LABEL,
  summarizeSandboxPlan,
  type CommitOutcome,
  type CommitOutcomeRow,
  type SandboxCommitPlan,
} from "@/components/report/sandboxCommitModel";

const OUTCOME_TONE: Record<CommitOutcome, string> = {
  tracked: "text-emerald-300",
  held: "text-slate-400",
  "not-open": "text-slate-400",
  failed: "text-amber-200/90",
};

function Row({ title, label, tone }: { title: string; label: string; tone: string }) {
  return (
    <li className="flex items-baseline justify-between gap-3">
      <span className="min-w-0 truncate text-slate-300">{title}</span>
      <span className={`shrink-0 ${tone}`}>{label}</span>
    </li>
  );
}

/** Before the commit: the rows it will start, the rows it skips (with the status and holder), and
 *  the items with no persisted rec for this scan. */
export function SandboxCommitPreview({ plan }: { plan: SandboxCommitPlan }) {
  const empty = plan.start.length + plan.skip.length + plan.unmatched.length === 0;
  if (empty) return null;
  return (
    <div className="mt-2">
      <p className="type-body-sm text-slate-300">{summarizeSandboxPlan(plan)}</p>
      <ul className="mt-1 max-w-prose space-y-0.5 type-body-sm" aria-label="What this commit will do">
        {plan.start.map((rec) => (
          <Row key={rec.id} title={rec.title} label="will start" tone="text-accent" />
        ))}
        {plan.skip.map(({ rec, status }) => (
          <Row
            key={rec.id}
            title={rec.title}
            label={`skip: ${SKIP_LABEL[status]}${status === "in_progress" && rec.assigneeLogin ? ` (@${rec.assigneeLogin})` : ""}`}
            tone="text-slate-500"
          />
        ))}
        {plan.unmatched.map((item, i) => (
          <Row key={`u${i}`} title={item.title} label="skip: not tracked" tone="text-slate-500" />
        ))}
      </ul>
    </div>
  );
}

/** After the commit: each started row reads tracked, held, no longer open, or failed. */
export function SandboxCommitOutcome({ rows }: { rows: CommitOutcomeRow[] }) {
  if (rows.length === 0) return null;
  return (
    <ul className="mt-1 max-w-prose space-y-0.5 type-body-sm" aria-label="What this commit did">
      {rows.map((r) => (
        <Row key={r.id} title={r.title} label={OUTCOME_LABEL[r.outcome]} tone={OUTCOME_TONE[r.outcome]} />
      ))}
    </ul>
  );
}
