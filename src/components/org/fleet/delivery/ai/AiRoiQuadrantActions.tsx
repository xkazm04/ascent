"use client";

// The concern-cohort action rail beside the AiRoiQuadrant map — extracted so that file stays under
// the 200-LOC cap (AGENTS.md).

import Link from "next/link";
import { fmtMoney, type AiDeliveryModel, type Verdict } from "./aiDeliveryModel";
import { VerdictChip } from "./aiShared";
import { CreateInitiativeButton } from "@/components/org/plan/CreateInitiativeButton";

// Concern cohorts get an action rail; starter/working don't need one. Each cohort maps to the
// dimension its remedy actually moves — review guardrails are D6, tooling adoption is D1, process
// governance is D8 — so "Track as initiative" files the cohort against the right lever in Plan.
const COHORTS: { verdict: Verdict; verb: string; dimId: string }[] = [
  { verdict: "ungoverned", verb: "Require review on", dimId: "D6" },
  { verdict: "idle", verb: "Reclaim seats on", dimId: "D1" },
  { verdict: "shadow", verb: "Bring under a plan", dimId: "D8" },
];

// idle/shadow are money- & plan-framed ("reclaim seats", "bring under a plan") — honest actions only
// when spend is connected. In noCostSource mode they'd rest on placeholder dollars, so the rail withholds
// them (the git-real governance cohort still shows). Kept in sync with classify()'s spend-derived set.
const MONEY_COHORTS = new Set<Verdict>(["idle", "shadow"]);

export function AiRoiQuadrantActions({ model, slug, noCostSource }: { model: AiDeliveryModel; slug: string; noCostSource: boolean }) {
  return (
    <div className="space-y-3">
      {COHORTS.filter(({ verdict }) => !(noCostSource && MONEY_COHORTS.has(verdict))).map(({ verdict, verb, dimId }) => {
        const rows = model.repos.filter((r) => r.verdict === verdict);
        if (rows.length === 0) return null;
        const spend = rows.reduce((s, r) => s + r.monthlySpend, 0);
        return (
          <div key={verdict} className="rounded-xl border border-divider bg-surface/40 p-3">
            <div className="flex items-center justify-between gap-2">
              <VerdictChip verdict={verdict} />
              {!noCostSource && spend > 0 && <span className="font-mono text-xs tabular-nums text-slate-400">{fmtMoney(spend)}/mo</span>}
            </div>
            <p className="mt-1.5 text-xs text-slate-500">
              {verb} {rows.length} repo{rows.length > 1 ? "s" : ""}:
            </p>
            <ul className="mt-1 flex flex-wrap gap-x-2 gap-y-1">
              {rows.slice(0, 8).map((r) => (
                <li key={r.fullName}>
                  <Link href={`/report/${r.fullName}`} className="focus-ring font-mono text-sm text-slate-300 transition hover:text-accent">
                    {r.name}
                  </Link>
                </li>
              ))}
              {rows.length > 8 && <li className="font-mono text-sm text-slate-600">+{rows.length - 8}</li>}
            </ul>
            <div className="mt-2">
              <CreateInitiativeButton
                slug={slug}
                title={`${verb} ${rows.length} repo${rows.length > 1 ? "s" : ""}`}
                dimId={dimId}
                repos={rows.map((r) => r.fullName)}
              />
            </div>
          </div>
        );
      })}
      {noCostSource ? (
        <div className="rounded-xl border border-divider bg-surface/40 p-3 text-xs text-slate-500">
          Idle-seat and shadow-AI verdicts rest on spend Ascent can&apos;t see yet.{" "}
          <Link href={`/org/${slug}/integrations`} className="text-accent transition hover:underline">
            Connect a provider
          </Link>{" "}
          to surface reclaimable seats and unplanned AI.
        </div>
      ) : (
        model.summary.counts.ungoverned === 0 &&
        model.summary.counts.idle === 0 &&
        model.summary.counts.shadow === 0 && (
          <div className="rounded-xl border border-divider bg-surface/40 p-4 text-sm text-slate-400">
            <span aria-hidden className="mr-2 text-lime-400">✓</span>
            No idle, ungoverned, or shadow AI spend detected across the fleet.
          </div>
        )
      )}
    </div>
  );
}
