"use client";

// The batch-invite strips (members-1): the PREVIEW a multi-target paste produces before anything is
// created, and the RESULTS the server returns after the one confirm. Both read their outcome labels
// from ONE table keyed by the wire outcome (registry status-vocabulary), as MemberInvites' DELIVERY
// table does for the mail outcome, so an outcome cannot gain a sentence in one strip and a different
// one in the other.

import type { InvitePlanCounts, InvitePlanRow } from "@/lib/org/invite-batch";
import { INVITE_BATCH_MAX } from "@/lib/org/invite-batch";
import type { DeliveryStatus, InviteBatchResult } from "./MembersTypes";

type Outcome = InvitePlanRow["outcome"] | InviteBatchResult["outcome"];

const OUTCOME: Record<Outcome, { label: string; cls: string }> = {
  invite: { label: "new invite", cls: "text-accent" },
  created: { label: "invited", cls: "text-accent" },
  already_member: { label: "already a member", cls: "text-slate-400" },
  already_pending: { label: "already has a pending invite", cls: "text-slate-400" },
  invalid: { label: "not a GitHub login or email", cls: "text-danger-soft" },
  duplicate: { label: "listed twice, invited once", cls: "text-slate-500" },
  failed: { label: "could not be created", cls: "text-danger-soft" },
};

const EMAILED: Record<DeliveryStatus, string> = {
  sent: "emailed",
  skipped: "not emailed: no email provider, copy the link below",
  failed: "email failed, copy the link below",
};

function shown(target: string): string {
  const t = target.trim().replace(/^@+/, "");
  return t.includes("@") ? t : `@${t}`;
}

export function InviteBatchPreview({
  rows,
  counts,
  tooMany,
  busy,
  onConfirm,
}: {
  rows: InvitePlanRow[];
  counts: InvitePlanCounts;
  tooMany: boolean;
  busy: boolean;
  onConfirm: () => void;
}) {
  const summary = [
    `${counts.invite} new`,
    `${counts.already_member} already a member`,
    `${counts.already_pending} pending`,
    `${counts.invalid} invalid`,
  ].join(", ");
  return (
    <div data-testid="invite-batch-preview" className="mt-3 rounded-md border border-slate-800 bg-slate-950/60 p-3">
      <p className="type-body-sm text-slate-300">
        Nothing is created yet. {summary}.
      </p>
      <ul className="mt-2 space-y-1">
        {rows.map((r, i) => (
          <li key={`${r.target}-${i}`} className="flex flex-wrap items-center gap-2 type-mono-sm">
            <span className="text-slate-300">{shown(r.target)}</span>
            <span className={OUTCOME[r.outcome].cls}>
              {OUTCOME[r.outcome].label}
              {r.outcome === "already_member" && r.role ? ` (${r.role})` : ""}
            </span>
          </li>
        ))}
      </ul>
      {tooMany ? (
        <p role="alert" className="mt-2 type-body-sm text-danger-soft">
          A batch invites at most {INVITE_BATCH_MAX} people. Split the list and send it in parts.
        </p>
      ) : (
        <button
          onClick={onConfirm}
          disabled={busy || counts.invite === 0}
          className="mt-2 rounded-md border border-accent/50 bg-accent/10 px-3 py-1.5 type-body-sm font-medium text-white transition hover:bg-accent/20 disabled:opacity-50"
        >
          {busy ? "Creating..." : `Invite ${counts.invite}`}
        </button>
      )}
    </div>
  );
}

export function InviteBatchResults({
  results,
  onResend,
  onDismiss,
}: {
  results: InviteBatchResult[];
  onResend: (id: string) => void | Promise<void>;
  onDismiss: () => void;
}) {
  return (
    <div data-testid="invite-batch-results" className="mt-3 rounded-md border border-slate-800 p-3">
      <ul className="space-y-1">
        {results.map((r, i) => (
          <li key={`${r.target}-${i}`} className="flex flex-wrap items-center gap-2 type-mono-sm">
            <span className="text-slate-300">{shown(r.target)}</span>
            <span className={OUTCOME[r.outcome].cls}>
              {OUTCOME[r.outcome].label}
              {r.outcome === "already_member" ? ` (${r.role})` : ""}
            </span>
            {r.outcome === "created" && r.emailed && <span className="text-slate-500">{EMAILED[r.emailed]}</span>}
            {r.outcome === "already_pending" && (
              <button onClick={() => void onResend(r.inviteId)} className="text-slate-500 transition hover:text-white">
                resend
              </button>
            )}
          </li>
        ))}
      </ul>
      <button onClick={onDismiss} className="mt-2 type-mono-sm text-slate-600 transition hover:text-white">
        dismiss
      </button>
    </div>
  );
}
