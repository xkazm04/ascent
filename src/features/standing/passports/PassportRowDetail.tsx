"use client";

// Expanded-row detail for the fleet passport table (P3) — the actionable depth behind a repo's two
// readiness numbers, rendered inline so triage never leaves the portfolio: the blockers on each axis
// (what to fix, verbatim from the passport), the gaps the owner has ACCEPTED (passport 0.4.0), the
// agent self-verify checklist, CI/tests/security/delivery facts, and the named stack. All data ships
// with the row (cached passport) — no fetch on expand.
//
// The list bodies live in PassportDetailLists (200-LOC cap under src/features/**); this file is the
// layout.

import Link from "next/link";
import { BlockerList, DeclinedList } from "./PassportDetailLists";
import type { DeclinedByChoice, PassportFinding } from "@/lib/types";
import type { DecisionMap } from "@/lib/org/decision-map";

export interface PassportDetail {
  purpose: string;
  autoBlockers: string[];
  prodBlockers: string[];
  /** 0.4.0: the minted findings behind the two blocker lists — same order, same text. Carried so a
   *  consumer can join on a stable id instead of the sentence. Absent on a pre-0.4.0 stored passport. */
  autoFindings?: PassportFinding[];
  prodFindings?: PassportFinding[];
  /** 0.4.0: the gaps this repo's owner has declined by choice, as the read-time overlay re-emitted
   *  them. Absent when the owner has declined nothing. */
  declined?: DeclinedByChoice[];
  selfVerify: { build: boolean; test: boolean; lint: boolean; typecheck: boolean };
  aiInWorkflow: boolean;
  ciProvider: string | null;
  ciGates: string[];
  coveragePct: number | null;
  criticalPathCovered: boolean;
  securityTools: string[];
  delivery: { migrations: string; iac: boolean; rollback: boolean };
  stack: string[];
  confidence: number;
}

/** ✓/✗ chip — one self-verify script or delivery capability. */
function CheckChip({ label, ok }: { label: string; ok: boolean }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-xs ${ok ? "border-emerald-500/30 text-emerald-400" : "border-slate-700 text-slate-500"}`}>
      <span aria-hidden>{ok ? "✓" : "✗"}</span>
      {label}
    </span>
  );
}

function FactRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline gap-3 text-sm">
      <span className="w-24 shrink-0 font-mono text-xs uppercase tracking-widest text-slate-500">{label}</span>
      <span className="min-w-0 text-slate-300">{children}</span>
    </div>
  );
}

export function PassportRowDetail({
  fullName,
  detail,
  org,
  decisions,
}: {
  fullName: string;
  detail: PassportDetail;
  org: string;
  decisions: DecisionMap;
}) {
  const d = detail;
  const sv = d.selfVerify;
  return (
    <div className="grid gap-5 border-l-2 border-accent/40 bg-surface/30 px-4 py-4 md:grid-cols-2">
      {/* Left: what to fix, per axis — the passport's own follow-up list, now decidable */}
      <div className="space-y-4">
        <BlockerList
          title="Automation blockers"
          items={d.autoBlockers}
          allClear="No automation blockers. Agents can work here."
          org={org}
          fullName={fullName}
          decisions={decisions}
        />
        <BlockerList
          title="Production blockers"
          items={d.prodBlockers}
          allClear="No production blockers on record."
          org={org}
          fullName={fullName}
          decisions={decisions}
        />
        <DeclinedList items={d.declined ?? []} />
      </div>

      {/* Right: the observed facts behind the sub-scale enums */}
      <div className="space-y-2.5">
        <FactRow label="Self-verify">
          <span className="flex flex-wrap gap-1.5">
            <CheckChip label="build" ok={sv.build} />
            <CheckChip label="test" ok={sv.test} />
            <CheckChip label="lint" ok={sv.lint} />
            <CheckChip label="typecheck" ok={sv.typecheck} />
            <CheckChip label="AI in workflow" ok={d.aiInWorkflow} />
          </span>
        </FactRow>
        <FactRow label="CI">
          {d.ciProvider ?? "not detected"}
          {d.ciGates.length > 0 && <span className="text-slate-500"> · gates: {d.ciGates.join(", ")}</span>}
        </FactRow>
        <FactRow label="Tests">
          {d.coveragePct != null ? `${d.coveragePct}% coverage` : "coverage unknown"}
          <span className="text-slate-500"> · critical path {d.criticalPathCovered ? "covered" : "not covered"}</span>
        </FactRow>
        <FactRow label="Security">{d.securityTools.length > 0 ? d.securityTools.join(", ") : "no tools detected"}</FactRow>
        <FactRow label="Delivery">
          <span className="flex flex-wrap gap-1.5">
            <CheckChip label={`migrations: ${d.delivery.migrations}`} ok={d.delivery.migrations !== "none"} />
            <CheckChip label="IaC" ok={d.delivery.iac} />
            <CheckChip label="rollback" ok={d.delivery.rollback} />
          </span>
        </FactRow>
        {d.stack.length > 0 && (
          <FactRow label="Stack">
            <span className="flex flex-wrap gap-1.5">
              {d.stack.map((s) => (
                <span key={s} className="rounded border border-slate-700 px-1.5 py-0.5 font-mono text-xs text-slate-400">{s}</span>
              ))}
            </span>
          </FactRow>
        )}
      </div>

      {/* Footer: context + the deep link to act on it */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-divider pt-3 md:col-span-2">
        <span className="min-w-0 truncate text-sm text-slate-500" title={d.purpose}>
          {d.purpose} · scan confidence {Math.round(d.confidence * 100)}%
        </span>
        <Link href={`/report?repo=${encodeURIComponent(fullName)}`} className="focus-ring shrink-0 font-mono text-sm text-accent hover:text-white">
          Full report →
        </Link>
      </div>
    </div>
  );
}
