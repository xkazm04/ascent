// Cell renderers + action metadata for the audit-trail table, extracted from AuditLogViewer.tsx so the
// viewer stays under the 300-LOC component cap (AGENTS.md) when the integrity column landed. Pure
// presentation — no hooks, no handlers — so this file needs no "use client" of its own.

import Link from "next/link";
import type { AuditLogEntry } from "@/lib/db";
import type { AuditVerdict } from "@/lib/db/audit-integrity";

// One ordered list of the audit actions the app actually records, driving BOTH the badge metadata
// and the filter dropdown — so they can't drift apart (the prior bug keyed on
// `recommendation.status_changed`, which is never written; the real action is `recommendation.updated`,
// and scan.regression / org.alerts.* / *.pr_opened / member.* / plan / retention were unrecognized).
const ACTIONS: { value: string; label: string; cls: string }[] = [
  { value: "scan.created", label: "Scan", cls: "border-accent/40 bg-accent/10 text-accent" },
  { value: "recommendation.updated", label: "Rec update", cls: "border-violet-500/40 bg-violet-500/10 text-violet-300" },
  { value: "scan.regression", label: "Regression", cls: "border-orange-500/40 bg-orange-500/10 text-orange-300" },
  { value: "org.alerts.webhook", label: "Alert sink", cls: "border-sky-500/40 bg-sky-500/10 text-sky-300" },
  { value: "org.alerts.thresholds", label: "Alert rules", cls: "border-sky-500/40 bg-sky-500/10 text-sky-300" },
  { value: "practice.pr_opened", label: "Practice PR", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" },
  { value: "playbook.pr_opened", label: "Playbook PR", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" },
  { value: "org.member.role", label: "Member role", cls: "border-violet-500/40 bg-violet-500/10 text-violet-300" },
  { value: "org.member.removed", label: "Member removed", cls: "border-red-500/40 bg-red-500/10 text-red-300" },
  { value: "org.member.invited", label: "Member invited", cls: "border-violet-500/40 bg-violet-500/10 text-violet-300" },
  { value: "org.plan", label: "Plan change", cls: "border-amber-500/40 bg-amber-500/10 text-amber-300" },
  { value: "retention.purged", label: "Retention purge", cls: "border-slate-600 bg-slate-700/30 text-slate-300" },
];

const ACTION_META: Record<string, { label: string; cls: string }> = Object.fromEntries(
  ACTIONS.map((a) => [a.value, { label: a.label, cls: a.cls }]),
);

export const ACTION_FILTERS = [
  { value: "", label: "All actions" },
  ...ACTIONS.map((a) => ({ value: a.value, label: a.label })),
];

export function ActionBadge({ action }: { action: string }) {
  const m = ACTION_META[action] ?? { label: action, cls: "border-slate-600 bg-slate-700/30 text-slate-300" };
  return (
    <span className={`rounded border px-1.5 py-0.5 font-mono text-sm uppercase tracking-widest ${m.cls}`}>
      {m.label}
    </span>
  );
}

// The read-side verdict of the per-row HMAC (`meta._sig`), recomputed by getAuditLog on every read.
// `unsigned` is deliberately NEUTRAL, not an alarm: the signature fold was migration-free, so entries
// written before it landed legitimately carry no `_sig`. Painting those red would fire on every legacy
// row and teach reviewers to ignore the badge — which is exactly how a real `tampered` row gets missed.
const VERDICT_META: Record<Exclude<AuditVerdict, "no-secret">, { label: string; cls: string; title: string }> = {
  ok: {
    label: "Verified",
    cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
    title: "Signature recomputed on read and matched — this row is unchanged since it was written.",
  },
  tampered: {
    label: "Tampered",
    cls: "border-red-500/50 bg-red-500/15 text-red-300",
    title: "Signature MISMATCH — this row's content differs from what was signed when it was recorded. Treat it as unreliable evidence.",
  },
  unsigned: {
    label: "Unsigned",
    cls: "border-slate-600 bg-slate-700/30 text-slate-400",
    title: "Recorded before per-row signing existed, so there is nothing to check. NOT evidence of tampering.",
  },
};

/** Per-row integrity verdict badge. Renders nothing when the deployment has no signing secret. */
export function IntegrityBadge({ verdict }: { verdict: AuditVerdict | undefined }) {
  if (!verdict || verdict === "no-secret") return <span className="text-sm text-slate-600">—</span>;
  const m = VERDICT_META[verdict];
  return (
    <span
      title={m.title}
      className={`whitespace-nowrap rounded border px-1.5 py-0.5 font-mono text-sm uppercase tracking-widest ${m.cls}`}
    >
      {m.label}
    </span>
  );
}

export function Details({ entry }: { entry: AuditLogEntry }) {
  if (entry.scan) {
    const s = entry.scan;
    const permalink = s.repo ? `/report/${s.repo}${s.headSha ? `@${s.headSha}` : ""}` : null;
    return (
      <div className="flex flex-wrap items-center gap-2">
        {s.repo && (
          <span className="max-w-[16rem] truncate font-mono text-sm text-white" title={s.repo}>
            {s.repo}
          </span>
        )}
        {s.level && (
          <span className="rounded border border-slate-700 px-1.5 py-0.5 font-mono text-sm text-slate-300">
            {s.level}
            {s.overall != null ? ` · ${s.overall}` : ""}
          </span>
        )}
        {s.headSha && <span className="font-mono text-sm text-slate-500">{s.headSha.slice(0, 7)}</span>}
        {permalink && (
          <Link href={permalink} className="font-mono text-sm text-accent hover:text-accent-soft">
            view report →
          </Link>
        )}
      </div>
    );
  }
  // Non-scan entries: surface the most useful meta field(s) compactly.
  const status = typeof entry.meta.status === "string" ? entry.meta.status : null;
  const id = typeof entry.meta.id === "string" ? entry.meta.id : null;
  if (status) {
    return (
      <span className="block max-w-[22rem] truncate font-mono text-sm text-slate-300" title={status}>
        {id ? `${id.slice(0, 8)}… → ` : ""}
        <span className="text-white">{status}</span>
      </span>
    );
  }
  return <span className="text-sm text-slate-600">—</span>;
}
