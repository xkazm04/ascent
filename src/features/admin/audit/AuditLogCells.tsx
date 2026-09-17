// Cell renderers + action metadata for the audit-trail table, extracted from AuditLogViewer.tsx so the
// viewer stays under the 300-LOC component cap (AGENTS.md) when the integrity column landed. Pure
// presentation — no hooks, no handlers — so this file needs no "use client" of its own.

import Link from "next/link";
import type { AuditLogEntry } from "@/lib/db";
import type { AuditVerdict } from "@/lib/db/audit-integrity";

// The action registry lives in `auditActions.ts` (extracted for the 200-LOC cap); re-exported here so
// `AuditLogFilterBar` and the structural action test keep importing it from this module.
export { ACTION_FILTERS } from "./auditActions";
import { ACTION_META } from "./auditActions";

export function ActionBadge({ action }: { action: string }) {
  const m = ACTION_META[action] ?? { label: action, cls: "border-slate-600 bg-slate-700/30 text-slate-300" };
  return (
    <span className={`rounded border px-1.5 py-0.5 type-mono-sm uppercase tracking-widest ${m.cls}`}>
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
    title: "Signature recomputed on read and matched. This row is unchanged since it was written.",
  },
  tampered: {
    label: "Tampered",
    cls: "border-red-500/50 bg-red-500/15 text-red-300",
    title: "Signature MISMATCH: this row's content differs from what was signed when it was recorded. Treat it as unreliable evidence.",
  },
  unsigned: {
    label: "Unsigned",
    cls: "border-slate-600 bg-slate-700/30 text-slate-400",
    title: "Recorded before per-row signing existed, so there is nothing to check. NOT evidence of tampering.",
  },
};

/** Per-row integrity verdict badge. Renders nothing when the deployment has no signing secret. */
export function IntegrityBadge({ verdict }: { verdict: AuditVerdict | undefined }) {
  if (!verdict || verdict === "no-secret") return <span className="type-body-sm text-slate-600">—</span>;
  const m = VERDICT_META[verdict];
  return (
    <span
      title={m.title}
      className={`whitespace-nowrap rounded border px-1.5 py-0.5 type-mono-sm uppercase tracking-widest ${m.cls}`}
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
          <span className="max-w-[16rem] truncate type-mono-sm text-white" title={s.repo}>
            {s.repo}
          </span>
        )}
        {s.level && (
          <span className="rounded border border-slate-700 px-1.5 py-0.5 type-mono-sm text-slate-300">
            {s.level}
            {s.overall != null ? ` · ${s.overall}` : ""}
          </span>
        )}
        {s.headSha && <span className="type-mono-sm text-slate-500">{s.headSha.slice(0, 7)}</span>}
        {permalink && (
          <Link href={permalink} className="type-mono-sm text-accent hover:text-accent-soft">
            view report →
          </Link>
        )}
      </div>
    );
  }
  return <NonScanDetails meta={entry.meta} />;
}

// HMAC + the tenant the page is already scoped to. Neither is a detail of the act.
const SKIP_META = new Set(["_sig", "org"]);

// Prefer the fields writers actually store for non-scan acts; then fill from remaining scalars.
const META_PRIORITY = [
  "repo",
  "repoFullName",
  "login",
  "target",
  "plan",
  "role",
  "newRole",
  "prevRole",
  "name",
  "title",
  "provider",
  "forge",
  "reason",
  "pr",
  "prNumber",
  "jti",
  "module",
  "itemKey",
  "verdict",
  "severity",
  "branch",
  "action",
  "file",
  "identityMode",
  "epoch",
  "emailed",
] as const;

function scalar(v: unknown): string | null {
  if (typeof v === "string") {
    const t = v.trim();
    return t || null;
  }
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "boolean") return v ? "yes" : "no";
  return null;
}

/** Compact `key: value` line from meta scalars. Empty when nothing displayable remains. */
function compactMeta(meta: Record<string, unknown>): string | null {
  const parts: string[] = [];
  const seen = new Set<string>(SKIP_META);
  const add = (key: string) => {
    if (seen.has(key) || key === "status") return;
    const text = scalar(meta[key]);
    if (!text) return;
    seen.add(key);
    parts.push(`${key}: ${text}`);
  };
  for (const key of META_PRIORITY) {
    add(key);
    if (parts.length >= 4) break;
  }
  if (parts.length < 4) {
    for (const key of Object.keys(meta)) {
      add(key);
      if (parts.length >= 4) break;
    }
  }
  return parts.length ? parts.join(" · ") : null;
}

function NonScanDetails({ meta }: { meta: Record<string, unknown> }) {
  // Writers that already compose a human sentence (gate policy, branding, stance) keep that line.
  const status = typeof meta.status === "string" && meta.status.trim() ? meta.status : null;
  const id = typeof meta.id === "string" && meta.id.trim() ? meta.id : null;
  if (status) {
    return (
      <span className="block max-w-[22rem] truncate type-mono-sm text-slate-300" title={status}>
        {id ? `${id.slice(0, 8)}… → ` : ""}
        <span className="text-white">{status}</span>
      </span>
    );
  }
  const line = compactMeta(meta);
  if (line) {
    return (
      <span className="block max-w-[22rem] truncate type-mono-sm text-slate-300" title={line}>
        {line}
      </span>
    );
  }
  // G4: an em dash is a missing measurement, not "this row stored nothing we chose to show".
  return (
    <span
      className="type-body-sm text-slate-500"
      title="This row recorded no displayable details."
    >
      no details recorded
    </span>
  );
}
