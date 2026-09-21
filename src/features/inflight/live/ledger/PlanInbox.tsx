"use client";

// THE APPROVAL INBOX — every pending plan, one surface, each decidable in place
// (`hitl-approval/review-queues`). A row reads: repo, intent, the items it would work, and WHY it waits
// (the classifier's reason, verbatim). Opening it shows the real plan (`PlanReview`) and, for an owner,
// the verdict (`PlanDecision`). A viewer reads the same queue with no verdict offered.
//
// NO BATCH VERDICT. The shared `DecisionTable` is a selection-and-bulk-bar shape, but pending plans are
// heterogeneous by construction — each moves a different part of a different codebase — and a batch
// approval across them is the rubber stamp with better ergonomics. So nothing here is selectable and no
// bulk action is offered; every plan is decided on its own row.

import { DecisionTable, type DecisionColumn } from "@/components/org/shared/DecisionTable";
import { InlineEmpty } from "@/components/org/shared/ui";
import { fmtAgo, shortRepo } from "./ledgerFormat";
import { planReason } from "./ledgerModel";
import { PlanDecision } from "./PlanDecision";
import { PlanReview } from "./PlanReview";
import type { LoopDirectionRecord, LoopPlanRecord } from "./ledgerTypes";

const NONE = new Set<string>();
const noop = () => {};
const never = () => false;

const intentOf = (p: LoopPlanRecord): string =>
  p.plan?.intent?.trim() || p.planText.trim().split("\n")[0]?.trim() || "A plan waits for review";

export interface PlanInboxProps {
  plans: readonly LoopPlanRecord[];
  now: string;
  isOwner: boolean;
  onDecided: (plan: LoopPlanRecord, direction: LoopDirectionRecord | null) => void;
}

export function PlanInbox({ plans, now, isOwner, onDecided }: PlanInboxProps) {
  const columns: DecisionColumn<LoopPlanRecord>[] = [
    { key: "repo", header: "Repo", cell: (p) => <span className="type-mono-sm text-slate-200" title={p.repo}>{shortRepo(p.repo)}</span> },
    {
      key: "intent",
      header: "Intent",
      cell: (p, ctx) => (
        <button
          type="button"
          aria-expanded={ctx.open}
          onClick={ctx.toggleOpen}
          className="focus-ring rounded text-left type-body-sm text-slate-100 hover:text-accent-soft"
        >
          {ctx.open ? "▾ " : "▸ "}
          {intentOf(p)}
        </button>
      ),
    },
    {
      key: "items",
      header: "Items",
      cell: (p) => (
        <span className="type-body-sm text-slate-400" title={p.itemTitles.join("\n")}>
          {p.itemTitles.slice(0, 2).join(" · ") || `${p.itemKeys.length} items`}
          {p.itemTitles.length > 2 && <span className="text-slate-500"> +{p.itemTitles.length - 2} more</span>}
        </span>
      ),
    },
    { key: "why", header: "Why it waits", cell: (p) => <span className="type-body-sm text-warn">{planReason(p)}</span> },
    { key: "asked", header: "Asked", align: "right", cell: (p) => <span className="type-caption tabular-nums text-slate-500">{fmtAgo(p.createdAt, now)}</span> },
  ];

  return (
    <DecisionTable<LoopPlanRecord>
      caption="Plans waiting for approval"
      rows={plans}
      rowId={(p) => p.id}
      rowLabel={(p) => intentOf(p)}
      columns={columns}
      selected={NONE}
      onSelectedChange={noop}
      isSelectable={never}
      actions={[]}
      minWidth={820}
      empty={<InlineEmpty>No plan waits for you.</InlineEmpty>}
      renderDetail={(p) => (
        <div className="space-y-3">
          <PlanReview plan={p} />
          {isOwner ? (
            <PlanDecision plan={p} onDecided={onDecided} />
          ) : (
            <p className="border-t border-divider pt-3 type-caption text-slate-500">Only an owner can decide a plan — you can read it here.</p>
          )}
        </div>
      )}
    />
  );
}
